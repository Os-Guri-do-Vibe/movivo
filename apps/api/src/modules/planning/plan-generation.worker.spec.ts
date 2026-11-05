import { describe, expect, it, vi } from 'vitest';

import { DomainEventHandlers, type DomainEvent } from '../domain-events/domain-event-handlers';
import type { QueueManager } from '../jobs/queue-manager.service';
import type { WorkerFactory } from '../jobs/worker.factory';
import type { PlanGenerationService } from './plan-generation.service';
import { PlanGenerationWorker } from './plan-generation.worker';

function setup() {
  const handlers = new DomainEventHandlers();
  const enqueue = vi.fn(() => Promise.resolve('job'));
  const worker = new PlanGenerationWorker(
    handlers,
    { enqueue } as unknown as QueueManager,
    { create: vi.fn() } as unknown as WorkerFactory,
    {} as PlanGenerationService,
    { setContext: vi.fn(), info: vi.fn() } as never,
  );
  worker.onModuleInit();
  const deliver = (event: DomainEvent) =>
    Promise.all(handlers.for(event.type).map((handler) => handler.handle(event)));
  return { enqueue, deliver };
}

const event = (type: DomainEvent['type'], kind?: string): DomainEvent => ({
  id: `evt-${type}-${kind ?? ''}`,
  userId: 'aluno-1',
  type,
  payload: kind ? { kind } : {},
  occurredAt: new Date(),
});

describe('PlanGenerationWorker', () => {
  it('gera o plano ao concluir a anamnese', async () => {
    const { enqueue, deliver } = setup();
    await deliver(event('OnboardingCompleted'));
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('tenta de novo quando a equipe encerra um caso de segurança (PAR-Q) ou de falha', async () => {
    const { enqueue, deliver } = setup();
    await deliver(event('ExceptionResolved', 'SAFETY'));
    await deliver(event('ExceptionResolved', 'DECISION_FAILURE'));
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith(
      expect.anything(),
      'generate',
      { userId: 'aluno-1', triggerEventId: 'evt-ExceptionResolved-SAFETY' },
      { jobId: 'plan-generation_evt-ExceptionResolved-SAFETY' },
    );
  });

  it('ignora o encerramento de outros tipos de caso', async () => {
    const { enqueue, deliver } = setup();
    await deliver(event('ExceptionResolved', 'REVIEW_REQUEST'));
    expect(enqueue).not.toHaveBeenCalled();
  });
});
