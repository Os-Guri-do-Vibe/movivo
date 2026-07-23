/**
 * Runner de migração (TASK-0.4.2 / TASK-0.4.3).
 *
 * Roda como **`movivo_migrator`** por conexão **direta** ao Postgres (nunca pelo
 * PgBouncer da 5433 — ver o cabeçalho de `drizzle.config.ts`).
 *
 * Faz duas coisas, nesta ordem:
 *  1. aplica as migrações versionadas de `./drizzle`;
 *  2. reaplica os **grants mínimos** de `movivo_app` (TASK-0.4.3).
 *
 * O passo 2 é parte do runner, e não de um SQL solto na migração, porque toda
 * migração futura que criar tabela precisa que os grants sejam reconciliados —
 * caso contrário a role de runtime perde acesso à tabela nova e a falha só
 * aparece em produção. Aqui isso é idempotente e automático.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { loadEnv } from '../config/load-env';
import { buildRlsPoliciesSql, RLS_TENANT_TABLES } from './security-policies';

/**
 * Raiz de `apps/api`. Usamos `process.cwd()` — e não `import.meta.url` ou
 * `__dirname` — porque o script é compilado no bundle CommonJS do NestJS
 * (onde `import.meta` é proibido) mas executado via `tsx` a partir do
 * workspace. `pnpm --filter @movivo/api` sempre posiciona o cwd em `apps/api`,
 * o mesmo pressuposto que `loadEnv()` já faz para achar o `.env`.
 */
const apiRoot = process.cwd();

const { env } = loadEnv();

const host = env.MIGRATION_DATABASE_HOST ?? env.DATABASE_HOST;
const port = Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT);
const user = env.MIGRATION_DATABASE_USER ?? 'movivo_migrator';
const password = env.MIGRATION_DATABASE_PASSWORD;
const database = env.DATABASE_NAME;
const appRole = env.DATABASE_USER ?? 'movivo_app';

if (!host || !Number.isFinite(port) || !user || !password || !database) {
  throw new Error(
    '[db:migrate] Configuração de migração incompleta. Defina MIGRATION_DATABASE_* ' +
      'em apps/api/.env (ver .env.example e README). A migração usa conexão DIRETA, não a 5433.',
  );
}

if (port === 5433) {
  throw new Error(
    '[db:migrate] A porta de migração aponta para o PgBouncer (5433). ' +
      'Advisory locks de sessão não sobrevivem a transaction pooling — use a porta direta do Postgres.',
  );
}

/**
 * Grants mínimos de runtime (TASK-0.4.3).
 *
 * Princípio: `movivo_app` **usa** os dados e não **governa** o schema. Ela recebe
 * DML nas tabelas e USAGE nas sequences, e nada além disso — sem ownership, sem
 * CREATE, sem `BYPASSRLS`. É essa ausência de privilégio que faz as políticas
 * `FORCE ROW LEVEL SECURITY` das próximas sprints serem inescapáveis (Sato §9):
 * uma role dona da tabela ou com BYPASSRLS ignoraria a RLS silenciosamente.
 *
 * `ALTER DEFAULT PRIVILEGES` garante que tabelas criadas por migrações futuras
 * já nasçam com o grant correto.
 */
const GRANTS_SQL = (role: string) => `
  GRANT USAGE ON SCHEMA public TO ${role};
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role};
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role};
  -- EXECUTE nas funções do schema (inclui pgp_sym_encrypt/decrypt do pgcrypto,
  -- usadas pelo HealthCipherService — US-1.1/TASK-1.1.3). O init já concede em
  -- dev; reafirmar aqui cobre bancos provisionados fora do init (RDS/staging).
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${role};

  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role};
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO ${role};
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO ${role};

  -- Reafirma o que a role NÃO pode: criar objeto no schema.
  REVOKE CREATE ON SCHEMA public FROM ${role};
`;

/**
 * Extensões exigidas pelo schema lógico (TASK-0.4.2).
 *
 * `vector` — PGVector, base do RAG (sprint do AI Coach).
 * `uuid-ossp` — referenciada pelo schema lógico de Lucas; mantida por
 *   compatibilidade, embora as PKs usem `gen_random_uuid()` do core (ver `_shared.ts`).
 * `pgcrypto` — cifra em repouso das colunas de saúde marcadas `LGPD Art. 11`
 *   (implementada na sprint de anamnese, não aqui).
 *
 * ## Por que aqui e não dentro de `0000_init.sql`
 * O `drizzle-kit` não emite `CREATE EXTENSION`, então a linha teria de ser
 * inserida à mão no SQL gerado — e seria **silenciosamente perdida** na primeira
 * vez que alguém regenerasse a migração. No runner, a garantia é idempotente e
 * sobrevive a qualquer `db:generate`. Vale para bancos que não passaram pelo
 * init do container (RDS, staging, testcontainers da US-0.8).
 */
