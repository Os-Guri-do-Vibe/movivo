import { type Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import { RedisKeyBuilder } from '../../core/redis/redis-key.util';
import { QUEUE } from '../jobs/jobs.config';
import { ConversionSequenceWorker } from './conversion-sequence.worker';
import type { SubscriptionService } from './subscription.service';

const U = '11111111-1111-4111-8111-111111111111';

function make(opts?: { guardExists?: boolean; status?: string; trialEndsAt?: Date | null }) {
  let status = opts?.status ?? 'TRIALING';
  const trialEndsAt = opts && 'trialEndsAt' in opts ? opts.trialEndsAt : new Date(Date.now() - 1e6);
  const enqueue = vi.fn((..._args: unknown[]) => Promise.resolve('job'));
  const startTrial = vi.fn(() =>
    Promise.resolve({
      id: 'sub-local-1',
      status,
      plan: 'ANNUAL' as const,
      trialEndsAt: new Date(Date.now() + 7 * 86_400_000),
    }),
  );
  const getForUser = vi.fn(() =>
    Promise.resolve({ id: 'sub-local-1', status, plan: 'ANNUAL' as const, trialEndsAt }),
  );
  const expireTrial = vi.fn(() => {
    if (status !== 'TRIALING' && status !== 'EXPIRED') {
      return Promise.resolve({ status: `SKIP_${status}` });
    }
    if (trialEndsAt && trialEndsAt.getTime() > Date.now()) {
      return Promise.resolve({ status: 'TRIAL_NOT_ENDED' });
    }
    status = 'EXPIRED';
    return Promise.resolve({ status: 'EXPIRED' });
  });
  const createCheckoutLink = vi.fn(() =>
    Promise.resolve('https://movivo.test/assinar/opaque-token'),
  );
  const personaSlotFor = vi.fn(() => Promise.resolve('FEMALE' as const));
  const subs = {
    startTrial,
    getForUser,
    expireTrial,
    createCheckoutLink,
    personaSlotFor,
  } as unknown as SubscriptionService;
  const redis = {
    get: vi.fn(() => Promise.resolve(opts?.guardExists ? '1' : null)),
    set: vi.fn(() => Promise.resolve('OK')),
  } as never;
  const agentPersona = { agentName: vi.fn(async () => 'MOVI') } as never;
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const worker = new ConversionSequenceWorker(
    { create: vi.fn() } as never,
    { enqueue } as never,
    subs,
    agentPersona,
    redis,
    new RedisKeyBuilder('movivo') as never,
    logger as never,
  );
  return {
    worker,
    enqueue,
    startTrial,
    getForUser,
    expireTrial,
    createCheckoutLink,
    personaSlotFor,
    agentPersona,
    logger,
  };
}

const job = (name: string, data: unknown) => ({ name, data }) as unknown as Job<never>;

function sentText(enqueue: { mock: { calls: unknown[][] } }): string | undefined {
  const call = enqueue.mock.calls.find((entry) => entry[0] === QUEUE.whatsappOutbound);
  return (call?.[2] as { text?: string } | undefined)?.text;
}

describe('ConversionSequenceWorker — trial-start', () => {
  it('persiste o plano escolhido e ancora os touchpoints no fim real do trial', async () => {
    const { worker, enqueue, startTrial } = make();
    const result = await worker.process(job('trial-start', { userId: U, plan: 'ANNUAL' }));
    expect(result.status).toBe('SCHEDULED');
    expect(startTrial).toHaveBeenCalledWith(U, 'ANNUAL');
    const touchpoints = enqueue.mock.calls.filter((call) => call[1] === 'touchpoint');
    expect(touchpoints.map((call) => (call[2] as { key: string }).key)).toEqual([
      'day7',
      'day10',
      'day13',
      'day14',
    ]);
    expect(touchpoints.every((call) => (call[3] as { delay: number }).delay > 0)).toBe(true);
  });
});

describe('ConversionSequenceWorker — expiração e checkout', () => {
  it('expira no backend e envia link opaco do contrato originalmente escolhido', async () => {
    const { worker, createCheckoutLink, expireTrial, enqueue } = make();
    const result = await worker.process(job('touchpoint', { userId: U, key: 'day7' }));
    expect(result.status).toBe('SENT');
    expect(expireTrial).toHaveBeenCalledWith(U);
    expect(createCheckoutLink).toHaveBeenCalledWith(U);
    expect(sentText({ mock: enqueue.mock })).toContain('https://movivo.test/assinar/opaque-token');
  });

  it('dia 14 e win-back continuam no plano escolhido, sem downgrade silencioso', async () => {
    const day14 = make({ status: 'EXPIRED' });
    await day14.worker.process(job('touchpoint', { userId: U, key: 'day14' }));
    expect(sentText({ mock: day14.enqueue.mock })).toContain('/assinar/opaque-token');

    const winback = make({ status: 'EXPIRED' });
    await winback.worker.process(job('touchpoint', { userId: U, key: 'winback' }));
    expect(sentText({ mock: winback.enqueue.mock })).toContain('/assinar/opaque-token');
  });

  it('não envia antes de completar os 7 dias', async () => {
    const { worker, enqueue } = make({ trialEndsAt: new Date(Date.now() + 60_000) });
    const result = await worker.process(job('touchpoint', { userId: U, key: 'day7' }));
    expect(result.status).toBe('TRIAL_NOT_ENDED');
    expect(enqueue.mock.calls.some((call) => call[0] === QUEUE.whatsappOutbound)).toBe(false);
  });

  it('assinatura ativa interrompe qualquer nova cobrança do trial', async () => {
    const { worker, createCheckoutLink } = make({ status: 'ACTIVE' });
    const result = await worker.process(job('touchpoint', { userId: U, key: 'day10' }));
    expect(result.status).toBe('SKIP_ACTIVE');
    expect(createCheckoutLink).not.toHaveBeenCalled();
  });

  it('guard já confirmado evita mensagem duplicada', async () => {
    const { worker, createCheckoutLink } = make({ status: 'EXPIRED', guardExists: true });
    const result = await worker.process(job('touchpoint', { userId: U, key: 'day13' }));
    expect(result.status).toBe('ALREADY_SENT');
    expect(createCheckoutLink).not.toHaveBeenCalled();
  });

  it('usa a persona do slot do titular na mensagem', async () => {
    const { worker, personaSlotFor, agentPersona } = make({ status: 'EXPIRED' });
    await worker.process(job('touchpoint', { userId: U, key: 'day13' }));
    expect(personaSlotFor).toHaveBeenCalledWith(U);
    expect(
      (agentPersona as { agentName: ReturnType<typeof vi.fn> }).agentName,
    ).toHaveBeenCalledWith('FEMALE');
  });
});
