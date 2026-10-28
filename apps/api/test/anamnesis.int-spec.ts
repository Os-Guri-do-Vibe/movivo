import { migrationPostgresTls } from '../src/core/database/postgres-tls';
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
  PARQ_VERSION,
  REQUIRED_CONSENT_TYPES,
  type OnboardingStep1,
} from '@movivo/shared';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/core/config/load-env';
import { type DrizzleClient } from '../src/core/database/database.module';
import { HealthCipherService } from '../src/core/database/health-cipher.service';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import {
  completeSteps,
  goals,
  modalities,
  nutrition,
  parq,
  preferences,
  routine,
} from './onboarding-fixtures';
import { HealthConsentService } from '../src/core/database/health-consent.service';
import { AnamnesisService } from '../src/modules/anamnesis/anamnesis.service';
import { SafetyService } from '../src/modules/coaching/safety/safety.service';
import { DomainEventRecorder } from '../src/modules/domain-events/domain-event-recorder';
import type { OutboxRelay } from '../src/modules/domain-events/outbox-relay';
import { OnboardingProjection } from '../src/modules/student-state/onboarding-projection';
import { ConsentService } from '../src/modules/anamnesis/consent.service';
import { PhoneVerificationService } from '../src/modules/anamnesis/phone-verification.service';

const { env } = loadEnv();
const apiRoot = process.cwd();
const RUN = Date.now().toString().slice(-8);
const ORIGIN = { ip: '203.0.113.20', userAgent: 'vitest/anamnesis' };

