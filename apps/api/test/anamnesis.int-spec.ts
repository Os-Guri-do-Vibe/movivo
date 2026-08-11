/**
 * Teste de integração da ANAMNESE (US-1.3 / valida TASK-1.3.1..1.3.4 + achados do Sato).
 *
 * Roda contra o stack real, **como a aplicação** (`movivo_app` via PgBouncer 5433).
 * Prova:
 *   (feliz)   start→3 blocos→submit: usuário criado (ONBOARDING), consentimento
 *             migrado, PAR-Q LIBERADO;
 *   (bloqueio) PAR-Q de risco → BLOQUEADO_AGUARDANDO_CLEARANCE + requires_professional_review;
 *   (gate)    bloco 2 barrado sem consentimento de saúde (nada persistido);
 *   (cifra)   `data_block_2` no banco é bytea, não contém o plaintext;
 *   (IDOR)    token A não acessa a sessão B;
 *   (72h)     sessão IN_PROGRESS expirada → EXPIRED com data_block_2 descartado;
 *   (Sato #1) RLS anônima isola por sessão: escopado à sessão A, a linha órfã de B
 *             não é lida nem alterada (o achado 1 não reproduz mais).
 *
 * Pré-requisito: `pnpm run infra:up` + `db:migrate`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  CONSENT_TEXTS,
  PARQ_DECLARATIONS,
  PARQ_DECLARATIONS_VERSION,
  PARQ_QUESTION_IDS,
  PARQ_VERSION,
  REQUIRED_CONSENT_TYPES,
  type AnamnesisStructured,
  type OnboardingStep1,
  type OnboardingStep2,
  type OnboardingStep3,
} from '@movivo/shared';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/core/config/load-env';
import { type DrizzleClient } from '../src/core/database/database.module';
import { HealthCipherService } from '../src/core/database/health-cipher.service';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { AnamnesisService } from '../src/modules/anamnesis/anamnesis.service';
import { ConsentService } from '../src/modules/anamnesis/consent.service';
import { PhoneVerificationService } from '../src/modules/anamnesis/phone-verification.service';

const { env } = loadEnv();
const apiRoot = process.cwd();
const RUN = Date.now().toString().slice(-8);
const ORIGIN = { ip: '203.0.113.20', userAgent: 'vitest/anamnesis' };

const appClient = postgres({
  host: env.DATABASE_HOST ?? 'localhost',
  port: Number(env.DATABASE_PORT ?? 5433),
  user: env.DATABASE_USER ?? 'movivo_app',
  password: env.DATABASE_PASSWORD,
  database: env.DATABASE_NAME ?? 'movivo',
  ssl: false,
  max: 3,
  prepare: false,
  idle_timeout: 5,
  onnotice: () => {
    /* notices podem conter valores — nunca vão para o log do teste. */
  },
});
const db = drizzle(appClient) as unknown as DrizzleClient;
const tenant = new TenantDatabase(db);
const cipher = new HealthCipherService(db, {
  pgcryptoKey:
    env.PGCRYPTO_KEY ??
    readFileSync(resolve(apiRoot, '..', '..', 'secrets', 'pgcrypto_key'), 'utf8').trimEnd(),
} as never);
const consents = new ConsentService(tenant);
const logger = {
  info: () => undefined,
  warn: () => undefined,
  setContext: () => undefined,
} as never;
/**
 * Fake da fila: este teste exercita o onboarding, não o pipeline de protocolo (US-2.4).
 * Captura os jobs para conseguir ler o código de verificação enviado ao WhatsApp — é a
 * única forma de o teste "receber" o código, já que ele nunca é persistido em claro.
 */
const enqueued: Array<{ queue: string; payload: Record<string, unknown> }> = [];
const queues = {
  enqueue: async (queue: string, _name: string, payload: Record<string, unknown>) => {
    enqueued.push({ queue, payload });
    return 'job';
  },
} as never;
const phoneVerification = new PhoneVerificationService(tenant, queues, logger);
const service = new AnamnesisService(logger, tenant, cipher, consents, queues, phoneVerification);

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
  onnotice: () => {
    /* notices podem conter valores — nunca vão para o log do teste. */
  },
});

let seq = 0;
const phone = () => `+5541${RUN}${(seq += 1)}`;

function step1(): OnboardingStep1 {
  return {
    name: 'Fulano de Teste',
    birthDate: '1996-04-02',
    biologicalSex: 'MALE',
    phoneNumber: phone(),
    email: `t${RUN}${seq}@example.com`,
  };
}

