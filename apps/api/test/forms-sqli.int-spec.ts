import { migrationPostgresTls } from '../src/core/database/postgres-tls';
/**
 * Teste DINÂMICO de SQL injection nos formulários de texto livre (check-in semanal e
 * renovação de protocolo) — complementa `anamnesis-pentest.int-spec.ts`, que cobre a anamnese.
 *
 * Roda contra o stack real (Postgres via PgBouncer, como a API em produção), pelas MESMAS
 * services que os controllers chamam. Para cada payload clássico de SQLi nos campos livres:
 *   · o valor é gravado VERBATIM (viu dado, não SQL) — em `jsonb` e no bloco cifrado;
 *   · nenhum efeito colateral: tabelas existem, o titular, o consentimento e o protocolo
 *     continuam como estavam;
 *   · nenhum payload de tempo (`pg_sleep`) atrasa a requisição.
 * E o byte nulo (`\u0000`, que o Postgres não grava) é recusado com 400 na borda, sem alterar
 * a sessão.
 *
 * O diário de treino (`feelingNotes`/`painNotes`) usa o mesmo `HealthCipherService` +
 * parâmetro ligado do bloco cifrado exercitado aqui; não tem teste próprio por exigir um
 * treino em andamento com prescrição.
 *
 * Pré-requisito: `pnpm run infra:up` + `db:migrate` (+ `db:seed`).
 */
import 'reflect-metadata';

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { BadRequestException, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { ProtocolStructure } from '@movivo/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/core/config/load-env';
import { HealthCipherService } from '../src/core/database/health-cipher.service';
import { CheckinService } from '../src/modules/checkin/checkin.service';
import { ProtocolRenewalService } from '../src/modules/protocol-renewal/protocol-renewal.service';
import { ProtocolRepository } from '../src/modules/protocol/protocol.repository';
import { seedHealthEligibility } from './health-fixtures';

const { env } = loadEnv();
const apiRoot = process.cwd();
const RUN = Date.now().toString().slice(-8);

/** Payloads clássicos (estouro de aspas, UNION, stacked, tempo, JSON, aspas unicode). ≤ 100 chars. */
const SQLI_PAYLOADS = [
  "'; DROP TABLE checkins; --",
  "' OR '1'='1",
  '" OR ""="',
  "1'; SELECT pg_sleep(8); --",
  "'; UPDATE users SET status='DELETED'; --",
  "Robert'); DROP TABLE users;--",
  '$$; DELETE FROM consents; $$',
  "\\'; DROP TABLE protocols; --",
  'ʼ OR 1=1 --',
  "%' OR 1=1 --",
  "'||(SELECT version())||'",
  '{"role":"ADMIN"}',
  '"}, "injected": {"a": "',
] as const;

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
  onnotice: () => undefined,
});

const content: ProtocolStructure = {
  promptVersion: 'v1',
  goal: 'GAIN_MUSCLE',
  phase: 'ADAPTACAO',
  phaseDurationWeeks: 3,
  weeklyFrequency: 3,
  sessions: [
    {
      dayLabel: 'A',
      focus: 'Full body',
      exercises: [
        {
          exerciseId: 'goblet_squat',
          name: 'Agachamento',
          sets: 3,
          reps: { min: 8, max: 12 },
          loadStrategy: 'DOUBLE_PROGRESSION',
          restSeconds: 90,
        },
      ],
    },
  ],
};

let app: INestApplication;
let checkins: CheckinService;
let renewals: ProtocolRenewalService;
let protocols: ProtocolRepository;
let cipher: HealthCipherService;

const token = (): string => randomBytes(32).toString('hex'); // 64 chars (ck_*_token_len)

async function seedUserWithProtocol(seq: number): Promise<{ userId: string; protocolId: string }> {
  const phone = `+5543${RUN}${seq}`;
  const [row] = await adminClient<Array<{ id: string }>>`
    INSERT INTO users (phone_number, email)
    VALUES (${phone}, ${`${phone.replace(/\D/g, '')}@example.invalid`}) RETURNING id`;
  if (!row) throw new Error('falha ao criar titular de teste');
  await seedHealthEligibility(adminClient, row.id);
  const { protocolId } = await protocols.persist({
    userId: row.id,
    content,
    constraints: {},
    parqFlags: [],
    approvalStatus: 'AUTO_APPROVED',
    status: 'ACTIVE',
    humanReviewRequired: false,
    totalWeeks: 12,
    generatedBy: 'AI',
    modelVersion: 'gpt-4.1',
    promptVersion: 'v1',
    signed: true,
  } as never);
  return { userId: row.id, protocolId };
}

