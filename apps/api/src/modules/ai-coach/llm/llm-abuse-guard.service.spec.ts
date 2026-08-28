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
    get: vi.fn(),
    set: vi.fn(),
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

  it('conta apenas uma vez as etapas internas da mesma operação', async () => {
    const { guard, redis } = make();
    redis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    redis.incr.mockResolvedValue(1);

    await guard.check(USER_ID, 'mensagem-1');
    await guard.check(USER_ID, 'mensagem-1');

    expect(redis.incr).toHaveBeenCalledOnce();
  });

  it('não deixa retry da mesma operação furar um teto que já foi excedido', async () => {
    const { guard, redis } = make();
    redis.set.mockResolvedValue(null);
    redis.get.mockResolvedValue('4');

    await expect(guard.check(USER_ID, 'mensagem-bloqueada')).rejects.toBeInstanceOf(LLMAbuseError);
    expect(redis.incr).not.toHaveBeenCalled();
  });
});

describe('LlmAbuseGuard.isOverDailyLimit (US-3.5 — peek sem incrementar)', () => {
  it('false abaixo do teto; não incrementa', async () => {
    const { guard, redis } = make();
    redis.get.mockResolvedValue('2'); // limite = 3
    expect(await guard.isOverDailyLimit(USER_ID)).toBe(false);
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('true no teto (o 51º já estourou)', async () => {
    const { guard, redis } = make();
    redis.get.mockResolvedValue('3');
    expect(await guard.isOverDailyLimit(USER_ID)).toBe(true);
  });

  it('counter ausente conta como zero', async () => {
    const { guard, redis } = make();
    redis.get.mockResolvedValue(null);
    expect(await guard.isOverDailyLimit(USER_ID)).toBe(false);
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