const appClient = postgres({
  host: env.DATABASE_HOST ?? 'localhost',
  ssl: migrationPostgresTls(env, env.DATABASE_HOST ?? 'localhost'),
  port: Number(env.DATABASE_PORT ?? 5433),
  user: env.DATABASE_USER ?? 'movivo_app',
  password: env.DATABASE_PASSWORD,
  database: env.DATABASE_NAME ?? 'movivo',

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
    readFileSync(
      resolve(apiRoot, '..', '..', 'secrets', 'desenvolvimento', 'pgcrypto_key'),
      'utf8',
    ).trimEnd(),
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
const recorder = new DomainEventRecorder();
const outbox = { flushSoon: async () => undefined } as unknown as OutboxRelay;
const service = new AnamnesisService(
  logger,
  tenant,
  cipher,
  consents,
  new HealthConsentService(tenant),
  queues,
  phoneVerification,
  new OnboardingProjection(cipher),
  new SafetyService(tenant, recorder, outbox),
  recorder,
  outbox,
);

const adminClient = postgres({
  host: env.MIGRATION_DATABASE_HOST ?? 'localhost',
  ssl: migrationPostgresTls(env, env.MIGRATION_DATABASE_HOST ?? 'localhost'),
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432),
  user: 'postgres',
  password: readFileSync(
    resolve(apiRoot, '..', '..', 'secrets', 'desenvolvimento', 'postgres_superuser_password'),
    'utf8',
  ).trimEnd(),
  database: env.DATABASE_NAME ?? 'movivo',

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
    heightCm: 178,
    weightKg: 80,
    phoneNumber: phone(),
    email: `t${RUN}${seq}@example.com`,
  };
}

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
       DELETE FROM domain_events WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE phone_number LIKE '+5541${RUN}%');
       DELETE FROM users WHERE phone_number LIKE '+5541${RUN}%';`,
    );
  } finally {
    await Promise.all([appClient.end({ timeout: 5 }), adminClient.end({ timeout: 5 })]);
  }
}, 30_000);

describe('ANAMNESE em 8 etapas — fluxo completo', () => {
  it('cadastro → 8 etapas → envio: titular, Estado do Aluno, evento e filas', async () => {
    const { token } = await service.start({ primaryGoal: 'GAIN_MUSCLE' });
    const b1 = await completeStep1(token);
    const before = enqueued.length;
    await completeSteps(service, token);

    const result = await service.submit(token);
    // A UI recebe SOMENTE o outcome — nunca o estado clínico nem as respostas.
    expect(result).toEqual({ status: 'SUBMITTED', outcome: 'READY' });

    const [user] = await adminClient<Array<{ id: string; status: string; requires: boolean }>>`
      SELECT id, status, requires_professional_review AS requires
        FROM users WHERE phone_number = ${b1.phoneNumber}`;
    expect(user).toMatchObject({ status: 'ONBOARDING', requires: false });

    // Consentimento de saúde migrado para o titular.
    const [consent] = await adminClient<Array<{ user_id: string }>>`
      SELECT user_id FROM consents
        WHERE anamnesis_session_id = (SELECT id FROM anamnesis_sessions WHERE token = ${token})
          AND consent_type = 'HEALTH_DATA'`;
    expect(consent.user_id).toBe(user.id);

    // Estado do Aluno projetado.
    const [profile] = await adminClient<
      Array<{ profile: { heightCm: number; modalities: unknown[] } }>
    >`
      SELECT profile FROM student_profiles WHERE user_id = ${user.id}`;
    expect(profile.profile.heightCm).toBe(178);
    expect(profile.profile.modalities).toHaveLength(2);
    const [goal] = await adminClient<Array<{ declared: { primary: string }; status: string }>>`
      SELECT declared, status FROM student_goals WHERE user_id = ${user.id}`;
    expect(goal).toMatchObject({ declared: { primary: 'HYPERTROPHY' }, status: 'ACTIVE' });
    const constraints = await adminClient<Array<{ kind: string }>>`
      SELECT kind FROM student_constraints WHERE user_id = ${user.id} ORDER BY kind`;
    expect(constraints.map((c) => c.kind)).toEqual(['AVAILABILITY', 'DIETARY_RESTRICTION']);
    const health = await adminClient<Array<{ kind: string }>>`
      SELECT kind FROM student_health_records WHERE user_id = ${user.id} ORDER BY kind`;
    expect(health.map((h) => h.kind)).toEqual(['FOOD_ALLERGY', 'NOTES', 'PAIN', 'PARQ']);
    const measures = await adminClient<Array<{ kind: string }>>`
      SELECT kind FROM body_measurements WHERE user_id = ${user.id} ORDER BY kind`;
    expect(measures.map((m) => m.kind)).toEqual(['WAIST', 'WEIGHT']);

    const [event] = await adminClient<Array<{ type: string }>>`
      SELECT type FROM domain_events WHERE user_id = ${user.id} AND type = 'OnboardingCompleted'`;
    expect(event?.type).toBe('OnboardingCompleted');

    // Confirmação no WhatsApp e início do trial; o protocolo legado não é mais disparado.
    const jobs = enqueued.slice(before).map((j) => j.queue);
    expect(jobs).toContain('whatsapp-outbound');
    expect(jobs).toContain('conversion-sequence');
    expect(jobs).not.toContain('protocol-generation');
  });

  it('saúde, alergia e texto livre ficam só cifrados e nunca voltam na leitura da sessão', async () => {
    const { token } = await service.start({});
    await completeStep1(token);
    await completeSteps(service, token);

    const [row] = await adminClient<Array<{ sensitive: Buffer; blocks: unknown }>>`
      SELECT sensitive, blocks FROM anamnesis_sessions WHERE token = ${token}`;
    const raw = row.sensitive.toString('utf8');
    for (const secret of ['burpee', 'amendoim', 'agachar', 'casamento', 'jiló', PARQ_VERSION]) {
      expect(raw).not.toContain(secret);
      expect(JSON.stringify(row.blocks)).not.toContain(secret);
    }
    const view = await service.getByToken(token);
    expect(JSON.stringify(view)).not.toMatch(/burpee|amendoim|casamento|KNEE/);
    expect(view.completedSteps).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(JSON.stringify(view.blocks)).toContain('UPPER_LOWER');
  });

  it('envio sem todas as etapas obrigatórias é recusado; a etapa de corpo é opcional', async () => {
    const { token } = await service.start({});
    await completeStep1(token);
    await service.patchStep(token, 2, goals());
    await expect(service.submit(token)).rejects.toThrow(/Complete as etapas 3, 4, 5, 6, 7/);
    await service.patchStep(token, 3, modalities());
    await service.patchStep(token, 4, routine());
    await service.patchStep(token, 5, preferences());
    await service.patchStep(token, 6, parq());
    await service.patchStep(token, 7, nutrition());
    await expect(service.submit(token)).resolves.toMatchObject({ outcome: 'READY' });
  });

  it('o cadastro não fecha sem os consentimentos obrigatórios nem sem o número provado', async () => {
    const { token } = await service.start({});
    const data = step1();
    await expect(service.patchStep(token, 1, data)).rejects.toThrow(/obrigat/i);
    await acceptRequired(token);
    await expect(service.patchStep(token, 1, data)).rejects.toThrow(/WhatsApp/i);
  });

  it('18+ é aplicado no SERVIDOR', async () => {
    const { token } = await service.start({});
    const data = step1();
    await acceptRequired(token);
    await verifyPhone(token, data.phoneNumber);
    await expect(service.patchStep(token, 1, { ...data, birthDate: '2015-06-01' })).rejects.toThrow(
      /maiores de 18 anos/i,
    );
    const [row] = await adminClient<Array<{ blocks: Record<string, unknown> }>>`
      SELECT blocks FROM anamnesis_sessions WHERE token = ${token}`;
    expect(row.blocks.registration).toBeUndefined();
  });

  it('o código de verificação nunca fica em claro no banco', async () => {
    const { token } = await service.start({});
    const data = step1();
    const before = enqueued.length;
    await service.sendPhoneCode(token, data.phoneNumber);
    const job = enqueued.slice(before).find((j) => j.payload.type === 'PHONE_VERIFICATION');
    if (!job) throw new Error('nenhum código de verificação foi enfileirado');
    const code = job.payload.code as string;
    const [row] = await adminClient<Array<{ hash: string }>>`
      SELECT phone_code_hash AS hash FROM anamnesis_sessions WHERE token = ${token}`;
    expect(row.hash).not.toContain(code);
    expect(row.hash).toHaveLength(64);
    await expect(service.verifyPhoneCode(token, '000000')).rejects.toThrow();
    await service.verifyPhoneCode(token, code);
  });
});

describe('ANAMNESE — PAR-Q de risco', () => {
  it('vira PENDING_REVIEW, sinal de segurança ativo e caso prioritário na fila', async () => {
    const { token } = await service.start({});
    const b1 = await completeStep1(token);
    await completeSteps(service, token, ['Q2']);
    const result = await service.submit(token);
    expect(result.outcome).toBe('PENDING_REVIEW');
    expect(JSON.stringify(result)).not.toMatch(/Q2|BLOQUEADO/);

    const [user] = await adminClient<Array<{ id: string; requires: boolean }>>`
      SELECT id, requires_professional_review AS requires FROM users WHERE phone_number = ${b1.phoneNumber}`;
    expect(user.requires).toBe(true);
    const [signal] = await adminClient<Array<{ kind: string; status: string }>>`
      SELECT kind, status FROM safety_events WHERE user_id = ${user.id}`;
    expect(signal).toMatchObject({ kind: 'PARQ_POSITIVE', status: 'ACTIVE' });
    const [exception] = await adminClient<Array<{ kind: string }>>`
      SELECT kind FROM exception_cases WHERE user_id = ${user.id}`;
    expect(exception?.kind).toBe('SAFETY');
  });
});

describe('ANAMNESE — consentimento de saúde a cada etapa', () => {
  it('sem consentimento de saúde, as etapas seguintes ao cadastro são barradas', async () => {
    const { token } = await service.start({});
    await expect(service.patchStep(token, 2, goals())).rejects.toThrow(/consentimento/i);
    const [row] = await adminClient<Array<{ sensitive: Buffer | null }>>`
      SELECT sensitive FROM anamnesis_sessions WHERE token = ${token}`;
    expect(row.sensitive).toBeNull();
  });
});

describe('ANAMNESE — IDOR e expiração', () => {
  it('token A não acessa a sessão B (retomada é por token)', async () => {
    const a = await service.start({ primaryGoal: 'LOSE_FAT' });
    const b = await service.start({ primaryGoal: 'CONDITIONING' });
    expect((await service.getByToken(a.token)).primaryGoal).toBe('LOSE_FAT');
    expect((await service.getByToken(b.token)).primaryGoal).toBe('CONDITIONING');
  });

  it('sessão expirada vira EXPIRED, descarta o cifrado e não aceita mais escrita', async () => {
    const { token } = await service.start({});
    await completeStep1(token);
    await service.patchStep(token, 2, goals());
    await adminClient`UPDATE anamnesis_sessions SET expires_at = now() - interval '1 hour' WHERE token = ${token}`;
    await expect(service.getByToken(token)).rejects.toThrow(/expirada/i);
    const [row] = await adminClient<Array<{ status: string; sensitive: Buffer | null }>>`
      SELECT status, sensitive FROM anamnesis_sessions WHERE token = ${token}`;
    expect(row).toMatchObject({ status: 'EXPIRED', sensitive: null });
    await expect(service.patchStep(token, 3, modalities())).rejects.toThrow();
    await expect(service.submit(token)).rejects.toThrow();
  });
});

describe('ANAMNESE — RLS anônima isolada por sessão', () => {
  it('escopado à sessão A, a linha órfã de B não é lida nem alterada', async () => {
    const a = await service.start({});
    const b = await service.start({});
    const [{ id: idA }] = await adminClient<Array<{ id: string }>>`
      SELECT id FROM anamnesis_sessions WHERE token = ${a.token}`;
    const [{ id: idB }] = await adminClient<Array<{ id: string }>>`
      SELECT id FROM anamnesis_sessions WHERE token = ${b.token}`;
    const count = (rows: unknown) => (rows as unknown[]).length;
    expect(
      await tenant.runAsTokenScoped(idA, async (tx) =>
        count(await tx.execute(sql`SELECT id FROM anamnesis_sessions WHERE id = ${idA}`)),
      ),
    ).toBe(1);
    expect(
      await tenant.runAsTokenScoped(idA, async (tx) =>
        count(await tx.execute(sql`SELECT id FROM anamnesis_sessions WHERE id = ${idB}`)),
      ),
    ).toBe(0);
    expect(
      await tenant.runAsTokenScoped(idA, async (tx) =>
        count(
          await tx.execute(
            sql`UPDATE anamnesis_sessions SET last_block = 3 WHERE id = ${idB} RETURNING id`,
          ),
        ),
      ),
    ).toBe(0);
  });
});

describe('ANAMNESE COMPLEMENTAR — aluno que já existia', () => {
  it('pré-preenche a parte comum da anamnese antiga e, no envio, cria a versão 2 do objetivo', async () => {
    const { token } = await service.start({});
    const b1 = await completeStep1(token);
    await completeSteps(service, token);
    await service.submit(token);
    const [user] = await adminClient<Array<{ id: string }>>`
      SELECT id FROM users WHERE phone_number = ${b1.phoneNumber}`;
    // Anamnese antiga (3 etapas) do mesmo aluno, para o pré-preenchimento.
    await adminClient`
      INSERT INTO anamnesis_sessions (token, user_id, status, expires_at, submitted_at, data_block_1, data_block_3)
      VALUES (${`legado-${RUN}-${user.id.slice(0, 8)}`}, ${user.id}, 'SUBMITTED', now(), now() - interval '1 day',
        ${adminClient.json({ ...b1 })},
        ${adminClient.json({
          primaryGoal: 'LOSE_FAT',
          emphasis: [],
          hasImportantEvent: false,
          trainingStatus: 'REGULAR',
          experience: 'BEGINNER',
          pastActivities: [],
          consistencyBarriers: [],
          daysPerWeek: 3,
          preferredDays: ['TUE', 'THU', 'SAT'],
          sessionDuration: 'M45_TO_60',
          location: 'HOME',
          preferredPeriod: 'MORNING',
          practicesOtherSport: false,
          hasAvoidedExercise: false,
        })})`;

    const complementary = await service.startComplementary(user.id);
    const view = await service.getByToken(complementary.token);
    expect(view.flow).toBe('COMPLEMENTARY');
    expect(view.blocks).toMatchObject({
      goals: { goal: { primary: 'FAT_LOSS' } },
      routine: { maxSessionsPerWeek: 3 },
    });
    await expect(service.patchStep(complementary.token, 1, step1())).rejects.toThrow(
      /cadastro já existe/,
    );

    await completeSteps(service, complementary.token, [], false);
    const result = await service.submit(complementary.token);
    expect(result.outcome).toBe('READY');

    const goalsAfter = await adminClient<Array<{ version: number; status: string }>>`
      SELECT version, status FROM student_goals WHERE user_id = ${user.id} ORDER BY version`;
    expect(goalsAfter).toEqual([
      { version: 1, status: 'SUPERSEDED' },
      { version: 2, status: 'ACTIVE' },
    ]);
    const [{ users: total }] = await adminClient<Array<{ users: number }>>`
      SELECT count(*)::int AS users FROM users WHERE phone_number = ${b1.phoneNumber}`;
    expect(total).toBe(1);
  });
});