const STRUCTURED: AnamnesisStructured = {
  primaryGoal: 'GAIN_STRENGTH',
  emphasis: ['BACK'],
  hasImportantEvent: false,
  trainingStatus: 'REGULAR',
  experience: 'INTERMEDIATE',
  pastActivities: [],
  consistencyBarriers: [],
  daysPerWeek: 4,
  preferredDays: [],
  sessionDuration: 'M45_TO_60',
  location: 'CONDO_GYM',
  preferredPeriod: 'MORNING',
  practicesOtherSport: false,
  hasAvoidedExercise: false,
};

/** Etapa 2 com dor no joelho — o dado que precisa sair cifrado. */
function step2(): OnboardingStep2 {
  return {
    anamnesis: { structured: STRUCTURED, freeText: { avoidedExercise: 'burpee' } },
    pain: {
      hasPain: true,
      trend: 'STABLE',
      points: [{ region: 'KNEE', intensity: 6 }],
      trigger: 'incomoda ao agachar',
      hasProfessionalExplanation: false,
      underMedicalFollowUp: false,
      hasAvoidanceRecommendation: false,
    },
  };
}

function step3(riskIds: string[] = []): OnboardingStep3 {
  return {
    parq: {
      version: PARQ_VERSION,
      answers: PARQ_QUESTION_IDS.map((questionId) => ({
        questionId,
        answer: riskIds.includes(questionId),
        ...(questionId === 'Q9' && riskIds.includes('Q9') ? { detail: 'motivo' } : {}),
      })),
    },
    declarationsVersion: PARQ_DECLARATIONS_VERSION,
    declarations: PARQ_DECLARATIONS.map((d) => d.id),
  };
}

/** Aceita os 3 consentimentos que travam o CONTINUAR da Etapa 1 (Alexandre 5.8). */
async function acceptRequired(token: string) {
  await consents.recordForSessionToken(
    token,
    REQUIRED_CONSENT_TYPES.map((type) => ({
      type,
      version: CONSENT_TEXTS[type].version,
      accepted: true,
    })),
    ORIGIN,
  );
}

/** Prova a posse do número lendo o código do job enfileirado (nunca do banco). */
async function verifyPhone(token: string, phoneNumber: string) {
  const before = enqueued.length;
  await service.sendPhoneCode(token, phoneNumber);
  const job = enqueued.slice(before).find((j) => j.payload.type === 'PHONE_VERIFICATION');
  if (!job) throw new Error('nenhum código de verificação foi enfileirado');
  await service.verifyPhoneCode(token, job.payload.code as string);
}

/** Etapa 1 completa: consentimentos + número provado + cadastro persistido. */
async function completeStep1(token: string, data = step1()) {
  await acceptRequired(token);
  await verifyPhone(token, data.phoneNumber);
  await service.patchStep(token, 1, data);
  return data;
}

afterAll(async () => {
  try {
    await adminClient.unsafe(
      `DELETE FROM consents WHERE anamnesis_session_id IN
         (SELECT id FROM anamnesis_sessions WHERE token LIKE '%${RUN}%')
         OR user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM anamnesis_sessions WHERE token LIKE '%${RUN}%'
         OR user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM professional_assignments WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM users WHERE phone_number LIKE '+5541${RUN}%';`,
    );
  } finally {
    await Promise.all([appClient.end({ timeout: 5 }), adminClient.end({ timeout: 5 })]);
  }
}, 30_000);

