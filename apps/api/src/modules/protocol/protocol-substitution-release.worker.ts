/**
 * `ProtocolSubstitutionReleaseWorker` (achado 2026-09-02) — liberação automática de uma
 * proposta de substituição de exercício via IA após a janela de cortesia de 30 min, sem
 * intervenção do profissional. Mesmo desenho de `ProtocolAutoReleaseWorker` (idempotente,
 * reconfere o estado antes de aplicar), só que sobre `protocol_substitution_requests` em vez
 * de `protocols` diretamente — a mudança só se torna real no protocolo do aluno aqui dentro
 * (ou na aprovação manual do profissional, que chama o mesmo `ProtocolSubstitutionRepository
 * .release()`).
 *
 * Reusa o PDF completo do protocolo (`buildProtocolPdf`) e o mesmo job de entrega por
 * WhatsApp que qualquer outra liberação de protocolo usa — decisão do fundador: nada de
 * template "só o diff", o aluno recebe o protocolo inteiro atualizado de novo.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type Job } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';

import { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import { buildProtocolPdf } from './protocol-pdf.service';
import { ProtocolRepository } from './protocol.repository';
import { ProtocolSubstitutionRepository } from './protocol-substitution.repository';
import { WorkoutPresentationService } from './workout-presentation.service';

/** Janela de cortesia da substituição — bem mais curta que a de geração completa (1h),
 * porque o escopo da mudança é uma troca pontual, não um protocolo inteiro novo. */
export const AI_SUBSTITUTION_REVIEW_WINDOW_MS = 30 * 60 * 1000;

export interface ProtocolSubstitutionReleaseJob {
  userId: string;
  requestId: string;
}

@Injectable()
export class ProtocolSubstitutionReleaseWorker implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly queues: QueueManager,
    private readonly repository: ProtocolSubstitutionRepository,
    private readonly protocolRepository: ProtocolRepository,
    private readonly queueEvents: DashboardQueueEventsService,
    private readonly workoutPresentation: WorkoutPresentationService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProtocolSubstitutionReleaseWorker.name);
  }

  onModuleInit(): void {
    this.workers.create<ProtocolSubstitutionReleaseJob>(QUEUE.protocolSubstitutionRelease, (job) =>
      this.process(job),
    );
  }

  async process(job: Job<ProtocolSubstitutionReleaseJob>): Promise<{ status: string }> {
    const { userId, requestId } = job.data;
    const release = await this.repository.release({ userId, role: 'USER' }, requestId);

    if (!release.released) {
      this.logger.info(
        { userId, requestId },
        'liberação de substituição pulada — já decidida ou protocolo mudou de versão',
      );
      return { status: 'SKIPPED' };
    }

    let aiSummary: string | undefined;
    let pdfPersisted = false;
    try {
      const personal = await this.protocolRepository.findLatestPersonalInfo(userId);
      if (!personal) throw new Error('anamnese submetida do titular não encontrada');
      const pdf = await buildProtocolPdf({
        content: release.content,
        mesocycleName: release.mesocycleName,
        startDate: release.startDate,
        endDate: release.endDate,
        totalWeeks: release.totalWeeks,
        // Uma substituição de exercício não é uma assinatura CREF nova — não reassina.
        signatureHash: null,
        signedAt: null,
        student: personal,
      });
      await this.protocolRepository.setPdfContent(userId, release.protocolId, pdf);
      pdfPersisted = true;
      // 2ª bolha da entrega (achado 2026-09-04): só vale a pena gerar quando o PDF saiu —
      // sem PDF, a entrega cai no texto+link de sempre, que não usa este resumo.
      aiSummary = await this.workoutPresentation.present({
        userId,
        user: { name: personal.name, phoneNumber: personal.phoneNumber, email: personal.email },
        biologicalSex: personal.biologicalSex,
        content: release.content,
        totalWeeks: release.totalWeeks,
        mesocycleName: release.mesocycleName,
        reason: 'SUBSTITUTION',
        substitutionFrom: release.fromExerciseName,
        substitutionTo: release.toExerciseName,
      });
    } catch (error) {
      this.logger.warn(
        { userId, requestId, err: error instanceof Error ? error.message : String(error) },
        'geração do PDF da substituição falhou — entrega cai para texto+link',
      );
      // Achado 2026-09-09 (bug reportado pelo fundador): se o PDF novo nunca chegou a ser
      // persistido, a coluna ainda guarda o PDF da versão ANTERIOR (assinatura original ou
      // substituição prévia) — sem isto, `WhatsappOutboundWorker.buildDelivery` acharia
      // `pdfContent` truthy e mandaria esse PDF desatualizado como se fosse o atual, em vez
      // de cair no fallback texto+link (que já reflete `release.content`, correto).
      if (!pdfPersisted) {
        await this.protocolRepository.setPdfContent(userId, release.protocolId, null);
      }
    }

    await this.queues.enqueue(
      QUEUE.whatsappOutbound,
      'protocol-delivery',
      {
        userId,
        protocolId: release.protocolId,
        protocolVersion: release.version,
        type: 'PROTOCOL_DELIVERY',
        text: aiSummary,
        deliveryReason: 'SUBSTITUTION',
        substitutionFromExercise: release.fromExerciseName,
        substitutionToExercise: release.toExerciseName,
      },
      { jobId: `substitution-delivery_${userId}_${release.version}` },
    );
    this.queueEvents.emit('protocol');
    this.logger.info(
      { userId, requestId },
      'substituição de exercício auto-liberada após janela de cortesia de 30 min — entrega enfileirada',
    );
    return { status: 'RELEASED' };
  }
}
