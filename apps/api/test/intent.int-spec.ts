/**
 * Integração — IntentClassifier (US-3.4) contra o stack Docker (PGVector).
 * Pré-requisito: `pnpm run infra:up`.
 *
 * Prova, com I/O real:
 *   · guardrail clínico força FORA_DE_ESCOPO/handoff ANTES de qualquer custo de IA;
 *   · o embedding-kNN classifica uma mensagem coberta pela taxonomia;
 *   · `movivo_app` NÃO escreve em `intent_examples` (corpus read-only).
 */
import 'reflect-metadata';

import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/core/config/load-env';
import { DRIZZLE } from '../src/core/database/database.constants';
import type { DrizzleClient } from '../src/core/database/database.module';
import { intentExamples } from '../src/core/database/schema/intent-examples';
import { users } from '../src/core/database/schema/users';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { IntentClassifier } from '../src/modules/ai-coach/intent/intent-classifier.service';
import { INTENT_EXAMPLES_SEED } from '../src/modules/ai-coach/intent/intent-examples.seed';
import { indexIntentExamples } from '../src/modules/ai-coach/intent/intent-indexer';
import { FakeEmbedding } from '../src/modules/ai-coach/rag/embedding.port';

const { env } = loadEnv();
const migratorSql = postgres({
  host: env.MIGRATION_DATABASE_HOST ?? env.DATABASE_HOST ?? 'localhost',
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432),
  user: env.MIGRATION_DATABASE_USER ?? 'movivo_migrator',
  password: env.MIGRATION_DATABASE_PASSWORD,
  database: env.DATABASE_NAME,
  max: 1,
  idle_timeout: 5,
  onnotice: () => undefined,
});
const migratorDb = drizzle(migratorSql) as unknown as DrizzleClient;

const USER = {
  userId: '11111111-1111-4111-8111-111111111111',
  user: { name: null, phoneNumber: null, email: null },
};

let app: INestApplication;
let classifier: IntentClassifier;
let appDb: DrizzleClient;

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  classifier = app.get(IntentClassifier);
  appDb = app.get<DrizzleClient>(DRIZZLE);

  await migratorDb.delete(intentExamples);
  await indexIntentExamples(migratorDb, INTENT_EXAMPLES_SEED, new FakeEmbedding());

  // `ai_jobs.user_id` tem FK para `users` (Sprint 8/US-8.3): o kNN aproximado (HNSW) do
  // pgvector não garante 100% de acerto em corpus pequeno, então o caminho FALLBACK — que
  // grava `ai_jobs` — precisa de um titular real, mesmo quando o teste espera resolver via
  // KNN puro.
  const tenant = new TenantDatabase(appDb);
  await tenant.runAsSystem((tx) =>
    tx
      .insert(users)
      .values({
        id: USER.userId,
        phoneNumber: '+5511900000001',
        name: 'Usuário de teste (intent.int-spec)',
        role: 'USER',
      })
      .onConflictDoNothing(),
  );
});

afterAll(async () => {
  await migratorDb.delete(intentExamples);
  const tenant = new TenantDatabase(appDb);
  await tenant.runAsSystem(async (tx) => {
    await tx.execute(sql`DELETE FROM ai_jobs WHERE user_id = ${USER.userId}::uuid`);
    await tx.execute(sql`DELETE FROM users WHERE id = ${USER.userId}::uuid`);
  });
  await migratorSql.end({ timeout: 5 });
  await app?.close();
});

describe('IntentClassifier — guardrail antes de custo', () => {
  it('dor grave → FORA_DE_ESCOPO com handoff de segurança', async () => {
    const r = await classifier.classify({ ...USER, message: 'socorro, dor no peito forte' });
    expect(r.intent).toBe('FORA_DE_ESCOPO');
    expect(r.stage).toBe('GUARDRAIL');
    expect(r.safetyHandoff).toBe(true);
  });
});

describe('IntentClassifier — kNN', () => {
  it('classifica uma dúvida técnica coberta pela taxonomia', async () => {
    const r = await classifier.classify({
      ...USER,
      message: 'como faço o agachamento do jeito certo?',
    });
    expect(r.intent).toBe('DUVIDA_TECNICA');
    expect(r.stage).toBe('KNN');
  });
});

describe('intent_examples — corpus read-only', () => {
  it('movivo_app não consegue inserir no corpus (REVOKE)', async () => {
    await expect(
      appDb.insert(intentExamples).values({
        intent: 'DUVIDA_TECNICA',
        text: 'tentativa proibida',
        embedding: new Array<number>(1536).fill(0),
      }),
    ).rejects.toThrow();
  });
});