describe('ONBOARDING v2 — fluxo feliz (US-6.3..6.8)', () => {
  it('start→3 etapas→submit cria usuario ONBOARDING, migra consentimento, READY', async () => {
    const { token } = await service.start({ primaryGoal: 'GAIN_MUSCLE' });
    const b1 = await completeStep1(token);
    await service.patchStep(token, 2, step2());
    await service.patchStep(token, 3, step3());

    const result = await service.submit(token);
    // A UI recebe SOMENTE o outcome — nunca o estado clinico nem as respostas.
    expect(result).toEqual({ status: 'SUBMITTED', outcome: 'READY' });

    // Usuário criado a partir do bloco 1, status ONBOARDING, sem revisão.
    const [user] = await adminClient<Array<{ status: string; requires: boolean; id: string }>>`
      SELECT id, status, requires_professional_review AS requires
        FROM users WHERE phone_number = ${b1.phoneNumber}`;
    expect(user.status).toBe('ONBOARDING');
    expect(user.requires).toBe(false);

    // Sessão vinculada e SUBMITTED; consentimento de saúde migrado para o titular.
    const [session] = await adminClient<Array<{ user_id: string; status: string }>>`
      SELECT user_id, status FROM anamnesis_sessions WHERE token = ${token}`;
    expect(session.status).toBe('SUBMITTED');
    expect(session.user_id).toBe(user.id);

    const [consent] = await adminClient<Array<{ user_id: string }>>`
      SELECT user_id FROM consents
        WHERE anamnesis_session_id = (SELECT id FROM anamnesis_sessions WHERE token = ${token})
          AND consent_type = 'HEALTH_DATA'`;
    expect(consent.user_id).toBe(user.id);
  });

  it('data_block_2 e gravado CIFRADO (secao 4, texto livre e PAR-Q, sem plaintext)', async () => {
    const { token } = await service.start({});
    await completeStep1(token);
    await service.patchStep(token, 2, step2());
    await service.patchStep(token, 3, step3());

    const [row] = await adminClient<Array<{ data_block_2: Buffer; data_block_3: unknown }>>`
      SELECT data_block_2, data_block_3 FROM anamnesis_sessions WHERE token = ${token}`;
    const raw = row.data_block_2.toString('utf8');
    expect(Buffer.isBuffer(row.data_block_2)).toBe(true);
    expect(raw).not.toContain('KNEE');
    expect(raw).not.toContain('agachar');
    expect(raw).not.toContain('burpee');
    expect(raw).not.toContain(PARQ_VERSION);

    // E o bloco em claro NAO pode ter recebido nada de saude nem texto livre.
    const clear = JSON.stringify(row.data_block_3);
    expect(clear).not.toContain('KNEE');
    expect(clear).not.toContain('burpee');
    expect(clear).toContain('GAIN_STRENGTH');
  });

  it('a etapa 1 nao fecha sem os consentimentos obrigatorios nem sem o numero provado', async () => {
    const { token } = await service.start({});
    const data = step1();
    // Sem consentimento: barrado.
    await expect(service.patchStep(token, 1, data)).rejects.toThrow(/obrigat/i);
    // Com consentimento, mas sem provar o numero: continua barrado.
    await acceptRequired(token);
    await expect(service.patchStep(token, 1, data)).rejects.toThrow(/WhatsApp/i);
  });

  it('gate 18+ e aplicado no SERVIDOR', async () => {
    const { token } = await service.start({});
    const data = step1();
    await acceptRequired(token);
    await verifyPhone(token, data.phoneNumber);
    await expect(service.patchStep(token, 1, { ...data, birthDate: '2015-06-01' })).rejects.toThrow(
      /maiores de 18 anos/i,
    );

    const [row] = await adminClient<Array<{ data_block_1: unknown }>>`
      SELECT data_block_1 FROM anamnesis_sessions WHERE token = ${token}`;
    expect(row.data_block_1).toBeNull();
  });

  it('o codigo de verificacao nunca fica em claro no banco', async () => {
    const { token } = await service.start({});
    const data = step1();
    const before = enqueued.length;
    await service.sendPhoneCode(token, data.phoneNumber);
    const job = enqueued.slice(before).find((j) => j.payload.type === 'PHONE_VERIFICATION');
    if (!job) throw new Error('nenhum codigo de verificacao foi enfileirado');
    const code = job.payload.code as string;

    const [row] = await adminClient<Array<{ hash: string; verified: Date | null }>>`
      SELECT phone_code_hash AS hash, phone_verified_at AS verified
        FROM anamnesis_sessions WHERE token = ${token}`;
    expect(row.hash).not.toContain(code);
    expect(row.hash).toHaveLength(64);
    expect(row.verified).toBeNull();

    // Codigo errado nao verifica; o certo verifica.
    await expect(service.verifyPhoneCode(token, '000000')).rejects.toThrow();
    await service.verifyPhoneCode(token, code);
    const [after] = await adminClient<Array<{ verified: Date | null; hash: string | null }>>`
      SELECT phone_verified_at AS verified, phone_code_hash AS hash
        FROM anamnesis_sessions WHERE token = ${token}`;
    expect(after.verified).not.toBeNull();
    expect(after.hash).toBeNull();
  });
});

