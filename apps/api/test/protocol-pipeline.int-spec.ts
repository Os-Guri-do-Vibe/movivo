/**
 * Integração do pipeline de geração de protocolo (US-2.4) contra o stack Docker.
 *
 * Prova, com I/O real (Postgres via PgBouncer + Redis via Sentinel), com um **fake do
 * `ProtocolGeneratorService`** (sem rede/sem chave de LLM) e o `ValidationService` REAL:
 *   (feliz)      submit → job → geração(fake) → validação limpa → `protocols`
 *                AUTO_APPROVED/ACTIVE assinado (RT) sob RLS → entrega enfileirada;
 *   (validador)  usuário com lesão que contraindica o exercício gerado → BLOCK → template
 *                → PENDING_REVIEW, sem entrega;
 *   (PAR-Q)      sessão de risco (`requires_professional_review`) → NÃO gera protocolo;
 *   (idempotência) reprocessar o mesmo job não cria protocolo duplicado;
 *   (DLQ)        geração que falha além dos retries → mensagem de espera + template pendente.
 *
 * Pré-requisito: `pnpm run infra:up` + `db:migrate`.
 */
import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CONSENT_TEXTS,
  PARQ_QUESTION_IDS,
  PARQ_VERSION,
  type ProtocolStructure,
} from '@movivo/shared';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/core/config/load-env';
import { HealthCipherService } from '../src/core/database/health-cipher.service';
import { anamnesisSessions, protocols, users } from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { AnamnesisService } from '../src/modules/anamnesis/anamnesis.service';
import { ConsentService } from '../src/modules/anamnesis/consent.service';
import { QUEUE } from '../src/modules/jobs/jobs.config';
import { QueueManager } from '../src/modules/jobs/queue-manager.service';
import type {
  GenerateProtocolCommand,
  GenerateProtocolResult,
} from '../src/modules/protocol/protocol-generator.service';
import { ProtocolGeneratorService } from '../src/modules/protocol/protocol-generator.service';
import { seedHealthEligibility } from './health-fixtures';

const { env } = loadEnv();
const apiRoot = process.cwd();
const RUN = Date.now().toString().slice(-8);
const ORIGIN = { ip: '203.0.113.40', userAgent: 'vitest/protocol-pipeline' };

