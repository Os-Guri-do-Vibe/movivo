import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import { PROTOCOL_REVIEW_WINDOW_MS } from '../coaching/policy/protocol-review-window';
import { DomainEventHandlers, type DomainEvent } from '../domain-events/domain-event-handlers';
import { QUEUE } from '../jobs/jobs.config';
import type { QueueManager } from '../jobs/queue-manager.service';
import type { WorkerFactory } from '../jobs/worker.factory';
import type { ExceptionsService } from './exceptions.service';
import { ProtocolAutoReleaseWorker } from './protocol-auto-release.worker';
import type { ProtocolAutoReleaseJob, ReviewHoldService } from './review-hold.service';

const target: ProtocolAutoReleaseJob = { userId: 'aluno-1', exceptionCaseId: 'caso-1' };

function setup(options: { held?: boolean; released?: boolean } = {}) {
  const handlers = new DomainEventHandlers();
  const enqueue = vi.fn(() => Promise.resolve('job'));
  const autoRelease = vi.fn(() =>
    Promise.resolve({ released: options.released ?? true, userId: 'aluno-1' }),
  );
  const hold = {
    isHeld: vi.fn(() => Promise.resolve(options.held ?? false)),
    deferRelease: vi.fn(() => Promise.resolve()),
  };
  const worker = new ProtocolAutoReleaseWorker(
    handlers,
    { enqueue } as unknown as QueueManager,
    { create: vi.fn() } as unknown as WorkerFactory,
    { autoRelease } as unknown as ExceptionsService,
    hold as unknown as ReviewHoldService,
    { setContext: vi.fn(), info: vi.fn() } as never,
  );
  worker.onModuleInit();
  const deliver = (event: DomainEvent) =>
    Promise.all(handlers.for(event.type).map((handler) => handler.handle(event)));
  const run = () => worker.process({ data: target } as Job<ProtocolAutoReleaseJob>);
  return { enqueue, autoRelease, hold, deliver, run };
}

const opened = (payload: DomainEvent['payload']): DomainEvent => ({
  id: 'evt-1',
  userId: 'aluno-1',
  type: 'ExceptionOpened',
  payload,
  occurredAt: new Date(),
});

describe('ProtocolAutoReleaseWorker', () => {
  it('agenda a liberação do protocolo opcional para o fim da janela de 24h', async () => {
    const { enqueue, deliver } = setup();
    const dueAt = new Date(Date.now() + PROTOCOL_REVIEW_WINDOW_MS);
    await deliver(
      opened({
        exceptionCaseId: 'caso-1',
        kind: 'PROTOCOL_REVIEW',
        reviewUrgency: 'OPTIONAL',
        autoReleaseAt: dueAt.toISOString(),
      }),
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
    const [queue, name, data, options] = enqueue.mock.calls[0] as unknown as [
      string,
      string,
      ProtocolAutoReleaseJob,
      { jobId: string; delay: number },
    ];
    expect(queue).toBe(QUEUE.protocolAutoRelease);
    expect(name).toBe('auto-release');
    expect(data).toEqual(target);
    expect(options.jobId).toBe('auto-release_caso-1');
    expect(options.delay).toBeGreaterThan(PROTOCOL_REVIEW_WINDOW_MS - 5_000);
    expect(options.delay).toBeLessThanOrEqual(PROTOCOL_REVIEW_WINDOW_MS);
  });

  it('a revisão obrigatória nunca agenda liberação', async () => {
    const { enqueue, deliver } = setup();
    await deliver(
      opened({
        exceptionCaseId: 'caso-1',
        kind: 'PROTOCOL_REVIEW',
        reviewUrgency: 'MANDATORY',
        autoReleaseAt: null,
      }),
    );
    await deliver(opened({ exceptionCaseId: 'caso-2', kind: 'SAFETY' }));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('libera o protocolo quando o prazo vence e ninguém agiu', async () => {
    const { autoRelease, hold, run } = setup();
    expect(await run()).toEqual({ status: 'RELEASED' });
    expect(autoRelease).toHaveBeenCalledWith('caso-1');
    expect(hold.deferRelease).not.toHaveBeenCalled();
  });

  it('com a tela de revisão aberta o envio espera: nada é liberado e a checagem é reagendada', async () => {
    const { autoRelease, hold, run } = setup({ held: true });
    expect(await run()).toEqual({ status: 'HELD' });
    expect(hold.deferRelease).toHaveBeenCalledWith(target);
    expect(autoRelease).not.toHaveBeenCalled();
  });

  it('é no-op quando a equipe já agiu ou o caso é obrigatório', async () => {
    const { run } = setup({ released: false });
    expect(await run()).toEqual({ status: 'SKIPPED' });
  });
});
