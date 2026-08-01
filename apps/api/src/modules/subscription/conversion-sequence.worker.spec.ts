import { type Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import { RedisKeyBuilder } from '../../core/redis/redis-key.util';
import { QUEUE } from '../jobs/jobs.config';
import { ConversionSequenceWorker } from './conversion-sequence.worker';
import type { SubscriptionService } from './subscription.service';

const U = '11111111-1111-4111-8111-111111111111';

function make(opts?: { setResult?: 'OK' | null; status?: string; trialEndsAt?: Date | null }) {
  const enqueue = vi.fn((..._args: unknown[]) => Promise.resolve('job'));
  const queues = { enqueue } as never;
  const workers = { create: vi.fn() } as never;
  const startTrial = vi.fn(() => Promise.resolve({}));
  const getForUser = vi.fn(() =>
    Promise.resolve({
      status: opts?.status ?? 'TRIALING',
      plan: 'ANNUAL',
      trialEndsAt: opts && 'trialEndsAt' in opts ? opts.trialEndsAt : new Date(Date.now() + 1e9),
    }),
  );
  const subs = { startTrial, getForUser } as unknown as SubscriptionService;
  const config = { whatsapp: { publicSiteUrl: 'https://movivo.test' } } as never;
  const setResult = opts && 'setResult' in opts ? opts.setResult : 'OK';
  const redis = { set: vi.fn(() => Promise.resolve(setResult)) } as never;
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const worker = new ConversionSequenceWorker(
    workers,
    queues,
    subs,
    config,
    redis,
    new RedisKeyBuilder('movivo') as never,
    logger as never,
  );
  return { worker, enqueue, startTrial, getForUser, logger };
}

const job = (name: string, data: unknown) => ({ name, data }) as unknown as Job<never>;

/** Texto do outbound enfileirado. */
function sentText(enqueue: { mock: { calls: unknown[][] } }): string | undefined {
  const c = enqueue.mock.calls.find((x) => x[0] === QUEUE.whatsappOutbound);
  return (c?.[2] as { text?: string } | undefined)?.text;
}

describe('ConversionSequenceWorker — trial-start', () => {
  it('cria o trial e agenda 5 touchpoints (7/10/13/14 + winback)', async () => {
    const { worker, enqueue, startTrial } = make();
    const res = await worker.process(job('trial-start', { userId: U }));
    expect(res.status).toBe('SCHEDULED');
    expect(startTrial).toHaveBeenCalledWith(U);
    const touchpoints = enqueue.mock.calls.filter((c) => c[1] === 'touchpoint');
    expect(touchpoints).toHaveLength(5);
    const keys = touchpoints.map((c) => (c[2] as { key: string }).key);
    expect(keys).toEqual(['day7', 'day10', 'day13', 'day14', 'winback']);
    expect(touchpoints.every((c) => (c[3] as { delay: number }).delay > 0)).toBe(true);
  });
});

describe('ConversionSequenceWorker — nurture / downgrade', () => {
  it('dia 13 envia o link no plano pré-selecionado', async () => {
    const { worker, enqueue } = make({ status: 'TRIALING' });
    const res = await worker.process(job('touchpoint', { userId: U, key: 'day13' }));
    expect(res.status).toBe('SENT');
    expect(sentText({ mock: enqueue.mock })).toContain(`/assinar/${U}?plano=ANNUAL`);
  });

  it('dia 14 é downgrade: link no plano Mensal + evento downgrade_offered', async () => {
    const { worker, enqueue, logger } = make({ status: 'TRIALING' });
    const res = await worker.process(job('touchpoint', { userId: U, key: 'day14' }));
    expect(res.status).toBe('SENT');
    expect(sentText({ mock: enqueue.mock })).toContain(`/assinar/${U}?plano=MONTHLY`);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'downgrade_offered' }),
      expect.anything(),
    );
  });

  it('para de nutrir quem já converteu (ACTIVE) — não envia', async () => {
    const { worker, enqueue } = make({ status: 'ACTIVE' });
    const res = await worker.process(job('touchpoint', { userId: U, key: 'day10' }));
    expect(res.status).toBe('SKIP_ACTIVE');
    expect(enqueue.mock.calls.some((c) => c[0] === QUEUE.whatsappOutbound)).toBe(false);
  });

  it('idempotente: guard já setado → ALREADY_SENT sem checar assinatura', async () => {
    const { worker, getForUser } = make({ setResult: null });
    const res = await worker.process(job('touchpoint', { userId: U, key: 'day7' }));
    expect(res.status).toBe('ALREADY_SENT');
    expect(getForUser).not.toHaveBeenCalled();
  });
});

describe('ConversionSequenceWorker — win-back (US-4.4)', () => {
  it('trial vencido sem conversão → envia win-back (link Mensal) + winback_sent', async () => {
    const { worker, enqueue, logger } = make({
      status: 'TRIALING',
      trialEndsAt: new Date(Date.now() - 1e6),
    });
    const res = await worker.process(job('touchpoint', { userId: U, key: 'winback' }));
    expect(res.status).toBe('SENT');
    expect(sentText({ mock: enqueue.mock })).toContain(`/assinar/${U}?plano=MONTHLY`);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'winback_sent' }),
      expect.anything(),
    );
  });

  it('trial ainda vigente → não dispara win-back', async () => {
    const { worker, enqueue } = make({
      status: 'TRIALING',
      trialEndsAt: new Date(Date.now() + 1e9),
    });
    const res = await worker.process(job('touchpoint', { userId: U, key: 'winback' }));
    expect(res.status).toBe('TRIAL_NOT_ENDED');
    expect(enqueue.mock.calls.some((c) => c[0] === QUEUE.whatsappOutbound)).toBe(false);
  });

  it('quem converteu (ACTIVE) não recebe win-back', async () => {
    const { worker } = make({ status: 'ACTIVE', trialEndsAt: new Date(Date.now() - 1e6) });
    const res = await worker.process(job('touchpoint', { userId: U, key: 'winback' }));
    expect(res.status).toBe('SKIP_ACTIVE');
  });
});
