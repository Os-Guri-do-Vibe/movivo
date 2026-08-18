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
  PARQ_DECLARATIONS,
  PARQ_DECLARATIONS_VERSION,
  PARQ_QUESTION_IDS,
  PARQ_VERSION,
  REQUIRED_CONSENT_TYPES,
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

/** Bloco cifrado da anamnese v2: secao 4 + textos livres + PAR-Q + declaracoes. */
function healthBlock(painRegions: string[], riskIds: string[] = [], trigger?: string) {
  return {
    pain:
      painRegions.length > 0 || trigger
        ? {
            hasPain: true,
            trend: 'STABLE',
            // "forcar-dlq" (fake do gerador, linha ~87) precisa de free-text: o schema v2 não
            // aceita mais injuries livres, então o trigger é o único campo que ecoa verbatim
            // em `injuriesRaw` (via `painToConstraints`).
            points:
              painRegions.length > 0
                ? painRegions.map((region) => ({ region, intensity: 6 }))
                : [{ region: 'KNEE', intensity: 1 }],
            ...(trigger ? { trigger } : {}),
            hasProfessionalExplanation: false,
            underMedicalFollowUp: false,
            hasAvoidanceRecommendation: false,
          }
        : { hasPain: false, points: [] },
    freeText: {},
    parq: {
      version: PARQ_VERSION,
      answers: PARQ_QUESTION_IDS.map((questionId) => ({
        questionId,
        answer: riskIds.includes(questionId),
        ...(questionId === 'Q9' && riskIds.includes('Q9') ? { detail: 'motivo' } : {}),
      })),
    },
    declarations: {
      version: PARQ_DECLARATIONS_VERSION,
      accepted: PARQ_DECLARATIONS.map((d) => d.id),
      acceptedAt: new Date().toISOString(),
    },
  };
}

/** Secoes 1/2/3/5 da anamnese v2 (jsonb em claro). */
function structured(over: Record<string, unknown> = {}) {
  return {
    primaryGoal: 'GAIN_MUSCLE',
    emphasis: [],
    hasImportantEvent: false,
    trainingStatus: 'REGULAR',
    experience: 'BEGINNER',
    pastActivities: [],
    consistencyBarriers: [],
    daysPerWeek: 3,
    preferredDays: [],
    sessionDuration: 'M45_TO_60',
    location: 'HOME',
    preferredPeriod: 'MORNING',
    practicesOtherSport: false,
    hasAvoidedExercise: false,
    ...over,
  };
}

/** Roda a anamnese completa pelo serviço real e submete (o submit enfileira o job). */
async function submitAnamnesis(painRegions: string[], riskIds: string[] = []) {
  const { token } = await anamnesis.start({ primaryGoal: 'GAIN_MUSCLE' });
  const phoneNumber = phone();
  await consents.recordForSessionToken(
    token,
    REQUIRED_CONSENT_TYPES.map((type) => ({
      type,
      version: CONSENT_TEXTS[type].version,
      accepted: true,
    })),
    ORIGIN,
  );
  // Este teste e do PIPELINE DE PROTOCOLO, nao do OTP: a posse do numero e carimbada
  // direto (o fluxo do codigo tem cobertura propria em anamnesis.int-spec.ts).
  await adminClient`
    UPDATE anamnesis_sessions SET phone_e164 = ${phoneNumber}, phone_verified_at = now()
      WHERE token = ${token}`;
  await anamnesis.patchStep(token, 1, {
    name: 'Fulano Pipeline',
    birthDate: '1996-04-02',
    biologicalSex: 'MALE',
    heightCm: 178,
    weightKg: 80,
    phoneNumber,
    email: `p${RUN}${seq}@example.com`,
  });
  await anamnesis.patchStep(token, 2, {
    anamnesis: { structured: structured(), freeText: {} },
    pain:
      painRegions.length > 0
        ? {
            hasPain: true,
            trend: 'STABLE',
            points: painRegions.map((region) => ({ region, intensity: 6 })),
            hasProfessionalExplanation: false,
            underMedicalFollowUp: false,
            hasAvoidanceRecommendation: false,
          }
        : { hasPain: false, points: [] },
  });
  await anamnesis.patchStep(token, 3, {
    parq: healthBlock([], riskIds).parq,
    declarationsVersion: PARQ_DECLARATIONS_VERSION,
    declarations: PARQ_DECLARATIONS.map((d) => d.id),
  });
  await anamnesis.submit(token);
  const [row] = await adminClient<Array<{ user_id: string; id: string }>>`
    SELECT user_id, id FROM anamnesis_sessions WHERE token = ${token}`;
  return { userId: row.user_id, sessionId: row.id };
}

