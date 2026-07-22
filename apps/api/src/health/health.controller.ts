/**
 * `GET /api/v1/health` — TASK-0.3.6.
 *
 * Checa as duas dependências duras do runtime: Postgres **através do PgBouncer (5433)**
 * e Redis **através do Sentinel**. Um `up` aqui significa que houve I/O de verdade
 * contra os dois — não é um `return 200` decorativo.
 *
 * # Regras
 *  - A resposta **nunca** expõe segredo, senha ou string de conexão (SECURITY.md §1).
 *    Host, porta, usuário e nome do banco são metadados operacionais, não credenciais.
 *  - O endpoint não exige autenticação: é consumido pelo healthcheck do Docker, pelo
 *    load balancer e pelo smoke test de Mariana (US-0.8). Por isso mesmo, o que ele
 *    devolve precisa ser inócuo para quem não está autenticado.
 *  - Falha de dependência ⇒ **503**, com o detalhe de qual indicador caiu.
 */
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, type HealthCheckResult } from '@nestjs/terminus';

import { DatabaseHealthIndicator } from './indicators/database.health-indicator';
import { RedisHealthIndicator } from './indicators/redis.health-indicator';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.database.isHealthy('db'),
      () => this.redis.isHealthy('redis'),
    ]);
  }
}
