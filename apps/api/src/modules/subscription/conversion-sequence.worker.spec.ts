import { type Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import { RedisKeyBuilder } from '../../core/redis/redis-key.util';
import { QUEUE } from '../jobs/jobs.config';
import { ConversionSequenceWorker } from './conversion-sequence.worker';
import type { SubscriptionService } from './subscription.service';

const U = '11111111-1111-4111-8111-111111111111';

function make(opts?: { setResult?: 'OK' | null; status?: string }) {
  const enqueue = vi.fn((..._args: unknown[]) => Promise.resolve('job'));
  const queues = { enqueue } as never;
  const workers = { create: vi.fn() } as never;
  const startTrial = vi.fn(() => Promise.resolve({}));
  const getForUser = vi.fn(() =>
    Promise.resolve({ status: opts?.status ?? 'TRIALING', plan: 'MONTHLY' }),
  );
  const subs = { startTrial, getForUser } as unknown as SubscriptionService;
  const config = { whatsapp: { publicSiteUrl: 'https://movivo.test' } } as never;
  const setResult = opts && 'setResult' in opts ? opts.setResult : 'OK';
  const redis = { set: vi.fn(() => Promise.resolve(setResult)) } as never;
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() } as never;
  const worker = new ConversionSequenceWorker(
    workers,
    queues,
    subs,
    config,
    redis,
    new RedisKeyBuilder('movivo') as never,
    logger,
  );
  return { worker, enqueue, startTrial, getForUser };
}

const job = (name: string, data: unknown) => ({ name, data }) as unknown as Job<never>;

describe('ConversionSequenceWorker — trial-start', () => {
  it('cria o trial e agenda os 4 touchpoints com delays crescentes', async () => {
    const { worker, enqueue, startTrial } = make();
    const res = await worker.process(job('trial-start', { userId: U }));
    expect(res.status).toBe('SCHEDULED');
    expect(startTrial).toHaveBeenCalledWith(U);
    const touchpoints = enqueue.mock.calls.filter((c) => c[1] === 'touchpoint');
    expect(touchpoints).toHaveLength(4);
    const delays = touchpoints.map((c) => (c[3] as { delay: number }).delay);
    expect(delays).toEqual([...delays].sort((a, b) => a - b)); // 7<10<13<14
    expect(delays[0]).toBeGreaterThan(0);
  });
});

describe('ConversionSequenceWorker — touchpoint', () => {
  it('envia a mensagem quando ainda em trial', async () => {
    const { worker, enqueue } = make({ status: 'TRIALING' });
    const res = await worker.process(job('touchpoint', { userId: U, key: 'day13' }));
    expect(res.status).toBe('SENT');
    const msg = enqueue.mock.calls.find((c) => c[0] === QUEUE.whatsappOutbound);
    expect(msg).toBeDefined();
    expect((msg?.[2] as { text: string }).text).toContain('https://movivo.test/assinar');
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
