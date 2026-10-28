/**
 * Integração — StudentStateReader. Pré-requisito: `pnpm run infra:up`.
 *
 * Prova com Postgres real que as fatias do Estado do Aluno saem montadas a partir das tabelas,
 * sem PII direta, e que registros de saúde só aparecem decifrados com consentimento ativo.
 */
import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { inArray } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CONSENT_TEXTS } from '@movivo/shared';

import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/core/config/load-env';
import { HealthCipherService } from '../src/core/database/health-cipher.service';
import { migrationPostgresTls } from '../src/core/database/postgres-tls';
import {
  bodyMeasurements,
  safetyEvents,
  studentConstraints,
  studentGoals,
  studentHealthRecords,
  studentPreferences,
  studentProfiles,
  users,
} from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { StudentStateModule } from '../src/modules/student-state/student-state.module';
import { StudentStateReader } from '../src/modules/student-state/student-state.reader';

const { env } = loadEnv();
const admin = postgres({
  host: env.MIGRATION_DATABASE_HOST ?? 'localhost',
  ssl: migrationPostgresTls(env, env.MIGRATION_DATABASE_HOST ?? 'localhost'),
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432),
  user: 'postgres',
  password: readFileSync(
    resolve(process.cwd(), '../../secrets/desenvolvimento/postgres_superuser_password'),
    'utf8',
  ).trimEnd(),
  database: env.DATABASE_NAME ?? 'movivo',
  max: 1,
  onnotice: () => {
    /* Notices SQL não devem registrar valores da fixture. */
  },
});

let app: INestApplication;
let db: TenantDatabase;
let reader: StudentStateReader;
const created: string[] = [];
const NOW = new Date('2026-11-04T12:00:00.000Z');

async function createStudent(name: string): Promise<string> {
  const phone = `+55119${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const cipher = app.get(HealthCipherService);
  const payload = await cipher.encryptHealth(
    JSON.stringify({
      summary: 'Condromalácia no joelho direito',
      region: 'joelho',
      movementTags: ['KNEE_DEEP_FLEXION'],
    }),
  );
  const userId = await db.runAsSystem(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        phoneNumber: phone,
        email: `${phone.replace(/\D/g, '')}@example.invalid`,
        name,
        biologicalSex: 'MALE',
      })
      .returning({ id: users.id });
    if (!user) throw new Error('falha ao criar aluno');
    await tx.insert(studentProfiles).values({
      userId: user.id,
      profile: {
        birthDate: '1996-05-10',
        heightCm: 178,
        modalities: [
          {
            modality: 'STRENGTH',
            level: 'INTERMEDIATE',
            monthsPracticing: 30,
            sessionsPerWeek: 3,
            wantsToStart: false,
          },
        ],
        externalSports: [],
        venues: ['FULL_GYM'],
        lifeContext: {
          occupationRhythm: 'REGULAR',
          cookingCapacity: 'BASIC',
          mealsOutsideHomePerWeek: 5,
          foodBudget: 'MODERATE',
        },
      },
    });
    await tx.insert(studentGoals).values({
      userId: user.id,
      version: 1,
      declared: { primary: 'HYPERTROPHY', secondary: ['BODY_DEFINITION'], emphasis: 'AESTHETICS' },
      startedOn: '2026-11-01',
    });
    await tx.insert(studentConstraints).values({
      userId: user.id,
      kind: 'AVAILABILITY',
      constraint: {
        kind: 'AVAILABILITY',
        windows: [{ weekday: 'MON', slot: 'EVENING', maxMinutes: 50 }],
        variesWeekly: true,
        maxSessionsPerWeek: 3,
      },
      origin: 'DECLARED',
      validFrom: '2026-11-01',
    });
    await tx.insert(studentPreferences).values({
      userId: user.id,
      domain: 'EXERCISE',
      key: 'exercise:agachamento_livre',
      value: 'DISLIKES',
      strength: 'STRONG',
      origin: 'DECLARED',
      confidence: 90,
    });
    await tx.insert(bodyMeasurements).values([
      { userId: user.id, kind: 'WAIST', value: 98, method: 'SELF_TAPE', measuredOn: '2026-10-01' },
      { userId: user.id, kind: 'WAIST', value: 96, method: 'SELF_TAPE', measuredOn: '2026-11-01' },
    ]);
    await tx.insert(studentHealthRecords).values({
      userId: user.id,
      kind: 'INJURY',
      payload,
      origin: 'DECLARED',
    });
    await tx.insert(safetyEvents).values({
      userId: user.id,
      kind: 'PERSISTENT_PAIN',
      severity: 'ATTENTION',
      scope: 'TRAINING',
      detectedBy: 'RULE',
      evidence: 'dor no joelho há 2 semanas',
    });
    return user.id;
  });
  created.push(userId);
  return userId;
}

beforeAll(async () => {
  app = await NestFactory.create(
    { module: class TestRoot {}, imports: [AppModule, StudentStateModule] },
    { logger: false },
  );
  await app.init();
  db = app.get(TenantDatabase);
  reader = app.get(StudentStateReader);
});

afterAll(async () => {
  if (created.length > 0) {
    await admin`DELETE FROM consents WHERE user_id = ANY(${created}::uuid[])`;
    await db.runAsSystem((tx) => tx.delete(users).where(inArray(users.id, created)));
  }
  await admin.end();
  await app?.close();
});

describe('StudentStateReader', () => {
  it('monta as fatias pedidas a partir das tabelas, sem PII direta', async () => {
    const userId = await createStudent('Fulano de Tal Teste');
    const { slices } = await reader.read(
      userId,
      ['identity', 'goals', 'availability', 'preferences', 'body', 'adherence'],
      NOW,
    );
    expect(slices.identity).toMatchObject({ ageYears: 30, biologicalSex: 'MALE', heightCm: 178 });
    expect(slices.goals).toMatchObject({ declared: { primary: 'HYPERTROPHY' }, strategy: null });
    expect(slices.availability).toEqual([
      expect.objectContaining({ kind: 'AVAILABILITY', maxSessionsPerWeek: 3 }),
    ]);
    expect(slices.preferences).toEqual([
      expect.objectContaining({ key: 'exercise:agachamento_livre', value: 'DISLIKES' }),
    ]);
    expect(slices.body).toMatchObject({ WAIST: { latest: 96, previous: 98 } });
    expect(slices.adherence).toMatchObject({ planned: 0, rate: null });
    const serialized = JSON.stringify(slices);
    expect(serialized).not.toContain('Fulano');
    expect(serialized).not.toContain('1996-05-10');
  });

  it('registro de saúde só sai decifrado com consentimento de saúde ativo', async () => {
    const userId = await createStudent('Ciclano Teste');
    const without = await reader.read(userId, ['safety'], NOW);
    expect(without.slices.safety).toMatchObject({ healthConsent: false, healthRecords: [] });
    expect(JSON.stringify(without.slices.safety)).toContain('PERSISTENT_PAIN');

    await admin`
      INSERT INTO consents (user_id, consent_type, version, accepted)
      VALUES (${userId}::uuid, 'HEALTH_DATA', ${CONSENT_TEXTS.HEALTH_DATA.version}, true)`;
    const withConsent = await reader.read(userId, ['safety'], NOW);
    expect(withConsent.slices.safety).toMatchObject({
      healthConsent: true,
      healthRecords: [{ kind: 'INJURY', region: 'joelho', movementTags: ['KNEE_DEEP_FLEXION'] }],
    });
  });
});
