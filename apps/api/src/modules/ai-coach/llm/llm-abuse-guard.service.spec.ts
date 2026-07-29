/**
 * Unit — LlmAbuseGuard (US-2.2 / TASK-2.2.4 · LLM10). Counter Redis/dia + budget alert.
 */
import { describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../../../core/config';
import type { PinoLogger } from 'nestjs-pino';
import { RedisKeyBuilder } from '../../../core/redis/redis-key.util';
import { LLMAbuseError, LlmAbuseGuard } from './llm-abuse-guard.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function make() {
  const redis = {
    incr: vi.fn(),
    expire: vi.fn().mockResolvedValue(1),
    incrbyfloat: vi.fn(),
  };
  const keys = new RedisKeyBuilder('movivo');
  const config = {
    llm: { userDailyMessageLimit: 3, dailyCostAlertBrl: 0.5 },
  } as unknown as AppConfigService;
  const logger = { setContext: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
  const guard = new LlmAbuseGuard(redis as never, keys, config, logger);
  return { guard, redis, logger };
}

describe('LlmAbuseGuard.check', () => {
  it('incrementa o counter e seta TTL na primeira chamada do dia', async () => {
    const { guard, redis } = make();
    redis.incr.mockResolvedValue(1);
    await guard.check(USER_ID);
    expect(redis.incr).toHaveBeenCalledWith(
      expect.stringContaining(`movivo:u:${USER_ID}:llm-usage`),
    );
    expect(redis.expire).toHaveBeenCalled();
  });

  it('não re-seta TTL em chamadas subsequentes', async () => {
    const { guard, redis } = make();
    redis.incr.mockResolvedValue(2);
    await guard.check(USER_ID);
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('lança LLMAbuseError acima do teto diário', async () => {
    const { guard, redis } = make();
    redis.incr.mockResolvedValue(4); // limite = 3
    await expect(guard.check(USER_ID)).rejects.toBeInstanceOf(LLMAbuseError);
  });
});

describe('LlmAbuseGuard.recordCost', () => {
  it('dispara budget alert acima do baseline', async () => {
    const { guard, redis, logger } = make();
    redis.incrbyfloat.mockResolvedValue('0.75'); // > 0.5
    await guard.recordCost(USER_ID, 0.75);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('não alerta abaixo do baseline', async () => {
    const { guard, redis, logger } = make();
    redis.incrbyfloat.mockResolvedValue('0.10');
    await guard.recordCost(USER_ID, 0.1);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
