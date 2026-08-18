/**
 * `ProtocolAutoReleaseWorker` — categoria "Revisão Humana Opcional" da fila do
 * profissional. Consome o job com `delay` de 1h que `ProtocolGenerationWorker` agenda pra
 * TODO protocolo que sai da geração — PASS limpo, validador sinalizando
 * (`FLAG_HUMAN_REVIEW`) e o fallback (`BLOCK_FALLBACK`/DLQ) por igual, todos nascem
 * `PENDING_REVIEW`/`OPTIONAL` (decisão do fundador, 2026-08-18): o único motivo de negócio
 * pra travar a auto-liberação (`MANDATORY`, sem prazo, sem job nenhum agendado) é PAR-Q —
 * e quem chega em `PENDING_REVIEW` já passou pelo gate de PAR-Q antes de gerar.
 *
 * Idempotente por construção: `ProtocolRepository.autoRelease` só libera se o estado
 * ainda bater (`PENDING_REVIEW` + `OPTIONAL`) na hora em que o job dispara. Se o CREF já
 * assinou (`signProtocol`) ou editou (`editProtocol` força `MANDATORY` — um humano tocou o
 * conteúdo, então precisa de sign-off fresco, independente de PAR-Q) antes da 1h, o job
 * dispara do mesmo jeito e vira no-op — não existe "cancelar" o delay do BullMQ, o próprio
 * estado decide.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';

import { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import { ProtocolRepository } from './protocol.repository';

export interface ProtocolAutoReleaseJob {
  userId: string;
  protocolId: string;
}

@Injectable()
export class ProtocolAutoReleaseWorker implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly queues: QueueManager,
    private readonly repository: ProtocolRepository,
    private readonly queueEvents: DashboardQueueEventsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProtocolAutoReleaseWorker.name);
  }

  onModuleInit(): void {
    this.workers.create<ProtocolAutoReleaseJob>(QUEUE.protocolAutoRelease, (job) =>
      this.process(job),
    );
  }

  async process(job: Job<ProtocolAutoReleaseJob>): Promise<{ status: string }> {
    const { userId, protocolId } = job.data;
    const { released, version } = await this.repository.autoRelease(userId, protocolId);

    if (!released) {
      this.logger.info(
        { userId, protocolId },
        'auto-liberação pulada — CREF já agiu ou protocolo virou MANDATORY',
      );
      return { status: 'SKIPPED' };
    }

    await this.queues.enqueue(
      QUEUE.whatsappOutbound,
      'protocol-delivery',
      { userId, protocolId, protocolVersion: version, type: 'PROTOCOL_DELIVERY' },
      { jobId: `protocol-delivery_${userId}_${version}` },
    );
    this.queueEvents.emit('protocol');
    this.logger.info(
      { userId, protocolId },
      'protocolo auto-liberado após janela de cortesia de 1h — entrega enfileirada',
    );
    return { status: 'RELEASED' };
  }
}
