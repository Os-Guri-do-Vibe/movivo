/**
 * Unit — `TokenDenylistService` (US-1.4): revogação de jti por TTL no Redis.
 */
import { describe, expect, it, vi } from 'vitest';

import { RedisKeyBuilder } from '../../core/redis/redis-key.util';
import { TokenDenylistService } from './token-denylist.service';

const JTI = '11111111-1111-4111-8111-111111111111';

function make() {
  const redis = { set: vi.fn(), exists: vi.fn() };
  const keys = new RedisKeyBuilder('movivo');
  const service = new TokenDenylistService(redis as never, keys);
  return { redis, service };
}

describe('TokenDenylistService.revoke', () => {
  it('grava a chave com TTL = janela restante do token', async () => {
    const { redis, service } = make();
    let capturedTtl: number | undefined;
    redis.set.mockImplementation((_k: string, _v: string, _ex: string, ttl: number) => {
      capturedTtl = ttl;
      return Promise.resolve('OK');
    });
    const until = Math.floor(Date.now() / 1000) + 100;
    await service.revoke(JTI, until);
    expect(redis.set).toHaveBeenCalledWith(
      `movivo:g:jwt-denylist:${JTI}`,
      '1',
      'EX',
      expect.any(Number),
    );
    expect(capturedTtl).toBeGreaterThan(90);
    expect(capturedTtl).toBeLessThanOrEqual(100);
  });

  it('não grava nada quando o token já expirou (TTL <= 0)', async () => {
    const { redis, service } = make();
    await service.revoke(JTI, Math.floor(Date.now() / 1000) - 10);
    expect(redis.set).not.toHaveBeenCalled();
  });
});

describe('TokenDenylistService.isRevoked', () => {
  it('true quando a chave existe, false caso contrário', async () => {
    const { redis, service } = make();
    redis.exists.mockResolvedValueOnce(1);
    expect(await service.isRevoked(JTI)).toBe(true);
    redis.exists.mockResolvedValueOnce(0);
    expect(await service.isRevoked(JTI)).toBe(false);
  });
});
