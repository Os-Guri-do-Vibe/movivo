import { describe, expect, it, vi } from 'vitest';

import { SubscriptionPeriodScheduler } from './subscription-period.scheduler';

const NOTICE = {
  firstName: 'Ana',
  planLabel: 'Mensal',
  periodEnd: new Date('2026-10-23T12:00:00Z'),
  checkoutUrl: 'https://movivo.test/checkout/XcTJFfnN',
  cancelUrl: 'https://movivo.test/cancelar/XcTJFfnN',
};

function make(
  candidates: string[],
  expire: (userId: string) => Promise<{ status: string }>,
  notice: () => Promise<typeof NOTICE | null> = () => Promise.resolve(NOTICE),
) {
  const create = vi.fn();
  const upsertJobScheduler = vi.fn(() => Promise.resolve());
  const enqueue = vi.fn((..._args: unknown[]) => Promise.resolve('job'));
  const queues = { get: vi.fn(() => ({ upsertJobScheduler })), enqueue } as never;
  const repo = { findActiveWithEndedPeriod: vi.fn(() => Promise.resolve(candidates)) } as never;
  const expirePeriod = vi.fn(expire);
  const periodEndedNotice = vi.fn(notice);
  const subs = { expirePeriod, periodEndedNotice } as never;
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
    periodEndedNotice,
    enqueue,
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

  it('avisa no WhatsApp quem teve o plano encerrado, e só quem expirou', async () => {
    const { scheduler, enqueue, periodEndedNotice } = make(['u1', 'u2'], (userId) =>
      Promise.resolve({ status: userId === 'u1' ? 'EXPIRED' : 'PERIOD_NOT_ENDED' }),
    );
    await scheduler.scan(new Date('2026-10-23T12:00:00Z'));
    expect(periodEndedNotice).toHaveBeenCalledTimes(1);
    expect(periodEndedNotice).toHaveBeenCalledWith('u1');
    expect(enqueue).toHaveBeenCalledTimes(1);
    const [queue, name, job] = enqueue.mock.calls[0] as [
      string,
      string,
      { userId: string; type: string; text: string; dedupeId: string },
    ];
    expect(queue).toBe('whatsapp-outbound');
    expect(name).toBe('plan-ended');
    expect(job).toMatchObject({
      userId: 'u1',
      type: 'COACH_MESSAGE',
      dedupeId: 'plan-ended_2026-10-23T12:00:00.000Z',
    });
    expect(job.text).toContain('*Ana*, seu plano *mensal* MOVIVO chegou ao fim. 💚');
    expect(job.text).toContain('https://movivo.test/checkout/XcTJFfnN');
    expect(job.text).toContain('https://movivo.test/cancelar/XcTJFfnN');
  });

  it('falha ao montar o aviso não derruba a varredura nem os demais titulares', async () => {
    const { scheduler, enqueue, logger } = make(
      ['u1', 'u2'],
      () => Promise.resolve({ status: 'EXPIRED' }),
      () => Promise.reject(new Error('redis')),
    );
    await expect(scheduler.scan()).resolves.toEqual({ status: 'SCANNED', expired: 2 });
    expect(enqueue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });
});