/** Estado que um SQLi bem-sucedido alteraria: titular, consentimento, protocolo e as tabelas. */
async function integritySnapshot(userId: string) {
  const [snap] = await adminClient<
    Array<{ status: string; consents: number; protocols: number; tables: number }>
  >`
    SELECT
      (SELECT status::text FROM users WHERE id = ${userId}::uuid) AS status,
      (SELECT count(*)::int FROM consents WHERE user_id = ${userId}::uuid) AS consents,
      (SELECT count(*)::int FROM protocols WHERE user_id = ${userId}::uuid) AS protocols,
      (SELECT count(*)::int FROM unnest(ARRAY['users','checkins','consents','protocols',
        'protocol_renewal_sessions']) AS t(name)
        WHERE to_regclass('public.' || t.name) IS NOT NULL) AS tables`;
  if (!snap) throw new Error('snapshot vazio');
  return snap;
}

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  checkins = app.get(CheckinService, { strict: false });
  renewals = app.get(ProtocolRenewalService, { strict: false });
  protocols = app.get(ProtocolRepository, { strict: false });
  cipher = app.get(HealthCipherService, { strict: false });
}, 60_000);

afterAll(async () => {
  try {
    const own = `SELECT id FROM users WHERE phone_number LIKE '+5543${RUN}%'`;
    // Cada DELETE isolado: efeitos colaterais dos workers do app (ai_jobs, alertas) variam.
    for (const table of [
      'checkins',
      'protocol_renewal_sessions',
      'handoff_alerts',
      'ai_jobs',
      'protocol_versions',
      'protocols',
      'consents',
      'professional_assignments',
    ]) {
      await adminClient
        .unsafe(`DELETE FROM ${table} WHERE user_id IN (${own})`)
        .catch(() => undefined);
    }
    await adminClient
      .unsafe(`DELETE FROM users WHERE phone_number LIKE '+5543${RUN}%'`)
      .catch(() => undefined);
  } finally {
    await app?.close();
    await adminClient.end({ timeout: 5 });
  }
}, 60_000);

