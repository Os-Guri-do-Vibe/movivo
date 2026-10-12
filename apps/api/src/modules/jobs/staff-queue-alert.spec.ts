import { describe, expect, it, vi } from 'vitest';

import { QUEUE } from './jobs.config';
import { type QueueManager } from './queue-manager.service';
import { enqueueStaffQueueAlert } from './staff-queue-alert';

describe('enqueueStaffQueueAlert', () => {
  it('enfileira o alerta com jobId idempotente por tipo e item', async () => {
    const enqueue = vi.fn(() => Promise.resolve('1'));
    const logger = { warn: vi.fn() };
    await enqueueStaffQueueAlert({ enqueue } as unknown as QueueManager, logger, {
      userId: 'u1',
      kind: 'SUBSTITUTION_REVIEW',
      refId: 'r1',
    });
    expect(enqueue).toHaveBeenCalledWith(
      QUEUE.whatsappOutbound,
      'staff-queue-alert',
      {
        userId: 'u1',
        type: 'STAFF_QUEUE_ALERT',
        staffAlertKind: 'SUBSTITUTION_REVIEW',
        dedupeId: 'r1',
      },
      { jobId: 'staff-queue-alert-SUBSTITUTION_REVIEW-r1' },
    );
  });

  it('falha ao enfileirar é só logada, nunca propaga', async () => {
    const enqueue = vi.fn(() => Promise.reject(new Error('redis fora')));
    const logger = { warn: vi.fn() };
    await expect(
      enqueueStaffQueueAlert({ enqueue } as unknown as QueueManager, logger, {
        userId: 'u1',
        kind: 'PROTOCOL_REVIEW',
        refId: 'p1',
      }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});
