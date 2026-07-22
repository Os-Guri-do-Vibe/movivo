/**
 * Configuração do `drizzle-kit` (TASK-0.4.2).
 *
 * ## Por que a migração NÃO passa pelo PgBouncer
 * O runtime da aplicação fala com o Postgres exclusivamente pela **5433**
 * (PgBouncer em transaction mode — ADR-003). A migração é a única exceção
 * deliberada e usa **conexão direta** (`MIGRATION_DATABASE_*`), por duas razões
 * técnicas, não de conveniência:
 *
 *  1. `drizzle-kit` usa **advisory locks de sessão** para serializar migrações
 *     concorrentes. Em transaction pooling, cada statement pode cair numa
 *     conexão de backend diferente, então o lock seria adquirido numa sessão e
 *     liberado (ou perdido) em outra.
 *  2. DDL com `CREATE TYPE`/`CREATE EXTENSION` e statements multi-comando não
 *     sobrevivem bem ao rebind de sessão do pooler.
 *
 * Isso **não** viola a regra §12.3 do `ARQUITETURA.md`, que trata do caminho de
 * conexão *da aplicação*. Ver README, seção de banco de dados.
 *
 * ## Papéis
 * A migração roda como **`movivo_migrator`** (dono do schema `public`). A role
 * de runtime `movivo_app` não é dona de nada e não pode criar objeto — é o que
 * mantém válida a premissa das políticas `FORCE ROW LEVEL SECURITY` das
 * próximas sprints (Sato §9).
 */
import { defineConfig } from 'drizzle-kit';

import { loadEnv } from './src/core/config/load-env';

const { env } = loadEnv();

/**
 * Conexão de migração. Cai para os valores de runtime **exceto** a porta: usar a
 * 5433 aqui é justamente o erro que este arquivo existe para evitar, então a
 * ausência de `MIGRATION_DATABASE_PORT` é um erro explícito, não um default
 * silencioso.
 */
const host = env.MIGRATION_DATABASE_HOST ?? env.DATABASE_HOST;
const port = env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT;
const user = env.MIGRATION_DATABASE_USER ?? 'movivo_migrator';
const password = env.MIGRATION_DATABASE_PASSWORD;
const database = env.DATABASE_NAME;

function required(name: string, value: string | undefined): string {
  if (value === undefined || value === '') {
    throw new Error(
      `[drizzle.config] ${name} ausente. A migração usa conexão DIRETA ao Postgres ` +
        `(não o PgBouncer da 5433) com a role movivo_migrator. ` +
        `Defina MIGRATION_DATABASE_* em apps/api/.env — ver .env.example e README.`,
    );
  }
  return value;
}

if (port !== undefined && Number(port) === 5433) {
  throw new Error(
    '[drizzle.config] MIGRATION_DATABASE_PORT aponta para 5433 (PgBouncer). ' +
      'A migração exige conexão direta ao Postgres — ver o cabeçalho deste arquivo.',
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/core/database/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: {
    host: required('MIGRATION_DATABASE_HOST', host),
    port: Number(required('MIGRATION_DATABASE_PORT', port)),
    user: required('MIGRATION_DATABASE_USER', user),
    password: required('MIGRATION_DATABASE_PASSWORD', password),
    database: required('DATABASE_NAME', database),
    ssl: false,
  },
  verbose: true,
  strict: true,
});