/** Cria usuário + sessão SUBMITTED direto no banco (sem auto-enqueue) — para DLQ/idempotência. */
async function seedUser(painRegions: string[], trigger?: string) {
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
        submittedAt: new Date(),
        expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
        dataBlock1: {
          name: 'Seed',
          birthDate: '1996-04-02',
          biologicalSex: 'MALE',
          phoneNumber: '+550',
        },
        dataBlock2: await cipher.encryptHealth(
          JSON.stringify(healthBlock(painRegions, [], trigger)),
        ),
        dataBlock3: structured(),
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
       ALTER TABLE user_status_transitions DISABLE TRIGGER trg_user_status_transitions_immutable;
       DELETE FROM user_status_transitions WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       ALTER TABLE user_status_transitions ENABLE TRIGGER trg_user_status_transitions_immutable;
       DELETE FROM users WHERE phone_number LIKE '+5541${RUN}%';`,
    );
  } finally {
    await Promise.all([app?.close(), adminClient.end({ timeout: 5 })]);
  }
}, 60_000);

describe('pipeline de protocolo — caminho feliz (US-2.4)', () => {
  it('submit → PENDING_REVIEW/OPTIONAL sob RLS + auto-liberação de 1h agendada', async () => {
    const { userId, sessionId } = await submitAnamnesis([]); // sem lesão → validador limpo

    // Decisão do fundador (2026-08-18): PASS limpo NÃO entrega mais sozinho na hora —
    // entra na fila como PENDING_REVIEW/OPTIONAL igual a qualquer outro protocolo. O único
    // motivo pra travar sem prazo (MANDATORY) é PAR-Q, já filtrado antes de chegar aqui.
    const proto = await waitFor(async () => (await readProtocol(userId))[0]);
    expect(proto.approvalStatus).toBe('PENDING_REVIEW');
    expect(proto.status).toBe('PENDING_SIGNATURE');
    expect(proto.humanReviewRequired).toBe(true);
    expect(proto.reviewUrgency).toBe('OPTIONAL');
    expect(proto.signatureHash).toBeNull();
    expect(proto.generatedBy).toBe('OPENAI_GPT41');
    expect(proto.modelVersion).toBe('gpt-4.1');
    expect(proto.promptVersion).toBe('methodology-int+catalog-int');

    // Ninguém entrega sozinho na hora: a entrega só existe após o RT assinar ou a janela
    // de cortesia de 1h (`ProtocolAutoReleaseWorker`) liberar.
    const delivery = await queues
      .get(QUEUE.whatsappOutbound)
      .getJob(`protocol-delivery_${userId}_1`);
    expect(delivery).toBeUndefined();

    // A auto-liberação de 1h foi agendada (delay real, não aguardado aqui — é coberta
    // isoladamente pelo spec do `ProtocolAutoReleaseWorker`).
    const autoRelease = await queues
      .get(QUEUE.protocolAutoRelease)
      .getJob(`auto-release-${proto.id}`);
    expect(autoRelease).toBeDefined();
    expect(autoRelease?.opts.delay).toBe(60 * 60 * 1000);

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
    const { userId } = await submitAnamnesis(['KNEE']); // KNEE contraindica goblet_squat

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
    const { userId, sessionId } = await seedUser([], 'forcar-dlq');
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
