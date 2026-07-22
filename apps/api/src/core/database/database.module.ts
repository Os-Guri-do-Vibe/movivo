/**
 * `DatabaseModule` — TASK-0.3.3.
 *
 * Conexão Drizzle + `postgres.js` **sempre via PgBouncer na 5433**, com a role
 * `movivo_app`. Nesta sprint ainda não há schema (US-0.4); o módulo existe para provar
 * a conectividade e para que os módulos de domínio já tenham onde injetar o client.
 *
 * # Restrições impostas pelo transaction pooling (ADR-003 / ARQUITETURA.md §2, §12.3)
 * O PgBouncer devolve a conexão de servidor ao pool no fim de **cada transação**, o
 * que significa que nada que dependa de estado de sessão sobrevive entre comandos:
 *
 *  - `prepare: false` — **obrigatório**. Prepared statements nomeados vivem na sessão
 *    do servidor; com transaction pooling o próximo comando pode cair noutra conexão
 *    e falhar com `prepared statement "s1" does not exist`.
 *  - **Sem `LISTEN`/`NOTIFY`** e sem `WATCH` — dependem de sessão persistente.
 *  - Contexto de tenant (RLS, Sprints 1-3) usa **`SET LOCAL`** dentro da transação,
 *    nunca `SET`: `SET` vazaria o `user_id` de um titular para a próxima transação
 *    de outro titular que reutilizasse a mesma conexão de servidor. Isso seria uma
 *    quebra de isolamento entre dados de saúde.
 *  - `max` do driver é o teto de conexões de **cliente** contra o PgBouncer; o pool
 *    real de servidor é o `default_pool_size` do PgBouncer.
 */
import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import { AppConfigService } from '../config';
import { DRIZZLE, POSTGRES_CLIENT } from './database.constants';
import { DatabaseHealthService } from './database-health.service';

/** Tipo do client Drizzle exposto por DI. Ganha o genérico do schema na US-0.4. */
export type DrizzleClient = PostgresJsDatabase<Record<string, never>>;

export function createPostgresClient(config: AppConfigService): Sql {
  const database = config.database;

  return postgres({
    host: database.host,
    port: database.port,
    database: database.database,
    username: database.user,
    password: database.password,
    ssl: database.ssl,
    max: database.poolMax,
    connect_timeout: database.connectTimeoutSeconds,
    // NÃO REMOVER. Ver bloco de restrições no topo do arquivo.
    prepare: false,
    // O PgBouncer em transaction mode não repassa parâmetros de sessão arbitrários.
    connection: { application_name: 'movivo-api' },
    onnotice: () => {
      /* notices do Postgres não vão para o log de aplicação: podem conter valores. */
    },
  });
}

@Global()
@Module({
  providers: [
    {
      provide: POSTGRES_CLIENT,
      inject: [AppConfigService],
      useFactory: createPostgresClient,
    },
    {
      provide: DRIZZLE,
      inject: [POSTGRES_CLIENT],
      useFactory: (sql: Sql): DrizzleClient => drizzle(sql),
    },
    DatabaseHealthService,
  ],
  exports: [DRIZZLE, POSTGRES_CLIENT, DatabaseHealthService],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(private readonly health: DatabaseHealthService) {}

  /** Drena o pool no shutdown (casado com `enableShutdownHooks` do `main.ts`). */
  async onApplicationShutdown(): Promise<void> {
    await this.health.close();
  }
}
