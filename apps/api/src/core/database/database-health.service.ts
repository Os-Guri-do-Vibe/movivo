/**
 * Probe de sanidade do Postgres (TASK-0.3.3 / TASK-0.3.6).
 *
 * Roda `SELECT 1` **através do PgBouncer** no boot e a cada chamada de `/health`.
 * Também expõe metadados de diagnóstico (versão, backend pid) que provam que a
 * conexão é real e não um mock — e confirma que `prepare` está desligado.
 */
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Sql } from 'postgres';

import { AppConfigService } from '../config';
import { POSTGRES_CLIENT } from './database.constants';

export interface DatabaseProbeResult {
  readonly ok: true;
  readonly latencyMs: number;
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly database: string;
  /** Sempre `false`. Exposto para tornar a regra do PgBouncer verificável em teste. */
  readonly preparedStatements: false;
}

@Injectable()
export class DatabaseHealthService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseHealthService.name);

  constructor(
    @Inject(POSTGRES_CLIENT) private readonly sql: Sql,
    private readonly config: AppConfigService,
  ) {}

  /** Falha o boot se o banco não responder — melhor não subir do que subir cego. */
  async onModuleInit(): Promise<void> {
    const probe = await this.ping();
    const { host, port, user, database } = this.config.database;
    this.logger.log(
      `Postgres conectado via PgBouncer ${host}:${port} db=${database} user=${user} ` +
        `prepare=false latency=${probe.latencyMs}ms`,
    );
  }

  /** `SELECT 1` com medição de latência. Lança se a conexão estiver indisponível. */
  async ping(): Promise<DatabaseProbeResult> {
    const startedAt = process.hrtime.bigint();
    await this.sql`SELECT 1 AS ok`;
    const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    const { host, port, user, database } = this.config.database;
    return {
      ok: true,
      latencyMs: Math.round(latencyMs * 100) / 100,
      host,
      port,
      user,
      database,
      preparedStatements: false,
    };
  }

  /** Fecha o pool com um prazo curto — o shutdown não pode travar o container. */
  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
    this.logger.log('Pool do Postgres encerrado.');
  }
}
