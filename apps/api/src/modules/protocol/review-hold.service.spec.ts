import { describe, expect, it, vi } from 'vitest';

import { RedisKeyBuilder } from '../../core/redis/redis-key.util';
import {
  REVIEW_HOLD_TTL_SECONDS,
  REVIEW_RECHECK_MS,
  ReviewHoldService,
  type ReviewHoldTarget,
} from './review-hold.service';

const USER = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const PROTOCOL: ReviewHoldTarget = { kind: 'PROTOCOL', userId: USER, id: ID };
const SUBSTITUTION: ReviewHoldTarget = { kind: 'SUBSTITUTION', userId: USER, id: ID };

/** Redis em memória com o mínimo que o serviço usa (TTL ignorado, `NX` respeitado). */
function build() {
  const store = new Map<string, string>();
  const redis = {
    set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    getdel: vi.fn(async (key: string) => {
      const value = store.get(key) ?? null;
      store.delete(key);
      return value;
    }),
  };
  const enqueue = vi.fn(async () => 'job-1');
  const service = new ReviewHoldService(redis as never, new RedisKeyBuilder('movivo'), {
    enqueue,
  } as never);
  return { service, redis, enqueue };
}

describe('ReviewHoldService', () => {
  it('hold renova a trava com validade e isHeld a enxerga', async () => {
    const { service, redis } = build();
    expect(await service.isHeld(PROTOCOL)).toBe(false);
    await service.hold(PROTOCOL);
    expect(await service.isHeld(PROTOCOL)).toBe(true);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining(ID),
      '1',
      'EX',
      REVIEW_HOLD_TTL_SECONDS,
    );
  });

  it('a trava é por item: segurar um protocolo não segura outro, nem uma troca de mesmo id', async () => {
    const { service } = build();
    await service.hold(PROTOCOL);
    expect(await service.isHeld({ ...PROTOCOL, id: '33333333-3333-4333-8333-333333333333' })).toBe(
      false,
    );
    expect(await service.isHeld(SUBSTITUTION)).toBe(false);
  });

  it('PROTOCOL: o envio adiado volta para a fila do protocolo, com o formato do job dele', async () => {
    const { service, enqueue } = build();
    await service.deferRelease(PROTOCOL);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      'protocol-auto-release',
      'auto-release',
      { userId: USER, protocolId: ID },
      {
        delay: REVIEW_RECHECK_MS,
        jobId: expect.stringMatching(new RegExp(`^auto-release-${ID}-hold-\\d+$`)),
      },
    );
  });

  it('SUBSTITUTION: o envio adiado volta para a fila da troca, com o formato do job dela', async () => {
    const { service, enqueue } = build();
    await service.deferRelease(SUBSTITUTION);
    expect(enqueue).toHaveBeenCalledWith(
      'protocol-substitution-release',
      'substitution-release',
      { userId: USER, requestId: ID },
      {
        delay: REVIEW_RECHECK_MS,
        jobId: expect.stringMatching(new RegExp(`^substitution-auto-release-${ID}-hold-\\d+$`)),
      },
    );
  });

  it('jobs concorrentes não multiplicam a corrente de rechecagens', async () => {
    const { service, enqueue } = build();
    await service.deferRelease(PROTOCOL);
    await service.deferRelease(PROTOCOL);
    await service.deferRelease(PROTOCOL);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('protocolo e troca de mesmo id têm correntes e pendências independentes', async () => {
    const { service, enqueue } = build();
    await service.deferRelease(PROTOCOL);
    await service.deferRelease(SUBSTITUTION);
    expect(enqueue).toHaveBeenCalledTimes(2);

    enqueue.mockClear();
    expect(await service.release(PROTOCOL)).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect((enqueue.mock.calls[0] as unknown[])[0]).toBe('protocol-auto-release');
    // A pendência da troca continua lá, intacta.
    expect(await service.release(SUBSTITUTION)).toBe(true);
  });

  it('release com envio vencido adiado: solta a trava e dispara AGORA (sem atraso)', async () => {
    const { service, enqueue } = build();
    await service.hold(SUBSTITUTION);
    await service.deferRelease(SUBSTITUTION);
    enqueue.mockClear();

    expect(await service.release(SUBSTITUTION)).toBe(true);
    expect(await service.isHeld(SUBSTITUTION)).toBe(false);
    expect(enqueue).toHaveBeenCalledTimes(1);
    const options = (enqueue.mock.calls[0] as unknown[])[3] as { delay?: number; jobId: string };
    expect(options.delay).toBeUndefined();
    expect(options.jobId).toMatch(new RegExp(`^substitution-auto-release-${ID}-leave-\\d+$`));
  });

  it('release sem envio vencido (prazo ainda não chegou) só solta a trava, não dispara nada', async () => {
    const { service, enqueue } = build();
    await service.hold(PROTOCOL);
    expect(await service.release(PROTOCOL)).toBe(false);
    expect(await service.isHeld(PROTOCOL)).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('o envio adiado só dispara uma vez: um segundo release não repete', async () => {
    const { service, enqueue } = build();
    await service.deferRelease(PROTOCOL);
    enqueue.mockClear();
    expect(await service.release(PROTOCOL)).toBe(true);
    expect(await service.release(PROTOCOL)).toBe(false);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
