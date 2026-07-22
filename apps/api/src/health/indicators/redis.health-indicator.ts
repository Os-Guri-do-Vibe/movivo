/**
 * Indicador de saúde do Redis para o Terminus — `PING` no master descoberto pelo
 * Sentinel. O campo `master` prova que a descoberta ocorreu; `sentinels` documenta
 * de quem a resposta veio. Nenhuma senha é exposta.
 */
import { Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';

import { RedisHealthService } from '../../core/redis';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly indicator: HealthIndicatorService,
    private readonly redis: RedisHealthService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const session = this.indicator.check(key);
    try {
      const probe = await this.redis.ping();
      return session.up({
        latencyMs: probe.latencyMs,
        masterName: probe.masterName,
        master: probe.master,
        sentinels: probe.sentinels,
        via: 'sentinel',
      });
    } catch (error) {
      return session.down({
        message: error instanceof Error ? error.message : 'falha desconhecida no Redis',
      });
    }
  }
}
