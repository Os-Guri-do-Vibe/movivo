import { describe, expect, it, vi } from 'vitest';

import { DomainEventHandlers, type DomainEvent } from '../domain-events/domain-event-handlers';
import type { QueueManager } from '../jobs/queue-manager.service';
import type { WorkerFactory } from '../jobs/worker.factory';
import type { PlanGenerationService } from './plan-generation.service';
import { type PlanGenerationJob, PlanGenerationWorker } from './plan-generation.worker';

function setup() {
  const handlers = new DomainEventHandlers();
  const enqueue = vi.fn(() => Promise.resolve('job'));
  const create = vi.fn();
  const done = Promise.resolve({ status: 'PENDING_REVIEW', exceptionCaseIds: [] });
  const service = {
    generate: vi.fn(() => done),
    adjustFromCase: vi.fn(() => done),
    regenerateFromCase: vi.fn(() => done),
    retryFromFailureCase: vi.fn(() => done),
  };
  const worker = new PlanGenerationWorker(
    handlers,
    { enqueue } as unknown as QueueManager,
    { create } as unknown as WorkerFactory,
    service as unknown as PlanGenerationService,
    { setContext: vi.fn(), info: vi.fn() } as never,
  );
  worker.onModuleInit();
  const deliver = (event: DomainEvent) =>
    Promise.all(handlers.for(event.type).map((handler) => handler.handle(event)));
  const process = (name: string, data: PlanGenerationJob) =>
    (create.mock.calls[0]?.[1] as (job: { name: string; data: PlanGenerationJob }) => unknown)({
      name,
      data,
    });
  return { enqueue, deliver, process, service };
}

const resolvedCase = (outcome: string): DomainEvent => ({
  id: `evt-${outcome}`,
  userId: 'aluno-1',
  type: 'ExceptionResolved',
  payload: { exceptionCaseId: 'caso-1', kind: 'PROTOCOL_REVIEW', outcome },
  occurredAt: new Date(),
});

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

  it('tenta de novo quando a equipe encerra um caso de segurança (PAR-Q)', async () => {
    const { enqueue, deliver } = setup();
    await deliver(event('ExceptionResolved', 'SAFETY'));
    expect(enqueue).toHaveBeenCalledWith(
      expect.anything(),
      'generate',
      { userId: 'aluno-1', triggerEventId: 'evt-ExceptionResolved-SAFETY' },
      { jobId: 'plan-generation_evt-ExceptionResolved-SAFETY' },
    );
  });

  it('caso de falha encerrado: job `retry` com o caso, que repete o que falhou', async () => {
    const { enqueue, deliver } = setup();
    await deliver({
      ...event('ExceptionResolved', 'DECISION_FAILURE'),
      payload: { exceptionCaseId: 'falha-1', kind: 'DECISION_FAILURE', outcome: 'RESOLVED' },
    });
    expect(enqueue).toHaveBeenCalledWith(
      expect.anything(),
      'retry',
      {
        userId: 'aluno-1',
        triggerEventId: 'evt-ExceptionResolved-DECISION_FAILURE',
        exceptionCaseId: 'falha-1',
      },
      { jobId: 'plan-retry_evt-ExceptionResolved-DECISION_FAILURE' },
    );
  });

  it('ignora o encerramento de outros tipos de caso', async () => {
    const { enqueue, deliver } = setup();
    await deliver(event('ExceptionResolved', 'REVIEW_REQUEST'));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('ajuste pedido na fila: job `adjust` com o caso (a orientação fica no banco)', async () => {
    const { enqueue, deliver } = setup();
    await deliver(resolvedCase('ADJUSTMENT_REQUESTED'));
    expect(enqueue).toHaveBeenCalledWith(
      expect.anything(),
      'adjust',
      { userId: 'aluno-1', triggerEventId: 'evt-ADJUSTMENT_REQUESTED', exceptionCaseId: 'caso-1' },
      { jobId: 'plan-adjust_evt-ADJUSTMENT_REQUESTED' },
    );
  });

  it('regerar do zero: job `regenerate`, idempotente pelo evento', async () => {
    const { enqueue, deliver } = setup();
    await deliver(resolvedCase('REGENERATION_REQUESTED'));
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      expect.anything(),
      'regenerate',
      {
        userId: 'aluno-1',
        triggerEventId: 'evt-REGENERATION_REQUESTED',
        exceptionCaseId: 'caso-1',
      },
      { jobId: 'plan-regenerate_evt-REGENERATION_REQUESTED' },
    );
  });

  it('cada job chama o caminho certo do planejamento', async () => {
    const { process, service } = setup();
    const data = { userId: 'aluno-1', triggerEventId: 'evt-1', exceptionCaseId: 'caso-1' };
    await process('regenerate', data);
    await process('adjust', data);
    await process('retry', data);
    expect(service.retryFromFailureCase).toHaveBeenCalledWith('aluno-1', 'caso-1', {
      triggerEventId: 'evt-1',
    });
    expect(service.regenerateFromCase).toHaveBeenCalledWith('aluno-1', 'caso-1', {
      triggerEventId: 'evt-1',
    });
    expect(service.adjustFromCase).toHaveBeenCalledWith('aluno-1', 'caso-1', {
      triggerEventId: 'evt-1',
    });
    expect(service.generate).not.toHaveBeenCalled();
  });
});