describe('SQLi dinâmico — check-in semanal', () => {
  it('cada payload nos três campos livres é gravado verbatim, sem efeito colateral nem atraso', async () => {
    const { userId, protocolId } = await seedUserWithProtocol(1);
    const before = await integritySnapshot(userId);

    for (const [index, payload] of SQLI_PAYLOADS.entries()) {
      const sessionToken = token();
      await adminClient`
        INSERT INTO checkins (user_id, protocol_id, week_number, token, status, expires_at, sent_at)
        VALUES (${userId}::uuid, ${protocolId}::uuid, ${index + 1}, ${sessionToken}, 'PENDING',
                now() + interval '7 days', now())`;

      const startedAt = Date.now();
      await expect(
        checkins.submit(sessionToken, {
          sleepQuality: 'BOA',
          mood: 'FELIZ',
          nutritionScore: 7,
          adherenceScore: 8,
          difficultExerciseDescription: payload,
          changesNoticed: ['OUTRAS'],
          changesOther: payload,
          durationFit: 'ADEQUADA',
          improvementFeedback: payload,
        }),
      ).resolves.toEqual({ status: 'SUBMITTED' });
      // `pg_sleep(8)` executado seria visível aqui; o submit normal leva milissegundos.
      expect(Date.now() - startedAt).toBeLessThan(5_000);

      const [row] = await adminClient<
        Array<{ answers: { changesOther?: string }; notes_cipher: Buffer; status: string }>
      >`SELECT answers, notes_cipher, status::text AS status FROM checkins WHERE token = ${sessionToken}`;
      expect(row?.status).toBe('SUBMITTED');
      expect(row?.answers.changesOther).toBe(payload);
      const notes = JSON.parse(await cipher.decryptHealth(row?.notes_cipher as Buffer)) as {
        difficultExerciseDescription?: string;
        improvementFeedback?: string;
      };
      expect(notes.difficultExerciseDescription).toBe(payload);
      expect(notes.improvementFeedback).toBe(payload);

      expect(await integritySnapshot(userId)).toEqual(before);
    }
  }, 120_000);

  it('byte nulo é recusado com 400 e a sessão continua pendente', async () => {
    const { userId, protocolId } = await seedUserWithProtocol(2);
    const sessionToken = token();
    await adminClient`
      INSERT INTO checkins (user_id, protocol_id, week_number, token, status, expires_at, sent_at)
      VALUES (${userId}::uuid, ${protocolId}::uuid, 1, ${sessionToken}, 'PENDING',
              now() + interval '7 days', now())`;

    await expect(
      checkins.submit(sessionToken, {
        sleepQuality: 'BOA',
        mood: 'FELIZ',
        nutritionScore: 7,
        adherenceScore: 8,
        changesNoticed: [],
        durationFit: 'ADEQUADA',
        improvementFeedback: 'dor no ombro\u0000 ao supino',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const [row] = await adminClient<Array<{ status: string }>>`
      SELECT status::text AS status FROM checkins WHERE token = ${sessionToken}`;
    expect(row?.status).toBe('PENDING');
  });
});

describe('SQLi dinâmico — renovação de protocolo (fim de ciclo)', () => {
  async function seedRenewalSession(seq: number) {
    const { userId, protocolId } = await seedUserWithProtocol(seq);
    const sessionToken = token();
    await adminClient`
      INSERT INTO protocol_renewal_sessions (user_id, previous_protocol_id, token, status, expires_at)
      VALUES (${userId}::uuid, ${protocolId}::uuid, ${sessionToken}, 'IN_PROGRESS',
              now() + interval '14 days')`;
    return { userId, sessionToken };
  }

  it('texto livre dos blocos 3 (cifrado) e 5 (jsonb) é gravado verbatim, sem efeito colateral', async () => {
    const { userId, sessionToken } = await seedRenewalSession(3);
    const before = await integritySnapshot(userId);

    for (const payload of SQLI_PAYLOADS) {
      const startedAt = Date.now();
      await renewals.patchStep(sessionToken, 5, {
        changes: ['NONE'],
        preferredDays: [],
        dislikedExercise: { has: true, description: payload },
        barriers: ['OTHER'],
        barrierOther: payload,
        goalChange: { changed: true, newGoal: 'OTHER', newGoalOther: payload },
      });
      await renewals.patchStep(sessionToken, 3, {
        newPain: {
          hasNewPain: true,
          region: 'OTHER',
          regionOther: payload,
          intensity: 3,
          trend: 'STABLE',
          soughtCare: false,
        },
        parqRecheck: { changedToYes: true, detail: payload },
      });
      expect(Date.now() - startedAt).toBeLessThan(5_000);

      const [row] = await adminClient<
        Array<{
          description: string;
          barrier_other: string;
          goal_other: string;
          block3: Buffer;
        }>
      >`
        SELECT data_block_5 -> 'dislikedExercise' ->> 'description' AS description,
               data_block_5 ->> 'barrierOther' AS barrier_other,
               data_block_5 -> 'goalChange' ->> 'newGoalOther' AS goal_other,
               data_block_3 AS block3
          FROM protocol_renewal_sessions WHERE token = ${sessionToken}`;
      expect(row?.description).toBe(payload);
      expect(row?.barrier_other).toBe(payload);
      expect(row?.goal_other).toBe(payload);
      const block3 = JSON.parse(await cipher.decryptHealth(row?.block3 as Buffer)) as {
        newPain: { regionOther?: string };
        parqRecheck: { detail?: string };
      };
      expect(block3.newPain.regionOther).toBe(payload);
      expect(block3.parqRecheck.detail).toBe(payload);

      expect(await integritySnapshot(userId)).toEqual(before);
    }
  }, 120_000);

  it('byte nulo é recusado com 400 e o bloco não é alterado', async () => {
    const { sessionToken } = await seedRenewalSession(4);
    await expect(
      renewals.patchStep(sessionToken, 5, {
        changes: ['NONE'],
        preferredDays: [],
        dislikedExercise: { has: true, description: 'leg press\u0000' },
        barriers: [],
        goalChange: { changed: false },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const [row] = await adminClient<Array<{ block5: unknown }>>`
      SELECT data_block_5 AS block5 FROM protocol_renewal_sessions WHERE token = ${sessionToken}`;
    expect(row?.block5).toBeNull();
  });
});
