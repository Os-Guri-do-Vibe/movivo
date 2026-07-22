/**
 * `HealthModule` — TASK-0.3.6.
 *
 * Depende apenas do CORE (`DatabaseHealthService`, `RedisHealthService`, ambos providers
 * globais). Não conhece nenhum módulo de domínio — por isso não pode participar de ciclo.
 */
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller';
import { DatabaseHealthIndicator } from './indicators/database.health-indicator';
import { RedisHealthIndicator } from './indicators/redis.health-indicator';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
