/**
 * Integração do outbound WhatsApp (US-2.5) contra o stack Docker, com um **fake transport**
 * (sem rede/sem conta AraraHQ) injetado no lugar do `WHATSAPP_TRANSPORT`.
 *
 * Prova:
 *   (boot)         o AppModule sobe SEM credencial AraraHQ (chave opcional);
 *   (confirmação)  submit da anamnese enfileira e o worker envia a confirmação (liberado);
 *   (cuidado)      PAR-Q de risco recebe a variante de cuidado (sem prometer plano);
 *   (entrega)      um protocolo AUTO_APPROVED/ACTIVE é entregue formatado em bolhas + link;
 *   (idempotência) reprocessar a entrega (marcador Redis) não reenvia.
 *
 * Pré-requisito: `pnpm run infra:up` + `db:migrate`.
 */
import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CONSENT_TEXTS,
  PARQ_QUESTION_IDS,
  PARQ_VERSION,
  type ProtocolStructure,
} from '@movivo/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/core/config/load-env';
import { protocols, users } from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { AnamnesisService } from '../src/modules/anamnesis/anamnesis.service';
import { ConsentService } from '../src/modules/anamnesis/consent.service';
import { QUEUE } from '../src/modules/jobs/jobs.config';
import { QueueManager } from '../src/modules/jobs/queue-manager.service';
import {
  WHATSAPP_TRANSPORT,
  type OutboundMessage,
  type WhatsappTransport,
} from '../src/modules/whatsapp/arara-transport';

const { env } = loadEnv();
const apiRoot = process.cwd();
const RUN = Date.now().toString().slice(-8);
const ORIGIN = { ip: '203.0.113.55', userAgent: 'vitest/whatsapp-outbound' };

/** Fake transport: grava os envios em memória, sem rede. */
const sent: OutboundMessage[] = [];
const fakeTransport: WhatsappTransport = {
  hasCredentials: () => true,
  async send(message) {
    sent.push(message);
  },
};

let app: INestApplication;
let anamnesis: AnamnesisService;
let consents: ConsentService;
let queues: QueueManager;
let db: TenantDatabase;

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

function structure(): ProtocolStructure {
  return {
    promptVersion: 'v1',
    goal: 'GAIN_MUSCLE',
    phase: 'ADAPTACAO',
    weeklyFrequency: 3,
    sessions: [
      {
        dayLabel: 'Dia A',
        focus: 'Corpo inteiro',
        exercises: [
          {
            exerciseId: 'goblet_squat',
            name: 'Agachamento goblet',
            sets: 3,
            reps: { min: 8, max: 12 },
            loadStrategy: 'DOUBLE_PROGRESSION',
            restSeconds: 90,
          },
        ],
      },
    ],
  };
}

function block2(riskIds: string[] = []) {
  return {
    parq: {
      version: PARQ_VERSION,
      answers: PARQ_QUESTION_IDS.map((questionId) => ({
        questionId,
        answer: riskIds.includes(questionId),
        ...(questionId === 'Q9' && riskIds.includes('Q9') ? { detail: 'motivo' } : {}),
      })),
    },
    injuries: [] as string[],
  };
}

async function submitAnamnesis(riskIds: string[] = []) {
  const { token } = await anamnesis.start({ primaryGoal: 'GAIN_MUSCLE' });
  await anamnesis.patchBlock(token, 1, { name: 'Fulano WA', phoneNumber: phone() });
  await consents.recordForSessionToken(
    token,
    [{ type: 'HEALTH_DATA', version: CONSENT_TEXTS.HEALTH_DATA.version, accepted: true }],
    ORIGIN,
  );
  await anamnesis.patchBlock(token, 2, block2(riskIds));
  await anamnesis.patchBlock(token, 3, { daysPerWeek: 3, location: 'HOME' });
  await anamnesis.submit(token);
  const [row] = await adminClient<Array<{ user_id: string; phone: string }>>`
    SELECT s.user_id, u.phone_number AS phone
      FROM anamnesis_sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ${token}`;
  return row;
}

