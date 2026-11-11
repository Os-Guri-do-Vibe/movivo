/**
 * Dispara a geração do plano quando a anamnese é concluída e quando a equipe encerra um caso que
 * pode tê-la travado (sinal de segurança, como o PAR-Q positivo, ou falha da geração), e refaz um
 * protocolo quando o profissional pede ajuste (com orientação) ou regera do zero na fila. O consumidor
 * do outbox enfileira o job (idempotente pelo evento) e o worker executa o `PlanGenerationService`,
 * que pula quem ainda tem sinal ativo ou já tem plano.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { DomainEventHandlers, type DomainEvent } from '../domain-events/domain-event-handlers';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import type { PinnedModel } from '../../core/agents/agent-runner';
import { PlanGenerationService } from './plan-generation.service';

// Sinal de segurança encerrado: a geração inicial volta a valer (a falha tem caminho próprio, `retry`).
const RETRY_ON_RESOLVED_KINDS = new Set(['SAFETY']);

export interface PlanGenerationJob {
  userId: string;
  triggerEventId: string | null;
  /**
   * Jobs `adjust` e `regenerate`: o caso em que o profissional pediu o ajuste (a orientação fica
   * no banco) ou a regeneração do zero.
   */
  exceptionCaseId?: string;
  /** Operação (`regenerate-plan`): todos os agentes desta geração num só modelo, sem reserva. */
  pinnedModel?: PinnedModel;
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
        const outcome = event.payload.outcome;
        if (outcome === 'ADJUSTMENT_REQUESTED') await this.enqueueFromCase(event, 'adjust');
        else if (outcome === 'REGENERATION_REQUESTED') {
          await this.enqueueFromCase(event, 'regenerate');
        } else if (String(event.payload.kind) === 'DECISION_FAILURE') {
          if (typeof event.payload.exceptionCaseId === 'string') {
            await this.enqueueFromCase(event, 'retry');
          } else await this.enqueue(event);
        } else if (RETRY_ON_RESOLVED_KINDS.has(String(event.payload.kind))) {
          await this.enqueue(event);
        }
      },
    });
    this.workers.create<PlanGenerationJob>(QUEUE.planGeneration, async (job) => {
      const { userId, triggerEventId, exceptionCaseId, pinnedModel } = job.data;
      const result = await this.service.withPinnedModel(pinnedModel, () =>
        job.name === 'adjust' && exceptionCaseId
          ? this.service.adjustFromCase(userId, exceptionCaseId, { triggerEventId })
          : job.name === 'regenerate' && exceptionCaseId
            ? this.service.regenerateFromCase(userId, exceptionCaseId, { triggerEventId })
            : job.name === 'retry' && exceptionCaseId
              ? this.service.retryFromFailureCase(userId, exceptionCaseId, {
                  triggerEventId,
                })
              : this.service.generate(userId, { triggerEventId }),
      );
      this.logger.info(
        { userId, job: job.name, status: result.status, pinnedModel },
        'plano gerado',
      );
      return result;
    });
  }

  /** Refaz a partir do caso encerrado na fila: com a orientação (`adjust`), do zero ou repetindo o que falhou. */
  private async enqueueFromCase(
    event: DomainEvent,
    name: 'adjust' | 'regenerate' | 'retry',
  ): Promise<void> {
    if (!event.userId) return;
    const data: PlanGenerationJob = {
      userId: event.userId,
      triggerEventId: event.id,
      exceptionCaseId: String(event.payload.exceptionCaseId),
    };
    await this.queues.enqueue(QUEUE.planGeneration, name, data, {
      jobId: `plan-${name}_${event.id}`,
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
