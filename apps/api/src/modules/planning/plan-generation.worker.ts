/**
 * Dispara a geração do plano quando a anamnese é concluída: um consumidor do outbox enfileira o
 * job (idempotente pelo evento) e o worker executa o `PlanGenerationService`.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { DomainEventHandlers, type DomainEvent } from '../domain-events/domain-event-handlers';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import { PlanGenerationService } from './plan-generation.service';

export interface PlanGenerationJob {
  userId: string;
  triggerEventId: string | null;
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
    this.workers.create<PlanGenerationJob>(QUEUE.planGeneration, async (job) => {
      const result = await this.service.generate(job.data.userId, {
        triggerEventId: job.data.triggerEventId,
      });
      this.logger.info({ userId: job.data.userId, status: result.status }, 'plano gerado');
      return result;
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
