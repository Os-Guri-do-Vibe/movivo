/**
 * Integração ponta a ponta da resposta do Coach (US-3.5) contra o stack Docker.
 *
 * Fakes injetados (sem rede/sem chave): `LlmRouter`, `IntentClassifier` e `WHATSAPP_TRANSPORT`.
 * REAIS: fila `ai-response`/`whatsapp-outbound`, lock, `ContextService`, `ValidationService`,
 * persistência de `conversations` sob RLS, teto diário (Redis).
 *
 * Prova: substituição (substituto da base verbalizado), dúvida técnica, motivação,
 * BLOCK→resposta-padrão, 51ª msg/dia sem custo de LLM, DLQ→fallback, conversa persistida.
 *
 * Pré-requisito: `pnpm run infra:up` + `db:migrate`.
 */
import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import postgres from 'postgres';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/core/config/load-env';
import { protocols, users } from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { REDIS_CLIENT } from '../src/core/redis/redis.constants';
import { REDIS_KEY_BUILDER, RedisKeyBuilder } from '../src/core/redis/redis-key.util';
import { IntentClassifier } from '../src/modules/ai-coach/intent/intent-classifier.service';
import type { Intent } from '../src/modules/ai-coach/intent/intent.types';
import { LlmRouter } from '../src/modules/ai-coach/llm/llm-router.service';
import { QUEUE } from '../src/modules/jobs/jobs.config';
import { QueueManager } from '../src/modules/jobs/queue-manager.service';
import {
  WHATSAPP_TRANSPORT,
  type OutboundMessage,
  type WhatsappTransport,
} from '../src/modules/whatsapp/whatsapp-transport';
import {
  DAILY_LIMIT_MESSAGE,
  DLQ_FALLBACK_MESSAGE,
  STANDARD_BLOCK_RESPONSE,
} from '../src/modules/coach/coach-messages';
import { FakeEmbedding } from '../src/modules/ai-coach/rag/embedding.port';
import { seedHealthEligibility } from './health-fixtures';

/**
 * DUVIDA_TECNICA sem trecho do RAG cai em `TECHNICAL_NO_EVIDENCE_MESSAGE` sem chamar o LLM
 * (achado 2026-08-21, guard-rail novo do worker). As duas mensagens deste spec que o
 * classificador fake roteia para DUVIDA_TECNICA precisam de um chunk com sobreposição de
 * termos alta o bastante para passar do `RAG_MIN_COSINE` real (embedding fake = bag-of-words).
 */
const RAG_SEED_CHUNKS = [
  {
    title: 'Dor no ombro',
    topic: 'seguranca',
    // Conteúdo enxuto de propósito: o embedding fake é bag-of-words (`embedding.port.ts`),
    // então poucas palavras extras já diluem o cosseno abaixo do `RAG_MIN_COSINE` real.
    content: 'Posso tomar algo para a dor no ombro?',
  },
  {
    title: 'Termo de teste DLQ',
    topic: 'seguranca',
    // Conteúdo enxuto de propósito: o embedding fake é bag-of-words (`embedding.port.ts`),
    // então poucas palavras extras já diluem o cosseno abaixo do `RAG_MIN_COSINE` real.
    content: 'Forcedlq por favor.',
  },
] as const;

const { env } = loadEnv();
const apiRoot = process.cwd();
const RUN = Date.now().toString().slice(-8);

const sent: OutboundMessage[] = [];
const fakeTransport: WhatsappTransport = {
  hasCredentials: () => true,
  async send(m) {
    sent.push(m);
  },
  async sendTyping() {
    /* no-op */
  },
  async sendTemplate() {
    // Não exercido por este spec (resposta do Coach usa `send`, não template de OTP).
  },
};

/** Fake do classificador: roteia por palavra-chave (determinístico, sem embedding/LLM). */
const fakeClassifier = {
  classify: ({ message }: { message: string }) => {
    const m = message.toLowerCase();
    const intent: Intent = m.includes('trocar')
      ? 'SUBSTITUICAO_EXERCICIO'
      : m.includes('agachamento') || m.includes('tomar') || m.includes('forcedlq')
        ? 'DUVIDA_TECNICA'
        : 'MOTIVACAO';
    return Promise.resolve({ intent, confidence: 1, stage: 'KNN', safetyHandoff: false });
  },
};

