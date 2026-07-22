/**
 * `RedisModule` — TASK-0.3.4.
 *
 * Cliente ioredis com **descoberta de master via Sentinel** (ADR-004). A aplicação
 * nunca conecta no master pelo hostname: ela pergunta ao Sentinel, para que um
 * failover não exija redeploy.
 *
 * # `natMap` (README §"Redis com Sentinel")
 * O Sentinel devolve o endereço **anunciado** pelo master, que é o hostname do serviço
 * no Compose (`redis-master:6379`). Dentro da rede `movivo-net` isso resolve; a partir
 * do host (Windows/macOS) não. O `natMap` traduz o endereço anunciado para o que é
 * alcançável em loopback. É um artefato de desenvolvimento — em produção a API roda na
 * mesma rede e o mapa é vazio.
 *
 * Sem lógica de fila: BullMQ é sprint futura. Aqui só conexão, autenticação e ping.
 */
import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis, type RedisOptions } from 'ioredis';

import { AppConfigService } from '../config';
import { REDIS_CLIENT } from './redis.constants';
import { RedisHealthService } from './redis-health.service';
import { REDIS_KEY_BUILDER, RedisKeyBuilder } from './redis-key.util';

/**
 * `natMap` padrão de desenvolvimento, aplicado **apenas** quando todos os Sentinels
 * configurados estão em loopback — isto é, quando a API roda no host. Espelha as
 * portas publicadas pelo Compose (`HOST_REDIS_PORT`/`HOST_REDIS_REPLICA_PORT`).
 */
const LOCAL_NAT_MAP: Record<string, { host: string; port: number }> = {
  'redis-master:6379': { host: '127.0.0.1', port: 6379 },
  'redis-replica:6379': { host: '127.0.0.1', port: 6380 },
};

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function buildRedisOptions(config: AppConfigService): RedisOptions {
  const redis = config.redis;
  const allSentinelsLocal = redis.sentinels.every((sentinel) =>
    LOOPBACK_HOSTS.has(sentinel.host.toLowerCase()),
  );

  const natMap = redis.natMap ?? (allSentinelsLocal ? LOCAL_NAT_MAP : undefined);

  return {
    sentinels: redis.sentinels.map((sentinel) => ({ host: sentinel.host, port: sentinel.port })),
    name: redis.masterName,
    // Senha do master/replica e senha dos Sentinels são chaves distintas por contrato,
    // ainda que hoje apontem para o mesmo Docker Secret.
    password: redis.password,
    sentinelPassword: redis.sentinelPassword,
    db: redis.db,
    ...(natMap ? { natMap } : {}),
    ...(redis.tls ? { tls: {} } : {}),
    // `keyPrefix` do ioredis NÃO é usado de propósito: ele é invisível no código e
    // some em comandos como EVAL/SCAN, escondendo bugs de isolamento. O prefixo é
    // sempre explícito, via RedisKeyBuilder.
    lazyConnect: false,
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
    connectTimeout: 5_000,
    retryStrategy: (attempt: number) => Math.min(attempt * 200, 3_000),
  };
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): Redis => new Redis(buildRedisOptions(config)),
    },
    {
      provide: REDIS_KEY_BUILDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): RedisKeyBuilder =>
        new RedisKeyBuilder(config.redis.keyPrefix),
    },
    RedisHealthService,
  ],
  exports: [REDIS_CLIENT, REDIS_KEY_BUILDER, RedisHealthService],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(private readonly health: RedisHealthService) {}

  async onApplicationShutdown(): Promise<void> {
    await this.health.close();
  }
}
