/**
 * Banco de verdade para os testes de JORNADA, sem Docker: PGlite (Postgres compilado para WASM,
 * rodando dentro do processo do teste) exposto por socket e acessado pelo MESMO driver de
 * produção (`postgres` + `drizzle-orm/postgres-js`).
 *
 * ## Por que assim
 * A suíte de integração do repositório (`*.int-spec.ts`) exige a stack Docker. As jornadas da
 * agenda flexível dependem de SQL de verdade (unique de idempotência, `jsonb`, delete/update das
 * linhas `PLANNED`, FKs de `workout_access_tokens`/`conversation_followups`, advisory lock), que
 * nenhum mock de Drizzle prova. O PGlite aplica as 76 migrações em ~200 ms.
 *
 * ## RLS
 * As políticas (`buildRlsPoliciesSql`) e os grants mínimos são aplicados como no `db:migrate`,
 * e toda transação do app roda com `SET LOCAL ROLE movivo_app` (sem BYPASSRLS, sem ownership).
 * Se o PGlite recusar alguma etapa, o harness cai para superusuário e avisa em `rls`.
 *
 * ## Onde está o PGlite
 * `@electric-sql/pglite`, `pglite-pgvector` e `pglite-socket` são devDependencies de `apps/api`
 * (versões exatas): `pnpm install` basta, sem Docker. Ver `vitest.journeys.config.mts`.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import type { DrizzleClient } from '../../../src/core/database/database.module';
import {
  buildProfessionalAccessSql,
  buildRlsPoliciesSql,
} from '../../../src/core/database/security-policies';
import { TenantDatabase } from '../../../src/core/database/tenant-database.service';

const API_ROOT = resolve(__dirname, '..', '..', '..');
const APP_ROLE = 'movivo_app';

/** Mesmo conteúdo de `GRANTS_SQL` em `migrate.ts` (lá não é exportado). */
const GRANTS_SQL = `
  GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${APP_ROLE};
  REVOKE CREATE ON SCHEMA public FROM ${APP_ROLE};
`;

/**
 * `pgcrypto` não existe no PGlite. As migrações 0030/0066 chamam `digest()` em UPDATEs de dados
 * (tabelas vazias aqui); o shim só precisa existir para o planner resolver a função.
 */
const PGCRYPTO_SHIM = `
  CREATE OR REPLACE FUNCTION digest(data text, alg text) RETURNS bytea LANGUAGE sql IMMUTABLE
    AS $$ SELECT sha256(convert_to(data, 'UTF8')) $$;
  CREATE OR REPLACE FUNCTION digest(data bytea, alg text) RETURNS bytea LANGUAGE sql IMMUTABLE
    AS $$ SELECT sha256(data) $$;
`;

interface PgliteModules {
  PGlite: {
    create(options: Record<string, unknown>): Promise<PgliteInstance>;
  };
  vector: unknown;
  uuidOssp: unknown;
  PGLiteSocketServer: new (options: Record<string, unknown>) => SocketServer;
}

interface PgliteInstance {
  exec(query: string): Promise<unknown>;
  close(): Promise<void>;
}

interface SocketServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  getServerConn(): string;
}

async function loadModules(): Promise<PgliteModules> {
  const [core, vector, uuid, socket] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite-pgvector'),
    import('@electric-sql/pglite/contrib/uuid_ossp'),
    import('@electric-sql/pglite-socket'),
  ]);
  return {
    PGlite: core.PGlite as unknown as PgliteModules['PGlite'],
    vector: vector.vector,
    uuidOssp: uuid.uuid_ossp,
    PGLiteSocketServer: socket.PGLiteSocketServer as unknown as PgliteModules['PGLiteSocketServer'],
  };
}

async function applyMigrations(db: PgliteInstance): Promise<number> {
  await db.exec(
    'CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS "uuid-ossp";',
  );
  await db.exec(PGCRYPTO_SHIM);
  const folder = join(API_ROOT, 'drizzle');
  const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ tag: string }>;
  };
  for (const entry of journal.entries) {
    const text = readFileSync(join(folder, `${entry.tag}.sql`), 'utf8');
    for (const statement of text.split('--> statement-breakpoint')) {
      if (!statement.trim()) continue;
      try {
        await db.exec(statement);
      } catch (error) {
        throw new Error(`migração ${entry.tag} falhou no PGlite: ${String(error)}`, {
          cause: error,
        });
      }
    }
  }
  return journal.entries.length;
}

/** Tenta reproduzir o modelo de permissões de produção; devolve o motivo se não der. */
async function applySecurity(db: PgliteInstance): Promise<string | null> {
  try {
    await db.exec(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        CREATE ROLE ${APP_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
      END IF;
    END $$;`);
    await db.exec(GRANTS_SQL);
    await db.exec(buildProfessionalAccessSql(APP_ROLE));
    await db.exec(`BEGIN; ${buildRlsPoliciesSql()} COMMIT;`);
    return null;
  } catch (error) {
    return String(error);
  }
}

export interface JourneyDatabase {
  /** Cliente Drizzle com o mesmo driver de produção; transações já rodam como `movivo_app`. */
  drizzle: DrizzleClient;
  /** `TenantDatabase` real sobre esse cliente. */
  tenant: TenantDatabase;
  /** Acesso de superusuário, só para montar fixtures e inspecionar o estado. */
  admin: DrizzleClient;
  /** `null` = RLS e grants de produção ativos; texto = por que não foi possível. */
  rlsUnavailable: string | null;
  migrations: number;
  close(): Promise<void>;
}

/**
 * Faz toda transação do app assumir a role de runtime. `SET LOCAL` vale só até o COMMIT,
 * exatamente como o contexto de tenant (`set_config(..., true)`).
 */
function asAppRole(client: DrizzleClient): DrizzleClient {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property !== 'transaction') return Reflect.get(target, property, receiver);
      return (callback: (tx: unknown) => Promise<unknown>, config?: unknown) =>
        target.transaction(async (tx) => {
          await tx.execute(sql.raw(`SET LOCAL ROLE ${APP_ROLE}`));
          return callback(tx);
        }, config as never);
    },
  });
}

export async function startJourneyDatabase(): Promise<JourneyDatabase> {
  const modules = await loadModules();
  const db = await modules.PGlite.create({
    extensions: { vector: modules.vector, uuid_ossp: modules.uuidOssp },
  });
  const migrations = await applyMigrations(db);
  const rlsUnavailable = await applySecurity(db);

  const server = new modules.PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' });
  await server.start();
  const [host, port] = server.getServerConn().split(':');

  // Uma conexão: o PGlite é single-connection. As transações do app são sequenciais no código
  // testado (nenhuma abre outra por dentro), então isso não esconde concorrência real.
  const client = postgres({
    host,
    port: Number(port),
    database: 'postgres',
    username: 'postgres',
    max: 1,
    prepare: false,
    onnotice: () => undefined,
  });
  const raw = drizzle(client) as DrizzleClient;
  const app = rlsUnavailable ? raw : asAppRole(raw);
  return {
    drizzle: app,
    tenant: new TenantDatabase(app),
    admin: raw,
    rlsUnavailable,
    migrations,
    async close() {
      await client.end({ timeout: 1 });
      await server.stop();
      await db.close();
    },
  };
}