/** Protocolo canônico do fake: usa `goblet_squat` (contraindicado p/ KNEE — útil no bloqueio). */
function fakeStructure(goal: ProtocolStructure['goal']): ProtocolStructure {
  return {
    promptVersion: 'methodology-int+catalog-int',
    goal,
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

/** Fake do gerador: throw se `injuriesRaw` pede DLQ; senão devolve o protocolo canônico. */
const fakeGenerator: Pick<ProtocolGeneratorService, 'generate'> = {
  async generate(command: GenerateProtocolCommand): Promise<GenerateProtocolResult> {
    if (command.constraints.injuriesRaw.some((i) => i.includes('forcar-dlq'))) {
      throw new Error('LLM indisponível (fake DLQ)');
    }
    return {
      structure: fakeStructure(command.constraints.goal),
      provider: 'OPENAI_GPT41',
      model: 'gpt-4.1',
      attempt: 1,
      costBrl: 0.01,
      promptVersion: 'methodology-int+catalog-int',
      unknownExerciseIds: [],
    };
  },
};

let app: INestApplication;
let anamnesis: AnamnesisService;
let consents: ConsentService;
let queues: QueueManager;
let db: TenantDatabase;
let cipher: HealthCipherService;

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

function block2(injuries: string[], riskIds: string[] = []) {
  return {
    parq: {
      version: PARQ_VERSION,
      answers: PARQ_QUESTION_IDS.map((questionId) => ({
        questionId,
        answer: riskIds.includes(questionId),
        ...(questionId === 'Q9' && riskIds.includes('Q9') ? { detail: 'motivo' } : {}),
      })),
    },
    injuries,
  };
}

/** Roda a anamnese completa pelo serviço real e submete (o submit enfileira o job). */
async function submitAnamnesis(injuries: string[], riskIds: string[] = []) {
  const { token } = await anamnesis.start({ primaryGoal: 'GAIN_MUSCLE' });
  await anamnesis.patchBlock(token, 1, {
    name: 'Fulano Pipeline',
    phoneNumber: phone(),
    email: `p${RUN}${seq}@example.com`,
  });
  await consents.recordForSessionToken(
    token,
    [{ type: 'HEALTH_DATA', version: CONSENT_TEXTS.HEALTH_DATA.version, accepted: true }],
    ORIGIN,
  );
  await anamnesis.patchBlock(token, 2, block2(injuries, riskIds));
  await anamnesis.patchBlock(token, 3, {
    daysPerWeek: 3,
    location: 'HOME',
    equipment: ['halteres'],
  });
  await anamnesis.submit(token);
  const [row] = await adminClient<Array<{ user_id: string; id: string }>>`
    SELECT user_id, id FROM anamnesis_sessions WHERE token = ${token}`;
  return { userId: row.user_id, sessionId: row.id };
}

/** Cria usuário + sessão SUBMITTED direto no banco (sem auto-enqueue) — para DLQ/idempotência. */
async function seedUser(injuries: string[]) {
  const userId = await db.runAsSystem(async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({ phoneNumber: phone(), name: 'Seed', requiresProfessionalReview: false })
      .returning({ id: users.id });
    if (!u) throw new Error('seed: usuário não criado');
    return u.id;
  });
  const sessionId = await db.runAsUser(userId, 'USER', async (tx) => {
    const [s] = await tx
      .insert(anamnesisSessions)
      .values({
        userId,
        token: randomBytes(32).toString('hex'),
        status: 'SUBMITTED',
        primaryGoal: 'GAIN_MUSCLE',
        submittedAt: new Date(),
        expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
        dataBlock1: { name: 'Seed', phoneNumber: '+550', email: null },
        dataBlock2: await cipher.encryptHealth(JSON.stringify(block2(injuries))),
        dataBlock3: { daysPerWeek: 3, location: 'HOME', equipment: ['halteres'] },
      })
      .returning({ id: anamnesisSessions.id });
    if (!s) throw new Error('seed: sessão não criada');
    return s.id;
  });
  // Titular semeado direto no banco (sem submit): recria o vínculo CREF + consentimento
  // de saúde que o fluxo real teria criado, senão a mensagem de espera é descartada.
  await seedHealthEligibility(adminClient, userId);
  return { userId, sessionId };
}

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) throw new Error('timeout aguardando condição');
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function readProtocol(userId: string) {
  const rows = await db.runAsUser(userId, 'USER', (tx) =>
    tx.select().from(protocols).where(eq(protocols.userId, userId)),
  );
  return rows;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ProtocolGeneratorService)
    .useValue(fakeGenerator)
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.enableShutdownHooks();
  await app.init();

  anamnesis = app.get(AnamnesisService);
  consents = app.get(ConsentService);
  queues = app.get(QueueManager);
  db = app.get(TenantDatabase);
  cipher = app.get(HealthCipherService);

  await queues.get(QUEUE.whatsappOutbound).obliterate({ force: true });
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
       DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM professional_assignments WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM users WHERE phone_number LIKE '+5541${RUN}%';`,
    );
  } finally {
    await Promise.all([app?.close(), adminClient.end({ timeout: 5 })]);
  }
}, 60_000);

describe('pipeline de protocolo — caminho feliz (US-2.4)', () => {
  it('submit → AUTO_APPROVED/ACTIVE assinado (RT) sob RLS + entrega enfileirada', async () => {
    const { userId, sessionId } = await submitAnamnesis([]); // sem lesão → validador limpo

    const proto = await waitFor(async () => (await readProtocol(userId))[0]);
    expect(proto.approvalStatus).toBe('AUTO_APPROVED');
    expect(proto.status).toBe('ACTIVE');
    expect(proto.humanReviewRequired).toBe(false);
    expect(proto.signatureHash).toHaveLength(64);
    expect(proto.professionalId).toBe('00000000-0000-4000-8000-000000000001');
    expect(proto.generatedBy).toBe('OPENAI_GPT41');
    expect(proto.modelVersion).toBe('gpt-4.1');
    expect(proto.promptVersion).toBe('methodology-int+catalog-int');

    // Entrega enfileirada (o worker real é a US-2.5) — idempotente por jobId de negócio.
    const delivery = await waitFor(
      async () =>
        (await queues.get(QUEUE.whatsappOutbound).getJob(`protocol-delivery_${userId}_1`)) ??
        undefined,
    );
    expect((delivery.data as { protocolId: string }).protocolId).toBe(proto.id);

    // Idempotência: reprocessar o mesmo job não cria um segundo protocolo.
    await queues.enqueue(QUEUE.protocolGeneration, 'generate-protocol', {
      userId,
      anamnesisSessionId: sessionId,
      submittedAt: new Date().toISOString(),
    });
    await new Promise((r) => setTimeout(r, 3_000));
    expect(await readProtocol(userId)).toHaveLength(1);
  }, 40_000);
});

describe('pipeline de protocolo — bloqueado pelo validador (US-2.4)', () => {
  it('lesão contraindica o exercício gerado → template → PENDING_REVIEW, sem entrega', async () => {
    const { userId } = await submitAnamnesis(['joelho']); // KNEE contraindica goblet_squat

    const proto = await waitFor(async () => (await readProtocol(userId))[0]);
    expect(proto.approvalStatus).toBe('PENDING_REVIEW');
    expect(proto.status).toBe('PENDING_SIGNATURE');
    expect(proto.humanReviewRequired).toBe(true);
    expect(proto.signatureHash).toBeNull();

    const delivery = await queues
      .get(QUEUE.whatsappOutbound)
      .getJob(`protocol-delivery_${userId}_1`);
    expect(delivery).toBeUndefined();
  }, 40_000);
});

describe('pipeline de protocolo — gate PAR-Q (US-2.4)', () => {
  it('sessão de risco NÃO gera protocolo', async () => {
    const { userId } = await submitAnamnesis([], ['Q2']); // dor no peito ao exercitar → risco

    await new Promise((r) => setTimeout(r, 4_000));
    expect(await readProtocol(userId)).toHaveLength(0);
  }, 30_000);
});

describe('pipeline de protocolo — DLQ e fallback (US-2.4)', () => {
  it('falha terminal → mensagem de espera + template pendente de revisão', async () => {
    const { userId, sessionId } = await seedUser(['forcar-dlq']);
    await queues.enqueue(
      QUEUE.protocolGeneration,
      'generate-protocol',
      { userId, anamnesisSessionId: sessionId, submittedAt: new Date().toISOString() },
      { attempts: 1 },
    );

    // Fallback: mensagem de espera enfileirada.
    const waiting = await waitFor(
      async () =>
        (await queues.get(QUEUE.whatsappOutbound).getJob(`protocol-waiting_${userId}`)) ??
        undefined,
    );
    expect((waiting.data as { type: string }).type).toBe('PROTOCOL_WAITING');

    // Fallback: template pendente de revisão persistido (task manual — painel Sprint 5).
    const proto = await waitFor(async () => (await readProtocol(userId))[0]);
    expect(proto.approvalStatus).toBe('PENDING_REVIEW');
    expect(proto.humanReviewRequired).toBe(true);
    expect(proto.generatedBy).toBe('FALLBACK_TEMPLATE');
  }, 40_000);
});