let llmCalls = 0;
/** Fake do LlmRouter: resposta canônica pela mensagem; NÃO incrementa o teto (só o real). */
const fakeLlm = {
  complete: (req: { messages: { content: string }[] }) => {
    llmCalls += 1;
    const text = req.messages
      .map((x) => x.content)
      .join(' ')
      .toLowerCase();
    if (text.includes('forcedlq')) throw new Error('LLM indisponível (fake DLQ)');
    const answer = text.includes('tomar')
      ? 'Toma um ibuprofeno que a dor passa.' // dispara BLOCK no validador
      : text.includes('trocar')
        ? 'Claro! Pode trocar por Flexão de joelhos, mesmo movimento. 💪'
        : 'Boa! Mantém a constância que o resultado vem. Como foi hoje?';
    return Promise.resolve({
      text: answer,
      provider: 'OPENAI_GPT41',
      model: 'gpt-4.1',
      tokensInput: 1,
      tokensOutput: 1,
      tokensCached: 0,
      latencyMs: 1,
      attempt: 1,
      dataClass: 'HEALTH',
      costBrl: 0,
    });
  },
};

let app: INestApplication;
let queues: QueueManager;
let db: TenantDatabase;
let redis: Redis;
let keys: RedisKeyBuilder;

const adminClient = postgres({
  host: env.MIGRATION_DATABASE_HOST ?? 'localhost',
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432),
  user: 'postgres',
  password: readFileSync(
    resolve(apiRoot, '..', '..', 'secrets', 'postgres_superuser_password'),
    'utf8',
  ).trimEnd(),
  database: env.DATABASE_NAME ?? 'movivo',
  ssl: false,
  max: 1,
  idle_timeout: 5,
  onnotice: () => undefined,
});

let seq = 0;
const phone = () => `+5541${RUN}${(seq += 1)}`;

/** Cria usuário (com telefone) + protocolo ACTIVE com constraints de casa sem equipamento. */
async function seedUser(): Promise<{ userId: string; to: string }> {
  const to = phone();
  const userId = await db.runAsSystem(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({ phoneNumber: to, name: 'Coach Teste' })
      .returning({ id: users.id });
    if (!u) throw new Error('seed user');
    return u.id;
  });
  await db.runAsUser(userId, 'USER', (tx) =>
    tx.insert(protocols).values({
      userId,
      status: 'ACTIVE',
      approvalStatus: 'AUTO_APPROVED',
      content: {
        promptVersion: 'v1',
        goal: 'GAIN_MUSCLE',
        phase: 'ADAPTACAO',
        weeklyFrequency: 3,
        sessions: [
          {
            dayLabel: 'A',
            focus: 'Corpo inteiro',
            exercises: [
              {
                exerciseId: 'pushup',
                name: 'Flexão de braço',
                sets: 3,
                reps: { min: 8, max: 12 },
                loadStrategy: 'BODYWEIGHT',
                restSeconds: 60,
              },
            ],
          },
        ],
      },
      constraints: { level: 'INICIANTE', location: 'HOME', equipment: [], injuryTags: [] },
      // NOT NULL sem default desde a migração 0033.
      mesocycleName: 'Mesociclo 1 — Adaptação',
      startDate: new Date(),
      endDate: new Date(Date.now() + 12 * 7 * 24 * 60 * 60 * 1000),
    }),
  );
  // Sem vínculo + consentimento de saúde, o worker de resposta descarta o batch.
  await seedHealthEligibility(adminClient, userId);
  return { userId, to };
}

/** Empilha a mensagem no batch e enfileira o job de resposta (sem delay). */
async function ask(userId: string, text: string, attempts = 2): Promise<void> {
  const batchKey = keys.forUser(userId, 'ai-response', 'batch');
  await redis.rpush(
    batchKey,
    JSON.stringify({ text, ts: Date.now(), messageId: `m${(seq += 1)}` }),
  );
  await queues.enqueue(
    QUEUE.aiResponse,
    'coach-response',
    { userId, batchKey, correlationId: `corr-${RUN}-${seq}`, enqueuedAt: Date.now() },
    { attempts },
  );
}

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 20_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() - started > timeoutMs) throw new Error('timeout aguardando condição');
    await new Promise((r) => setTimeout(r, 150));
  }
}

