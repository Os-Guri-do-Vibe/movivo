import { type Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import { isFinalFailure, LoggingDeadLetterHandler, toDeadLetterRecord } from './dlq.handler';

function fakeLogger() {
  return { setContext: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() };
}

describe('dlq.handler', () => {
  it('isFinalFailure só é verdadeiro ao esgotar as tentativas', () => {
    expect(isFinalFailure({ attemptsMade: 2, opts: { attempts: 3 } } as Job)).toBe(false);
    expect(isFinalFailure({ attemptsMade: 3, opts: { attempts: 3 } } as Job)).toBe(true);
    expect(isFinalFailure({ attemptsMade: 1, opts: {} } as Job)).toBe(true); // default 1
  });

  it('toDeadLetterRecord extrai campos e correlationId sem vazar o objeto do BullMQ', () => {
    const job = {
      id: 'j1',
      name: 'sanity',
      attemptsMade: 3,
      data: { correlationId: 'corr-1', echo: 'x' },
    } as unknown as Job;
    const rec = toDeadLetterRecord('sanity', job, 'boom');
    expect(rec).toMatchObject({
      queue: 'sanity',
      jobId: 'j1',
      name: 'sanity',
      attemptsMade: 3,
      failedReason: 'boom',
      correlationId: 'corr-1',
    });
  });

  it('toDeadLetterRecord tolera job sem id e sem correlationId', () => {
    const job = { name: 'x', attemptsMade: 1, data: {} } as unknown as Job;
    const rec = toDeadLetterRecord('sanity', job, 'boom');
    expect(rec.jobId).toBe('unknown');
    expect(rec.correlationId).toBeUndefined();
  });

  it('LoggingDeadLetterHandler loga em nível error', async () => {
    const logger = fakeLogger();
    const handler = new LoggingDeadLetterHandler(logger as never);
    await handler.handle({
      queue: 'sanity',
      jobId: 'j1',
      name: 'sanity',
      attemptsMade: 3,
      failedReason: 'boom',
      data: {},
    });
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
