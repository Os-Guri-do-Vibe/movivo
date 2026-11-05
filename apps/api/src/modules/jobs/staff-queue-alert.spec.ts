import { describe, expect, it, vi } from 'vitest';

import { QUEUE } from './jobs.config';
import { type QueueManager } from './queue-manager.service';
import { enqueueStaffQueueAlert } from './staff-queue-alert';

describe('enqueueStaffQueueAlert', () => {
  it('enfileira o alerta com jobId idempotente por caso', async () => {
    const enqueue = vi.fn(() => Promise.resolve('1'));
    const logger = { warn: vi.fn() };
    await enqueueStaffQueueAlert({ enqueue } as unknown as QueueManager, logger, {
      caseId: 'c1',
      text: 'Novo caso na fila MOVIVO',
    });
    expect(enqueue).toHaveBeenCalledWith(
      QUEUE.whatsappOutbound,
      'staff-queue-alert',
      { userId: null, type: 'STAFF_QUEUE_ALERT', text: 'Novo caso na fila MOVIVO', dedupeId: 'c1' },
      { jobId: 'staff-queue-alert-c1' },
    );
  });

  it('falha ao enfileirar é só logada, nunca propaga', async () => {
    const enqueue = vi.fn(() => Promise.reject(new Error('redis fora')));
    const logger = { warn: vi.fn() };
    await expect(
      enqueueStaffQueueAlert({ enqueue } as unknown as QueueManager, logger, {
        caseId: 'c1',
        text: 'x',
      }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledOnce();
  });
});