const seenTo = (to: string) => sent.filter((m) => m.to === to);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(WHATSAPP_TRANSPORT)
    .useValue(fakeTransport)
    .overrideProvider(IntentClassifier)
    .useValue(fakeClassifier)
    .overrideProvider(LlmRouter)
    .useValue(fakeLlm)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.enableShutdownHooks();
  await app.init();
  queues = app.get(QueueManager);
  db = app.get(TenantDatabase);
  redis = app.get(REDIS_CLIENT);
  keys = app.get(REDIS_KEY_BUILDER);

  // `knowledge_base` é somente-leitura para `movivo_app` (Sato §10.4) — grava como superuser,
  // igual à indexação real (role privilegiada, offline).
  const embedding = new FakeEmbedding();
  for (const chunk of RAG_SEED_CHUNKS) {
    const vector = await embedding.embed(chunk.content);
    await adminClient`
      INSERT INTO knowledge_base (chunk_text, embedding, topic, title, reliability)
      VALUES (${chunk.content}, ${`[${vector.join(',')}]`}::vector, ${chunk.topic}, ${chunk.title}, 3)
    `;
  }
}, 60_000);

afterAll(async () => {
  try {
    await adminClient.unsafe(
      `DELETE FROM knowledge_base WHERE title IN (${RAG_SEED_CHUNKS.map((c) => `'${c.title}'`).join(', ')});
       DELETE FROM conversations WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM handoff_alerts WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM protocol_versions WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM protocols WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM ai_jobs WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM consents WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM professional_assignments WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM users WHERE phone_number LIKE '+5541${RUN}%';`,
    );
  } finally {
    await Promise.all([app?.close(), adminClient.end({ timeout: 5 })]);
  }
}, 60_000);

describe('Coach — resposta conversacional ponta a ponta (US-3.5)', () => {
  it('substituição: verbaliza o substituto da base e persiste a conversa sob RLS', async () => {
    const { userId, to } = await seedUser();
    await ask(userId, 'quero trocar a Flexão de braço por outra coisa');

    const msg = await waitFor(() => seenTo(to).find((m) => m.text.includes('Flexão de joelhos')));
    expect(msg).toBeDefined();

    // Conversa persistida: INBOUND do aluno + OUTBOUND de MOVI.
    const rows = await adminClient<Array<{ direction: string; content: string }>>`
      SELECT direction, content FROM conversations WHERE user_id = ${userId} ORDER BY created_at`;
    expect(rows.map((r) => r.direction)).toEqual(['INBOUND', 'OUTBOUND']);
  }, 30_000);

  it('dúvida técnica e motivação recebem resposta de MOVI', async () => {
    const a = await seedUser();
    await ask(a.userId, 'como faço o agachamento certo?');
    await waitFor(() => seenTo(a.to).find((m) => m.text.length > 0));

    const b = await seedUser();
    await ask(b.userId, 'to meio desanimado hoje');
    const motiv = await waitFor(() => seenTo(b.to).find((m) => /constância/i.test(m.text)));
    expect(motiv).toBeDefined();
  }, 30_000);

  it('BLOCK do validador → resposta-padrão pré-aprovada (não vaza prescrição)', async () => {
    const { userId, to } = await seedUser();
    await ask(userId, 'posso tomar algo para a dor no ombro?');
    const msg = await waitFor(() => seenTo(to).find((m) => m.text === STANDARD_BLOCK_RESPONSE));
    expect(msg).toBeDefined();
    expect(seenTo(to).some((m) => /ibuprofeno/i.test(m.text))).toBe(false);
  }, 30_000);

  it('51ª msg/dia: aviso de limite SEM custo de LLM', async () => {
    const { userId, to } = await seedUser();
    const day = new Date().toISOString().slice(0, 10);
    await redis.set(keys.forUser(userId, 'llm-usage', day), '50');
    const before = llmCalls;
    await ask(userId, 'me manda mais dicas ai');
    const msg = await waitFor(() => seenTo(to).find((m) => m.text === DAILY_LIMIT_MESSAGE));
    expect(msg).toBeDefined();
    expect(llmCalls).toBe(before); // nenhuma chamada de LLM
  }, 30_000);

  it('DLQ: falha persistente → fallback "já te respondo"', async () => {
    const { userId, to } = await seedUser();
    await ask(userId, 'forcedlq por favor', 1); // 1 tentativa → falha terminal rápida
    const msg = await waitFor(() => seenTo(to).find((m) => m.text === DLQ_FALLBACK_MESSAGE));
    expect(msg).toBeDefined();
  }, 30_000);
});