const REQUIRED_EXTENSIONS = ['vector', 'uuid-ossp', 'pgcrypto'] as const;

async function ensureExtensions(sql: postgres.Sql): Promise<void> {
  const present = await sql<{ extname: string }[]>`SELECT extname FROM pg_extension`;
  const have = new Set(present.map((row) => row.extname));

  for (const ext of REQUIRED_EXTENSIONS) {
    if (have.has(ext)) continue;
    try {
      await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS "${ext}"`);
      console.log(`[db:migrate] Extensão "${ext}" criada.`);
    } catch (error) {
      throw new Error(
        `[db:migrate] Extensão "${ext}" ausente e não pôde ser criada por ${user}. ` +
          'Crie-a com um papel privilegiado (o init do container já faz isso em dev — ver infra/postgres/init).',
        { cause: error },
      );
    }
  }
  console.log(`[db:migrate] Extensões OK: ${REQUIRED_EXTENSIONS.join(', ')}.`);
}

async function main(): Promise<void> {
  const sql = postgres({
    host,
    port,
    user,
    password,
    database,
    ssl: false,
    max: 1,
    // Migração é DDL: o runner é single-shot e não deve manter conexão ociosa.
    idle_timeout: 5,
    onnotice: () => {
      /* notices do Postgres não vão para o log: podem conter valores. */
    },
  });

  try {
    await ensureExtensions(sql);

    console.log(`[db:migrate] Aplicando migrações em ${user}@${host}:${port}/${database} …`);
    await migrate(drizzle(sql), { migrationsFolder: resolve(apiRoot, 'drizzle') });
    console.log('[db:migrate] Migrações aplicadas.');

    console.log(`[db:migrate] Reconciliando grants mínimos de ${appRole} …`);
    await sql.unsafe(GRANTS_SQL(appRole));
    console.log('[db:migrate] Grants aplicados.');

    // Row-Level Security (US-1.1 / Sato §4): ENABLE+FORCE + políticas por tenant.
    // Idempotente e reaplicada a cada migração — mesma disciplina dos grants.
    console.log('[db:migrate] Reconciliando políticas RLS (FORCE) das tabelas de titular …');
    await sql.unsafe(buildRlsPoliciesSql());
    console.log(`[db:migrate] RLS FORCE ativa em: ${RLS_TENANT_TABLES.join(', ')}.`);

    // Prova de que o modelo de permissões continua íntegro após a migração.
    const [check] = await sql<{ bypassrls: boolean; owns: number }[]>`
      SELECT
        (SELECT rolbypassrls FROM pg_roles WHERE rolname = ${appRole}) AS bypassrls,
        (SELECT count(*)::int FROM pg_tables
          WHERE schemaname = 'public' AND tableowner = ${appRole}) AS owns
    `;

    if (check?.bypassrls) {
      throw new Error(`[db:migrate] VIOLAÇÃO: ${appRole} tem BYPASSRLS (ARQUITETURA.md §12.13).`);
    }
    if (check && check.owns > 0) {
      throw new Error(
        `[db:migrate] VIOLAÇÃO: ${appRole} é dona de ${check.owns} tabela(s). ` +
          'A role de runtime não pode ter ownership (Sato §9).',
      );
    }
    console.log(`[db:migrate] OK — ${appRole}: BYPASSRLS=false, tabelas próprias=0.`);

    // Prova de que a RLS não é decorativa: toda tabela de titular precisa estar
    // com relrowsecurity (ENABLE) E relforcerowsecurity (FORCE) — sem FORCE, o
    // dono da tabela (movivo_migrator) contornaria a RLS silenciosamente (Sato §4.2).
    const rls = await sql<{ table: string; enabled: boolean; forced: boolean }[]>`
      SELECT relname AS table, relrowsecurity AS enabled, relforcerowsecurity AS forced
      FROM pg_class
      WHERE relname = ANY(${RLS_TENANT_TABLES}) AND relkind = 'r'
    `;
    const notForced = rls.filter((r) => !r.enabled || !r.forced).map((r) => r.table);
    const missing = RLS_TENANT_TABLES.filter((t) => !rls.some((r) => r.table === t));
    if (notForced.length > 0 || missing.length > 0) {
      throw new Error(
        `[db:migrate] VIOLAÇÃO RLS: sem ENABLE+FORCE em [${[...notForced, ...missing].join(', ')}] ` +
          '(Sato §4.2). O isolamento entre titulares de dado de saúde estaria aberto.',
      );
    }
    console.log(`[db:migrate] OK — RLS ENABLE+FORCE confirmada em ${rls.length} tabela(s).`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// Sanidade: falha cedo se a pasta de migrações não existir.
try {
  readFileSync(resolve(apiRoot, 'drizzle', 'meta', '_journal.json'), 'utf8');
} catch {
  throw new Error(
    '[db:migrate] Nenhuma migração encontrada em apps/api/drizzle. Rode `pnpm --filter @movivo/api db:generate` antes.',
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
