import { describe, expect, it, vi } from 'vitest';

import { SubscriptionPeriodScheduler } from './subscription-period.scheduler';

function make(candidates: string[], expire: (userId: string) => Promise<{ status: string }>) {
  const create = vi.fn();
  const upsertJobScheduler = vi.fn(() => Promise.resolve());
  const queues = { get: vi.fn(() => ({ upsertJobScheduler })) } as never;
  const repo = { findActiveWithEndedPeriod: vi.fn(() => Promise.resolve(candidates)) } as never;
  const expirePeriod = vi.fn(expire);
  const subs = { expirePeriod } as never;
  const logger = { info: vi.fn(), warn: vi.fn(), setContext: vi.fn() };
  return {
    scheduler: new SubscriptionPeriodScheduler(
      { create } as never,
      queues,
      repo,
      subs,
      logger as never,
    ),
    create,
    upsertJobScheduler,
    expirePeriod,
    logger,
  };
}

describe('SubscriptionPeriodScheduler', () => {
  it('registra a varredura horária no fuso de Brasília', async () => {
    const { scheduler, create, upsertJobScheduler } = make([], () =>
      Promise.resolve({ status: 'EXPIRED' }),
    );
    await scheduler.onModuleInit();
    expect(create).toHaveBeenCalledWith('subscription-period-scan', expect.any(Function));
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'subscription-period-scan',
      { pattern: '5 * * * *', tz: 'America/Sao_Paulo' },
      expect.objectContaining({ data: { kind: 'SCAN' } }),
    );
  });

  it('delega a decisão a expirePeriod e conta só quem expirou', async () => {
    const { scheduler, expirePeriod } = make(['u1', 'u2'], (userId) =>
      Promise.resolve({ status: userId === 'u1' ? 'EXPIRED' : 'PERIOD_NOT_ENDED' }),
    );
    const now = new Date('2026-10-23T12:00:00Z');
    await expect(scheduler.scan(now)).resolves.toEqual({ status: 'SCANNED', expired: 1 });
    expect(expirePeriod).toHaveBeenCalledWith('u1', now);
    expect(expirePeriod).toHaveBeenCalledWith('u2', now);
  });

  it('um titular com falha não segura os demais, e a varredura falha para a fila retentar', async () => {
    const { scheduler, expirePeriod, logger } = make(['u1', 'u2'], (userId) =>
      userId === 'u1' ? Promise.reject(new Error('db')) : Promise.resolve({ status: 'EXPIRED' }),
    );
    await expect(scheduler.scan()).rejects.toThrow(/1 falha/);
    expect(expirePeriod).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1' }),
      expect.any(String),
    );
  });
});