describe('ANAMNESE — gate PAR-Q bloqueante (US-1.3 / Alexandre §2)', () => {
  it('resposta de risco -> PENDING_REVIEW + requires_professional_review', async () => {
    const { token } = await service.start({});
    const b1 = await completeStep1(token);
    await service.patchStep(token, 2, step2());
    await service.patchStep(token, 3, step3(['Q2'])); // dor no peito ao se exercitar

    const result = await service.submit(token);
    expect(result.outcome).toBe('PENDING_REVIEW');
    // O motivo do bloqueio NUNCA volta ao cliente (Sofia 9.3).
    expect(JSON.stringify(result)).not.toMatch(/Q2|BLOQUEADO/);

    const [user] = await adminClient<Array<{ requires: boolean }>>`
      SELECT requires_professional_review AS requires FROM users WHERE phone_number = ${b1.phoneNumber}`;
    expect(user.requires).toBe(true);

    // Estado persistido e consultável (para o RT — Sprint 5).
    const [session] = await adminClient<Array<{ parq_state: string }>>`
      SELECT parq_state FROM anamnesis_sessions WHERE token = ${token}`;
    expect(session.parq_state).toBe('BLOQUEADO_AGUARDANDO_CLEARANCE');
  });
});

describe('ONBOARDING v2 — etapa 2 gated por consentimento (BLOQUEADOR 3)', () => {
  it('sem consentimento de saude, o PATCH da etapa 2 e barrado e nada persiste', async () => {
    const { token } = await service.start({});

    await expect(service.patchStep(token, 2, step2())).rejects.toThrow(/consentimento/i);

    const [row] = await adminClient<Array<{ data_block_2: Buffer | null }>>`
      SELECT data_block_2 FROM anamnesis_sessions WHERE token = ${token}`;
    expect(row.data_block_2).toBeNull();
  });
});

describe('ANAMNESE — IDOR e expiração (Sato §8.1)', () => {
  it('token A não acessa a sessão B (retomada é por token)', async () => {
    const a = await service.start({ primaryGoal: 'LOSE_FAT' });
    const b = await service.start({ primaryGoal: 'CONDITIONING' });

    const viewA = await service.getByToken(a.token);
    expect(viewA.primaryGoal).toBe('LOSE_FAT');
    const viewB = await service.getByToken(b.token);
    expect(viewB.primaryGoal).toBe('CONDITIONING');
  });

  it('sessao IN_PROGRESS expirada vira EXPIRED e descarta data_block_2', async () => {
    const { token } = await service.start({});
    await completeStep1(token);
    await service.patchStep(token, 2, step2());
    // Força a expiração no passado.
    await adminClient`UPDATE anamnesis_sessions SET expires_at = now() - interval '1 hour' WHERE token = ${token}`;

    const view = await service.getByToken(token);
    expect(view.status).toBe('EXPIRED');

    const [row] = await adminClient<Array<{ status: string; data_block_2: Buffer | null }>>`
      SELECT status, data_block_2 FROM anamnesis_sessions WHERE token = ${token}`;
    expect(row.status).toBe('EXPIRED');
    expect(row.data_block_2).toBeNull();

    // Uma sessão expirada não aceita mais escrita nem submit.
    await expect(service.patchStep(token, 3, step3())).rejects.toThrow();
    await expect(service.submit(token)).rejects.toThrow();
  });
});

describe('ANAMNESE — RLS anônima isolada por sessão (Sato — achado 1)', () => {
  it('escopado à sessão A, a linha órfã de B não é lida nem alterada', async () => {
    const a = await service.start({});
    const b = await service.start({});
    const [{ id: idA }] = await adminClient<Array<{ id: string }>>`
      SELECT id FROM anamnesis_sessions WHERE token = ${a.token}`;
    const [{ id: idB }] = await adminClient<Array<{ id: string }>>`
      SELECT id FROM anamnesis_sessions WHERE token = ${b.token}`;

    // Positivo: escopado a A, A é visível.
    const seesA = await tenant.runAsTokenScoped(idA, async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT id FROM anamnesis_sessions WHERE id = ${idA}`,
      )) as unknown as unknown[];
      return rows.length;
    });
    expect(seesA).toBe(1);

    // Negativo (o achado): escopado a A, a linha órfã de B some — mesmo sem WHERE token.
    const seesB = await tenant.runAsTokenScoped(idA, async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT id FROM anamnesis_sessions WHERE id = ${idB}`,
      )) as unknown as unknown[];
      return rows.length;
    });
    expect(seesB).toBe(0);

    // E não consegue ALTERAR a sessão B a partir do contexto de A.
    const changed = await tenant.runAsTokenScoped(idA, async (tx) => {
      const rows = (await tx.execute(
        sql`UPDATE anamnesis_sessions SET last_block = 3 WHERE id = ${idB} RETURNING id`,
      )) as unknown as unknown[];
      return rows.length;
    });
    expect(changed).toBe(0);

    const [rowB] = await adminClient<Array<{ last_block: number }>>`
      SELECT last_block FROM anamnesis_sessions WHERE id = ${idB}`;
    expect(rowB.last_block).toBe(1); // intacta
  });
});