/** Cria usuário + protocolo AUTO_APPROVED/ACTIVE direto no banco (para a entrega). */
async function seedActiveProtocol() {
  const p = phone();
  const userId = await db.runAsSystem(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({ phoneNumber: p, name: 'Seed WA' })
      .returning({ id: users.id });
    if (!u) throw new Error('seed: usuário não criado');
    return u.id;
  });
  await db.runAsUser(userId, 'USER', (tx) =>
    tx.insert(protocols).values({
      userId,
      status: 'ACTIVE',
      approvalStatus: 'AUTO_APPROVED',
      content: structure(),
      constraints: {},
    }),
  );
  return userId;
}

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 15_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = fn();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) throw new Error('timeout aguardando condição');
    await new Promise((r) => setTimeout(r, 150));
  }
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(WHATSAPP_TRANSPORT)
    .useValue(fakeTransport)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.enableShutdownHooks();
  await app.init();
  anamnesis = app.get(AnamnesisService);
  consents = app.get(ConsentService);
  queues = app.get(QueueManager);
  db = app.get(TenantDatabase);
}, 60_000);

afterAll(async () => {
  try {
    await adminClient.unsafe(
      `DELETE FROM protocol_versions WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM protocols WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM ai_jobs WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM consents WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%')
         OR anamnesis_session_id IN (SELECT id FROM anamnesis_sessions WHERE token LIKE '%${RUN}%');
       DELETE FROM anamnesis_sessions WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM users WHERE phone_number LIKE '+5541${RUN}%';`,
    );
  } finally {
    await Promise.all([app?.close(), adminClient.end({ timeout: 5 })]);
  }
}, 60_000);

describe('outbound WhatsApp — confirmação no submit (US-2.5)', () => {
  it('boota sem credencial AraraHQ e envia a confirmação (PAR-Q liberado)', async () => {
    const { phone: to } = await submitAnamnesis();
    const msg = await waitFor(() =>
      sent.find((m) => m.to === to && /em até 2 horas/i.test(m.text)),
    );
    expect(msg.text).toMatch(/CREF/);
  }, 30_000);

  it('PAR-Q de risco recebe a variante de cuidado (sem prometer plano)', async () => {
    const { phone: to } = await submitAnamnesis(['Q2']);
    const msg = await waitFor(() => sent.find((m) => m.to === to && /revisar/i.test(m.text)));
    expect(msg.text).not.toMatch(/em até 2 horas/i);
  }, 30_000);
});

describe('outbound WhatsApp — entrega do protocolo e idempotência (US-2.5)', () => {
  it('entrega AUTO_APPROVED em bolhas com link; reprocesso não reenvia', async () => {
    const userId = await seedActiveProtocol();
    const [{ phone_number: to }] = await adminClient<Array<{ phone_number: string }>>`
      SELECT phone_number FROM users WHERE id = ${userId}`;

    await queues.enqueue(
      QUEUE.whatsappOutbound,
      'protocol-delivery',
      { userId, protocolVersion: 1, type: 'PROTOCOL_DELIVERY' },
      { jobId: `protocol-delivery_${userId}_1` },
    );
    await waitFor(() => sent.find((m) => m.to === to && m.text.includes('/protocolo/')));

    const afterFirst = sent.filter((m) => m.to === to).length;
    expect(afterFirst).toBe(3); // 3 bolhas

    // Reprocesso com jobId distinto (bypassa o dedup do BullMQ) — o marcador Redis barra.
    await queues.enqueue(QUEUE.whatsappOutbound, 'protocol-delivery', {
      userId,
      protocolVersion: 1,
      type: 'PROTOCOL_DELIVERY',
    });
    await new Promise((r) => setTimeout(r, 3_000));
    expect(sent.filter((m) => m.to === to).length).toBe(3); // não reenviou
  }, 30_000);
});
