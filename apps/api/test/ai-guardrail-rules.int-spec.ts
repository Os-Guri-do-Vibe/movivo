/** Integração real: guardrails L1 são append-only e o banco só admite a ação FLAG. */
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/core/config/load-env';
import type { DrizzleClient } from '../src/core/database/database.module';
import { TenantDatabase } from '../src/core/database/tenant-database.service';

const { env } = loadEnv();
const RUN = Date.now().toString().slice(-8);
const RULE_KEY = randomUUID();
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
    /* Notices não entram no log do teste. */
  },
});
const tenant = new TenantDatabase(drizzle(appClient) as unknown as DrizzleClient);
const migratorClient = postgres({
  host: env.MIGRATION_DATABASE_HOST ?? 'localhost',
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432),
  user: env.MIGRATION_DATABASE_USER ?? 'movivo_migrator',
  password: env.MIGRATION_DATABASE_PASSWORD,
  database: env.DATABASE_NAME ?? 'movivo',
  ssl: false,
  max: 1,
  prepare: false,
  idle_timeout: 5,
  onnotice: () => {
    /* Notices não entram no log do teste. */
  },
});
let authorId = '';

beforeAll(async () => {
  authorId = await tenant.runAsSystem(async (tx) => {
    const rows = (await tx.execute(
      sql`INSERT INTO users (phone_number, name) VALUES (${`+5553${RUN}7`}, 'Autor L1 imutável') RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    return rows[0].id;
  });
}, 30_000);

afterAll(async () => {
  await appClient.end({ timeout: 5 });
  await migratorClient.end({ timeout: 5 });
});

describe('ai_guardrail_rules — contrato e imutabilidade no banco', () => {
  it('permite publicar uma versão FLAG pela role de runtime', async () => {
    await appClient`
      INSERT INTO ai_guardrail_rules (
        rule_key, label, scope, phrases, action, version, status, change_note, created_by
      ) VALUES (
        ${RULE_KEY}::uuid, 'Regra histórica', 'BOTH', ${JSON.stringify(['frase de teste'])}::jsonb,
        'FLAG', 1, 'RETIRED', 'teste de integração', ${authorId}::uuid
      )
    `;
    const [row] = await appClient<{ action: string }[]>`
      SELECT action FROM ai_guardrail_rules WHERE rule_key = ${RULE_KEY}::uuid
    `;
    expect(row?.action).toBe('FLAG');
  });

  it('recusa BLOCK no próprio tipo do banco', async () => {
    await expect(appClient`
      INSERT INTO ai_guardrail_rules (
        rule_key, label, scope, phrases, action, version, status, change_note, created_by
      ) VALUES (
        ${randomUUID()}::uuid, 'Inválida', 'BOTH', '[]'::jsonb,
        'BLOCK', 1, 'RETIRED', 'ação inválida', ${authorId}::uuid
      )
    `).rejects.toMatchObject({ code: '22P02' });
  });

  it.each([
    [
      'UPDATE',
      () =>
        appClient`UPDATE ai_guardrail_rules SET label = 'alterada' WHERE rule_key = ${RULE_KEY}::uuid`,
    ],
    ['DELETE', () => appClient`DELETE FROM ai_guardrail_rules WHERE rule_key = ${RULE_KEY}::uuid`],
    ['TRUNCATE', () => appClient`TRUNCATE ai_guardrail_rules`],
  ])('%s pela role de runtime falha com 42501', async (_operation, mutation) => {
    await expect(mutation()).rejects.toMatchObject({ code: '42501' });
  });

  it('trigger barra UPDATE da role de migration com 55000', async () => {
    await expect(
      migratorClient`UPDATE ai_guardrail_rules SET label = 'alterada' WHERE rule_key = ${RULE_KEY}::uuid`,
    ).rejects.toMatchObject({ code: '55000', message: expect.stringContaining('append-only') });
  });
});
