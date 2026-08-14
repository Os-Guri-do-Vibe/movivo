/** Prova as duas barreiras append-only do FAQ: privilégio da role e trigger do banco. */
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
const FAQ_KEY = randomUUID();

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
    /* O teste não registra notices que possam carregar valores. */
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
    /* O teste não registra notices que possam carregar valores. */
  },
});

let authorId = '';

beforeAll(async () => {
  authorId = await tenant.runAsSystem(async (tx) => {
    const rows = (await tx.execute(
      sql`INSERT INTO users (phone_number, name) VALUES (${`+5554${RUN}8`}, 'Autor FAQ imutável') RETURNING id`,
    )) as unknown as Array<{ id: string }>;
    return rows[0].id;
  });
}, 30_000);

afterAll(async () => {
  await appClient.end({ timeout: 5 });
  await migratorClient.end({ timeout: 5 });
});

describe('faq_entries — append-only imposto no banco', () => {
  it('permite INSERT pela role de runtime', async () => {
    await appClient`
      INSERT INTO faq_entries (
        faq_key, canonical_question, normalized_question, answer,
        version, status, change_note, created_by
      ) VALUES (
        ${FAQ_KEY}::uuid, ${`Pergunta imutável ${RUN}?`}, ${`pergunta imutável ${RUN}`},
        'Resposta histórica de teste.', 1, 'RETIRED', 'teste de integração', ${authorId}::uuid
      )
    `;
    const [row] = await appClient<{ version: number }[]>`
      SELECT version FROM faq_entries WHERE faq_key = ${FAQ_KEY}::uuid
    `;
    expect(row?.version).toBe(1);
  });

  it.each([
    [
      'UPDATE',
      () => appClient`UPDATE faq_entries SET answer = 'alterada' WHERE faq_key = ${FAQ_KEY}::uuid`,
    ],
    ['DELETE', () => appClient`DELETE FROM faq_entries WHERE faq_key = ${FAQ_KEY}::uuid`],
    ['TRUNCATE', () => appClient`TRUNCATE faq_entries`],
  ])('%s pela role de runtime é barrado com 42501', async (_operation, mutation) => {
    await expect(mutation()).rejects.toMatchObject({ code: '42501' });
  });

  it('UPDATE pela role de migration é barrado pelo trigger com 55000', async () => {
    await expect(
      migratorClient`UPDATE faq_entries SET answer = 'alterada' WHERE faq_key = ${FAQ_KEY}::uuid`,
    ).rejects.toMatchObject({ code: '55000', message: expect.stringContaining('append-only') });

    const [row] = await appClient<{ answer: string }[]>`
      SELECT answer FROM faq_entries WHERE faq_key = ${FAQ_KEY}::uuid
    `;
    expect(row?.answer).toBe('Resposta histórica de teste.');
  });

  it('runtime não detém UPDATE, DELETE nem TRUNCATE', async () => {
    const rows = await appClient<{ privilege_type: string }[]>`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE table_name = 'faq_entries'
        AND grantee = current_user
        AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')
    `;
    expect(rows).toEqual([]);
  });
});
