/**
 * Probe do Redis (TASK-0.3.4 / TASK-0.3.6): `PING` através do master descoberto pelo
 * Sentinel, com latência e endereço efetivo do master — o que prova que a descoberta
 * aconteceu de verdade e não que apenas há "um Redis" atendendo.
 */
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { AppConfigService } from '../config';
import { REDIS_CLIENT } from './redis.constants';

export interface RedisProbeResult {
  readonly ok: true;
  readonly latencyMs: number;
  readonly masterName: string;
  /**
   * Endereço do socket efetivamente conectado. Vem do socket, não da configuração —
   * é o que prova que a descoberta pelo Sentinel (e o `natMap`, quando a API roda no
   * host) resolveu de verdade, em vez de termos caído num Redis qualquer.
   */
  readonly master: string;
  readonly sentinels: readonly string[];
}

@Injectable()
export class RedisHealthService implements OnModuleInit {
  private readonly logger = new Logger(RedisHealthService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: AppConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const probe = await this.ping();
    this.logger.log(
      `Redis conectado via Sentinel (master="${probe.masterName}" em ${probe.master}) ` +
        `latency=${probe.latencyMs}ms`,
    );
  }

  async ping(): Promise<RedisProbeResult> {
    const startedAt = process.hrtime.bigint();
    const pong = await this.redis.ping();
    const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    if (pong !== 'PONG') {
      throw new Error(`resposta inesperada do Redis ao PING: "${pong}"`);
    }

    const redisConfig = this.config.redis;

    return {
      ok: true,
      latencyMs: Math.round(latencyMs * 100) / 100,
      masterName: redisConfig.masterName,
      master: this.connectedPeer(),
      sentinels: redisConfig.sentinels.map((sentinel) => `${sentinel.host}:${sentinel.port}`),
    };
  }

  /**
   * `host:porta` do socket TCP em uso. `redis.options.host` NÃO serve aqui: em modo
   * Sentinel o ioredis mantém ali o default (`localhost:6379`) e resolve o master no
   * connector, então aquele campo reportaria um endereço que nunca foi usado.
   */
  private connectedPeer(): string {
    const socket = (
      this.redis as unknown as { stream?: { remoteAddress?: string; remotePort?: number } }
    ).stream;
    if (!socket?.remoteAddress) return 'desconhecido';
    return `${socket.remoteAddress}:${socket.remotePort ?? 0}`;
  }

  async close(): Promise<void> {
    await this.redis.quit();
    this.logger.log('Conexão Redis encerrada.');
  }
}
