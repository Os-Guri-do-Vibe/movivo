/**
 * Teste-semente (b) — migração num Postgres LIMPO (US-0.8 / TASK-0.8.3, valida US-0.4).
 *
 * Não basta checar que as 9 tabelas existem no banco de dev (que já foi migrado ao vivo):
 * isso não provaria que `0000_init` aplica-se do zero. Este teste cria um banco
 * **descartável** dentro do Postgres do Compose, aplica a migração versionada nele com a
 * role `movivo_migrator` e só então conta as 9 tabelas-base. Ao final, derruba o banco.
 *
 * Extensões (`vector`, `uuid-ossp`, `pgcrypto`) são criadas pelo superusuário — `pgvector`
 * não é uma extensão "trusted", então `movivo_migrator` não poderia criá-la sozinha; no
 * fluxo real quem as instala é o init do container (infra/postgres/init/01-extensions.sql).
 * Aqui reproduzimos essa pré-condição antes de migrar.
 *
 * Pré-requisito: `pnpm run infra:up`.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadEnv } from '../src/core/config/load-env';

/** As 9 tabelas-base do schema lógico de Lucas (§9) materializadas na US-0.4. */
const EXPECTED_TABLES = [
  'users',
  'anamnesis_sessions',
  'consents',
  'protocols',
  'protocol_versions',
  'conversations',
  'checkins',
  'subscriptions',
  'ai_jobs',
] as const;

const REQUIRED_EXTENSIONS = ['vector', 'uuid-ossp', 'pgcrypto'] as const;

const apiRoot = process.cwd();
const { env } = loadEnv();

const host = env.MIGRATION_DATABASE_HOST ?? env.DATABASE_HOST ?? 'localhost';
const port = Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432);
const migratorUser = env.MIGRATION_DATABASE_USER ?? 'movivo_migrator';
const migratorPassword = env.MIGRATION_DATABASE_PASSWORD;

// O superusuário instala extensões não-trusted e cria/derruba o banco descartável.
// Senha lida direto do Docker Secret (fora do schema de env da aplicação). Strip de BOM
// (U+FEFF) protege contra um secret editado à mão no Windows.
const superUser = 'postgres';
const superPassword = readFileSync(
  resolve(apiRoot, '..', '..', 'secrets', 'postgres_superuser_password'),
  'utf8',
).trimEnd();

const throwawayDb = `movivo_it_${Date.now()}`;

function connect(database: string, user: string, password: string | undefined) {
  return postgres({
    host,
    port,
    user,
    password,
    database,
    ssl: false,
    max: 1,
    idle_timeout: 5,
    onnotice: () => {
      /* notices do Postgres podem conter valores — nunca vão para o log do teste. */
    },
  });
}

beforeAll(async () => {
  const admin = connect('postgres', superUser, superPassword);
  try {
    await admin.unsafe(`CREATE DATABASE "${throwawayDb}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }

  // Prepara o banco limpo: extensões + posse do schema para o migrador (espelha o init).
  const setup = connect(throwawayDb, superUser, superPassword);
  try {
    for (const ext of REQUIRED_EXTENSIONS) {
      await setup.unsafe(`CREATE EXTENSION IF NOT EXISTS "${ext}"`);
    }
    await setup.unsafe(`ALTER SCHEMA public OWNER TO "${migratorUser}"`);
    await setup.unsafe(`GRANT ALL ON SCHEMA public TO "${migratorUser}"`);
    await setup.unsafe(`GRANT CREATE ON DATABASE "${throwawayDb}" TO "${migratorUser}"`);
  } finally {
    await setup.end({ timeout: 5 });
  }
}, 60_000);

afterAll(async () => {
  const admin = connect('postgres', superUser, superPassword);
  try {
    // Encerra conexões remanescentes antes do DROP.
    await admin.unsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${throwawayDb}' AND pid <> pg_backend_pid()`,
    );
    await admin.unsafe(`DROP DATABASE IF EXISTS "${throwawayDb}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }
});

describe('migração 0000_init num Postgres limpo', () => {
  it('aplica a migração versionada como movivo_migrator e cria exatamente as 9 tabelas-base', async () => {
    const client = connect(throwawayDb, migratorUser, migratorPassword);
    try {
      await migrate(drizzle(client), { migrationsFolder: resolve(apiRoot, 'drizzle') });

      const rows = await client<{ table_name: string }[]>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `;
      const present = rows.map((r) => r.table_name);

      for (const table of EXPECTED_TABLES) {
        expect(present, `tabela ausente: ${table}`).toContain(table);
      }
      // Nenhuma tabela-base a mais no schema de domínio (o bookkeeping do drizzle
      // vive no schema `drizzle`, não em `public`).
      expect(present).toHaveLength(EXPECTED_TABLES.length);
    } finally {
      await client.end({ timeout: 5 });
    }
  });
});
