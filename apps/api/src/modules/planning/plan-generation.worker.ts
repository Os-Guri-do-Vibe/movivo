/**
 * Dispara a geração do plano quando a anamnese é concluída e quando a equipe encerra um caso que
 * pode tê-la travado (sinal de segurança, como o PAR-Q positivo, ou falha da geração), e refaz um
 * protocolo quando o profissional pede ajuste na fila. O consumidor
 * do outbox enfileira o job (idempotente pelo evento) e o worker executa o `PlanGenerationService`,
 * que pula quem ainda tem sinal ativo ou já tem plano.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { DomainEventHandlers, type DomainEvent } from '../domain-events/domain-event-handlers';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import { PlanGenerationService } from './plan-generation.service';

const RETRY_ON_RESOLVED_KINDS = new Set(['SAFETY', 'DECISION_FAILURE']);

export interface PlanGenerationJob {
  userId: string;
  triggerEventId: string | null;
  /** Job `adjust`: o caso em que o profissional pediu o ajuste (a orientação fica no banco). */
  exceptionCaseId?: string;
}

@Injectable()
export class PlanGenerationWorker implements OnModuleInit {
  constructor(
    private readonly handlers: DomainEventHandlers,
    private readonly queues: QueueManager,
    private readonly workers: WorkerFactory,
    private readonly service: PlanGenerationService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PlanGenerationWorker.name);
  }

  onModuleInit(): void {
    this.handlers.register({
      name: 'planning.generate-on-onboarding',
      eventTypes: ['OnboardingCompleted'],
      handle: (event) => this.enqueue(event),
    });
    this.handlers.register({
      name: 'planning.generate-on-case-resolved',
      eventTypes: ['ExceptionResolved'],
      handle: async (event) => {
        if (event.payload.outcome === 'ADJUSTMENT_REQUESTED') await this.enqueueAdjust(event);
        else if (RETRY_ON_RESOLVED_KINDS.has(String(event.payload.kind))) await this.enqueue(event);
      },
    });
    this.workers.create<PlanGenerationJob>(QUEUE.planGeneration, async (job) => {
      const { userId, triggerEventId, exceptionCaseId } = job.data;
      const result =
        job.name === 'adjust' && exceptionCaseId
          ? await this.service.adjustFromCase(userId, exceptionCaseId, { triggerEventId })
          : await this.service.generate(userId, { triggerEventId });
      this.logger.info({ userId, job: job.name, status: result.status }, 'plano gerado');
      return result;
    });
  }

  private async enqueueAdjust(event: DomainEvent): Promise<void> {
    if (!event.userId) return;
    const data: PlanGenerationJob = {
      userId: event.userId,
      triggerEventId: event.id,
      exceptionCaseId: String(event.payload.exceptionCaseId),
    };
    await this.queues.enqueue(QUEUE.planGeneration, 'adjust', data, {
      jobId: `plan-adjust_${event.id}`,
    });
  }

  private async enqueue(event: DomainEvent): Promise<void> {
    if (!event.userId) return;
    const data: PlanGenerationJob = { userId: event.userId, triggerEventId: event.id };
    await this.queues.enqueue(QUEUE.planGeneration, 'generate', data, {
      jobId: `plan-generation_${event.id}`,
    });
  }
}
