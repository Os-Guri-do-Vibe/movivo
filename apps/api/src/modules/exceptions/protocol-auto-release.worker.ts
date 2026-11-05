/**
 * Liberação automática da "Revisão Humana Opcional" da Fila do Profissional.
 *
 * Quando um protocolo opcional entra na fila (`ExceptionOpened` com `autoReleaseAt`), um job com
 * atraso até o fim da janela de 2h é agendado. Ao vencer, o worker libera o protocolo pelo mesmo
 * caminho da aprovação humana (decisão `AUTO_RELEASE`), e o planejamento ativa o rascunho e
 * entrega o link ao aluno quando treino e alimentação estão prontos. A revisão obrigatória nunca
 * agenda job: só sai por aprovação de um profissional.
 *
 * Idempotente por construção: `ExceptionsService.autoRelease` reconfere o caso sob trava, então
 * um profissional que agiu antes (aprovou, recusou, pediu ajuste) torna o job um no-op. Se a
 * tela de revisão está aberta quando o prazo vence, o envio espera ela fechar (`ReviewHoldService`).
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';

import { DomainEventHandlers, type DomainEvent } from '../domain-events/domain-event-handlers';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import { ExceptionsService } from './exceptions.service';
import { ReviewHoldService, type ProtocolAutoReleaseJob } from './review-hold.service';

@Injectable()
export class ProtocolAutoReleaseWorker implements OnModuleInit {
  constructor(
    private readonly handlers: DomainEventHandlers,
    private readonly queues: QueueManager,
    private readonly workers: WorkerFactory,
    private readonly exceptions: ExceptionsService,
    private readonly hold: ReviewHoldService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProtocolAutoReleaseWorker.name);
  }

  onModuleInit(): void {
    this.handlers.register({
      name: 'exceptions.schedule-protocol-auto-release',
      eventTypes: ['ExceptionOpened'],
      handle: (event) => this.schedule(event),
    });
    this.workers.create<ProtocolAutoReleaseJob>(QUEUE.protocolAutoRelease, (job) =>
      this.process(job),
    );
  }

  /** Agenda a liberação dos casos opcionais, no instante gravado no caso. */
  private async schedule(event: DomainEvent): Promise<void> {
    const { exceptionCaseId, reviewUrgency, autoReleaseAt } = event.payload;
    if (!event.userId || reviewUrgency !== 'OPTIONAL' || typeof exceptionCaseId !== 'string') {
      return;
    }
    const dueAt = typeof autoReleaseAt === 'string' ? Date.parse(autoReleaseAt) : NaN;
    if (Number.isNaN(dueAt)) return;
    const job: ProtocolAutoReleaseJob = { userId: event.userId, exceptionCaseId };
    await this.queues.enqueue(QUEUE.protocolAutoRelease, 'auto-release', job, {
      jobId: `auto-release_${exceptionCaseId}`,
      delay: Math.max(0, dueAt - Date.now()),
    });
  }

  async process(job: Job<ProtocolAutoReleaseJob>): Promise<{ status: string }> {
    const target = job.data;
    if (await this.hold.isHeld(target)) {
      // O profissional está com o protocolo aberto: o envio espera ele fechar a tela.
      await this.hold.deferRelease(target);
      this.logger.info(
        { event: 'protocol_auto_release_held', exceptionCaseId: target.exceptionCaseId },
        'liberação adiada — protocolo aberto na tela de revisão',
      );
      return { status: 'HELD' };
    }
    const result = await this.exceptions.autoRelease(target.exceptionCaseId);
    if (!result.released) {
      this.logger.info(
        { exceptionCaseId: target.exceptionCaseId },
        'liberação automática pulada — a equipe já agiu ou o caso é obrigatório',
      );
      return { status: 'SKIPPED' };
    }
    this.logger.info(
      { event: 'protocol_auto_released', exceptionCaseId: target.exceptionCaseId },
      'protocolo liberado após a janela de revisão opcional',
    );
    return { status: 'RELEASED' };
  }
}
