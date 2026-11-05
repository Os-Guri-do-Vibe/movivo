import { afterEach, describe, expect, it, vi } from 'vitest';

import { RedisKeyBuilder } from '../redis/redis-key.util';
import {
  ForbiddenTopicsService,
  ForbiddenTopicsUnavailableError,
} from './forbidden-topics.service';

const APPROVED = [
  {
    topicKey: 'concorrentes',
    label: 'Concorrentes',
    phrases: ['preços do concorrente'],
    version: 2,
    status: 'APPROVED',
  },
];

function make(load: () => Promise<unknown[]> = async () => APPROVED) {
  const orderBy = vi.fn(load);
  const from = vi.fn(() => ({ orderBy }));
  const db = { select: vi.fn(() => ({ from })) };
  const redis = {
    publish: vi.fn(async () => 1),
    duplicate: vi.fn(),
  };
  const logger = { setContext: vi.fn(), warn: vi.fn() };
  const service = new ForbiddenTopicsService(
    db as never,
    redis as never,
    new RedisKeyBuilder('movivo'),
    logger as never,
  );
  return { service, orderBy, logger };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ForbiddenTopicsService', () => {
  it('casa por palavras inteiras mesmo com Unicode invisível', async () => {
    const { service } = make();
    await expect(service.evaluate('compare preços do con\u200Bcorrente')).resolves.toEqual({
      topicKey: 'concorrentes',
      label: 'Concorrentes',
      version: 2,
    });
    await expect(service.evaluate('o concorrente dormiu')).resolves.toBeNull();
  });

  it('fecha a geração em cold start sem banco', async () => {
    const { service } = make(async () => {
      throw new Error('database unavailable');
    });
    await expect(service.activeTopics()).rejects.toBeInstanceOf(ForbiddenTopicsUnavailableError);
  });

  it('mantém a última lista válida quando a atualização falha', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const { service } = make(async () => {
      calls += 1;
      if (calls === 1) return APPROVED;
      throw new Error('database unavailable');
    });

    await expect(service.activeTopics()).resolves.toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_001);
    await expect(service.activeTopics()).resolves.toEqual([
      expect.objectContaining({ topicKey: 'concorrentes', version: 2 }),
    ]);
  });
});
