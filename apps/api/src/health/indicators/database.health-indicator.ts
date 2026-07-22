/**
 * Indicador de saúde do Postgres para o Terminus.
 *
 * Delegado ao `DatabaseHealthService`, que executa `SELECT 1` via PgBouncer. O detalhe
 * `port: 5433` publicado aqui é intencional: torna verificável, num teste automatizado
 * ou numa inspeção manual, que a aplicação não regrediu para a 5432 (ARQUITETURA §12.3).
 */
import { Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';

import { DatabaseHealthService } from '../../core/database';

@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly indicator: HealthIndicatorService,
    private readonly database: DatabaseHealthService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const session = this.indicator.check(key);
    try {
      const probe = await this.database.ping();
      return session.up({
        latencyMs: probe.latencyMs,
        host: probe.host,
        port: probe.port,
        database: probe.database,
        user: probe.user,
        via: 'pgbouncer',
        preparedStatements: probe.preparedStatements,
      });
    } catch (error) {
      // Mensagem de driver pode conter host/usuário, nunca a senha — o postgres.js não
      // a inclui. Ainda assim, só o `message` é propagado, jamais o objeto de conexão.
      return session.down({
        message: error instanceof Error ? error.message : 'falha desconhecida no Postgres',
      });
    }
  }
}
