/**
 * Opções do cliente Redis — o que importa aqui é (a) sempre descobrir o master pelo
 * Sentinel e (b) o `natMap` de desenvolvimento entrar sozinho quando a API roda no
 * host, sem exigir que cada dev descubra isso na marra (README §"Redis com Sentinel").
 */
import { describe, expect, it } from 'vitest';

import { AppConfigService, type AppConfig } from '../config';
import { buildRedisOptions } from './redis.module';

function configWith(overrides: Partial<AppConfig>): AppConfigService {
  return new AppConfigService({
    REDIS_SENTINEL_HOSTS: [{ host: 'localhost', port: 26379 }],
    REDIS_SENTINEL_MASTER_NAME: 'movivo-master',
    REDIS_PASSWORD: 'senha',
    REDIS_DB: 0,
    REDIS_TLS_ENABLED: false,
    REDIS_KEY_PREFIX: 'movivo',
    ...overrides,
  } as AppConfig);
}

describe('buildRedisOptions', () => {
  it('sempre usa descoberta por Sentinel, nunca host de master fixo', () => {
    const options = buildRedisOptions(configWith({}));
    expect(options.sentinels).toEqual([{ host: 'localhost', port: 26379 }]);
    expect(options.name).toBe('movivo-master');
  });

  it('aplica o natMap de dev quando todos os Sentinels estão em loopback', () => {
    const options = buildRedisOptions(configWith({}));
    expect(options.natMap).toMatchObject({
      'redis-master:6379': { host: '127.0.0.1', port: 6379 },
      'redis-replica:6379': { host: '127.0.0.1', port: 6380 },
    });
  });

  it('não aplica natMap quando os Sentinels são da rede do Compose (API em container)', () => {
    const options = buildRedisOptions(
      configWith({ REDIS_SENTINEL_HOSTS: [{ host: 'redis-sentinel', port: 26379 }] }),
    );
    expect(options.natMap).toBeUndefined();
  });

  it('um natMap explícito em env vence o default de dev', () => {
    const options = buildRedisOptions(
      configWith({ REDIS_NAT_MAP: { 'redis-master:6379': { host: '10.0.0.9', port: 7000 } } }),
    );
    expect(options.natMap).toEqual({ 'redis-master:6379': { host: '10.0.0.9', port: 7000 } });
  });

  it('não usa o keyPrefix do ioredis — o prefixo é sempre explícito via RedisKeyBuilder', () => {
    expect(buildRedisOptions(configWith({})).keyPrefix).toBeUndefined();
  });
});
