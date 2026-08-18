import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import type { QueueManager } from '../jobs/queue-manager.service';
import type { WorkerFactory } from '../jobs/worker.factory';
import {
  ProtocolAutoReleaseWorker,
  type ProtocolAutoReleaseJob,
} from './protocol-auto-release.worker';
import type { ProtocolRepository } from './protocol.repository';

function makeWorker(released: boolean, version = 1) {
  const workers = { create: vi.fn() } as unknown as WorkerFactory;
  const autoRelease = vi.fn(async () => ({ released, version }));
  const repository = { autoRelease } as unknown as ProtocolRepository;
  const enqueue = vi.fn(async () => 'job');
  const queues = { enqueue } as unknown as QueueManager;
  const emit = vi.fn();
  const queueEvents = { emit } as unknown as DashboardQueueEventsService;
  const logger = { info: vi.fn(), setContext: vi.fn() } as never;
  const worker = new ProtocolAutoReleaseWorker(workers, queues, repository, queueEvents, logger);
  return { worker, workers, autoRelease, enqueue, emit };
}

function job(over: Partial<ProtocolAutoReleaseJob> = {}): Job<ProtocolAutoReleaseJob> {
  return { data: { userId: 'u1', protocolId: 'p1', ...over } } as Job<ProtocolAutoReleaseJob>;
}

describe('ProtocolAutoReleaseWorker (fila do profissional — "Disponível para Revisão")', () => {
  it('registra o worker na fila protocol-auto-release', () => {
    const { worker, workers } = makeWorker(true);
    worker.onModuleInit();
    expect(workers.create).toHaveBeenCalledWith('protocol-auto-release', expect.any(Function));
  });

  it('CREF não agiu em 1h → libera, entrega e notifica o painel', async () => {
    const { worker, autoRelease, enqueue, emit } = makeWorker(true, 3);
    const res = await worker.process(job());
    expect(res.status).toBe('RELEASED');
    expect(autoRelease).toHaveBeenCalledWith('u1', 'p1');
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'protocol-delivery',
      { userId: 'u1', protocolId: 'p1', protocolVersion: 3, type: 'PROTOCOL_DELIVERY' },
      { jobId: 'protocol-delivery_u1_3' },
    );
    expect(emit).toHaveBeenCalledWith('protocol');
  });

  it('CREF já agiu (ou virou MANDATORY) → no-op, sem entrega', async () => {
    const { worker, enqueue, emit } = makeWorker(false);
    const res = await worker.process(job());
    expect(res.status).toBe('SKIPPED');
    expect(enqueue).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});
