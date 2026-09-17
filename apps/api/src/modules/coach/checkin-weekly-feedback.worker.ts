/**
 * `CheckinWeeklyFeedbackWorker` — consome `QUEUE.checkinWeeklyFeedback`, enfileirado por
 * `CheckinService.submit()` a cada check-in semanal enviado (achado 2026-09-13).
 *
 * Mora aqui (não em `checkin`, que não pode falar com `LlmRouter`/`ValidationService` —
 * fronteira §12.5) pelo mesmo motivo de `WorkoutFeedbackWorker`: `CoachModule` já importa
 * `AiCoachModule`+`ProtocolModule`, então é aqui que qualquer geração de texto ou mutação de
 * protocolo do Coach mora.
 *
 * Ordem de processamento (cada etapa é best-effort, uma falha não derruba as seguintes):
 *  1. Pergunta 7 == "mais curtos" → `ProtocolVolumeAdjustmentService.adjust()` (aplica direto)
 *     e, se aplicado, regenera o PDF e reenfileira a entrega completa do protocolo.
 *  2. Pergunta 5 preenchida → `SubstitutionTargetService.identify()` pra nomear o exercício
 *     no comentário (a aceitação em si acontece depois, na conversa livre do WhatsApp — não
 *     há máquina de estado nova aqui).
 *  3. Sinal de segurança na pergunta 5 → `handoffAlerts` SAFETY (mesmo padrão do antigo
 *     `checkin.service.ts`, extraído para `safety-signal.ts`).
 *  4. `CheckinWeeklyFeedbackService.comment()` amarra tudo num comentário, sempre best-effort.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import type { ProtocolStructure } from '@movivo/shared';

import { HealthCipherService } from '../../core/database/health-cipher.service';
import { checkins, protocols, users } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { createCheckinAlert, LOW_ADHERENCE_ALERT_THRESHOLD } from '../checkin/checkin.service';
import { hasSafetySignal } from '../checkin/safety-signal';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import { ProtocolRepository } from '../protocol/protocol.repository';
import { ProtocolSubstitutionRepository } from '../protocol/protocol-substitution.repository';
import { buildProtocolPdf } from '../protocol/protocol-pdf.service';
import { WorkoutCompletionService } from '../workout/workout-completion.service';
import { CheckinWeeklyFeedbackService } from './checkin-weekly-feedback.service';
import { ProtocolVolumeAdjustmentService } from './protocol-volume-adjustment.service';
import { SubstitutionTargetService } from './substitution-target.service';

export interface CheckinWeeklyFeedbackJob {
  userId: string;
  checkinId: string;
}

@Injectable()
export class CheckinWeeklyFeedbackWorker implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly queues: QueueManager,
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
    private readonly feedback: CheckinWeeklyFeedbackService,
    private readonly volumeAdjustment: ProtocolVolumeAdjustmentService,
    private readonly substitutionTarget: SubstitutionTargetService,
    private readonly substitutionRepo: ProtocolSubstitutionRepository,
    private readonly protocolRepository: ProtocolRepository,
    private readonly queueEvents: DashboardQueueEventsService,
    private readonly workoutCompletions: WorkoutCompletionService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CheckinWeeklyFeedbackWorker.name);
  }

  onModuleInit(): void {
    this.workers.create<CheckinWeeklyFeedbackJob>(QUEUE.checkinWeeklyFeedback, (job) =>
      this.process(job),
    );
  }

  async process(job: Job<CheckinWeeklyFeedbackJob>): Promise<{ status: string }> {
    const { userId, checkinId } = job.data;
    const loaded = await this.load(userId, checkinId);
    if (!loaded) return { status: 'NOT_FOUND' };

    await this.workoutCompletions.recordFromCheckin(userId, loaded.answers.adherenceScore);

    // Mesmo gatilho de revisão do antigo fluxo de botão (aderência baixa ou humor ruim) —
    // não é SAFETY (sem sinal de dor), é ALERT: fila de revisão do profissional CREF.
    if (
      loaded.answers.adherenceScore < LOW_ADHERENCE_ALERT_THRESHOLD ||
      loaded.answers.mood === 'TRISTE' ||
      loaded.answers.mood === 'DESMOTIVADO'
    ) {
      await createCheckinAlert(
        this.db,
        this.queueEvents,
        userId,
        checkinId,
        'ALERT',
        'CHECKIN_REVISAO',
      );
    }

    let volumeAdjustmentSummary: string | undefined;
    if (loaded.answers.durationFit === 'MAIS_CURTOS') {
      const result = await this.volumeAdjustment.adjust({
        userId,
        user: { name: loaded.name, phoneNumber: loaded.phoneNumber, email: loaded.email },
        biologicalSex: loaded.biologicalSex,
        checkinId,
      });
      if (result.applied) {
        volumeAdjustmentSummary = result.summary;
        // Best-effort e isolado de propósito: o ajuste JÁ foi aplicado e versionado — se a
        // regeneração do PDF/reentrega falhar, um retry do job inteiro reaplicaria o ajuste
        // de volume por cima do que já foi salvo (não é idempotente). Falha aqui só significa
        // que o aluno vê o PDF atualizado no próximo acesso ao link do protocolo, não agora.
        try {
          await this.redeliverProtocol(userId, result.protocolId, result.version);
        } catch (error) {
          this.logger.warn(
            { userId, checkinId, err: error instanceof Error ? error.message : String(error) },
            'reentrega do protocolo após ajuste de volume falhou — protocols.content já reflete ' +
              'o ajuste, mas o PDF (protocols.pdf_content) fica temporariamente desatualizado',
          );
        }
      }
    }

    let identifiedExerciseName: string | undefined;
    const difficultDescription = loaded.notes.difficultExerciseDescription;
    if (difficultDescription) {
      const active = await this.substitutionRepo.loadActiveProtocol(userId);
      const protocolExercises = (active?.content.sessions ?? []).flatMap((session) =>
        session.exercises.map((exercise) => ({ id: exercise.exerciseId, name: exercise.name })),
      );
      const target = await this.substitutionTarget.identify({
        userId,
        operationId: `checkin-${checkinId}`,
        user: { name: loaded.name, phoneNumber: loaded.phoneNumber, email: loaded.email },
        recentConversation: difficultDescription,
        protocolExercises,
        personaSlot: loaded.biologicalSex,
      });
      if (target.identified) {
        identifiedExerciseName =
          protocolExercises.find((exercise) => exercise.id === target.exerciseId)?.name ??
          target.exerciseId;
      }

      if (hasSafetySignal(difficultDescription)) {
        await createCheckinAlert(
          this.db,
          this.queueEvents,
          userId,
          checkinId,
          'SAFETY',
          'CHECKIN_DOR_ARTICULAR',
        );
      }
    }

    const text = await this.feedback.comment({
      userId,
      user: { name: loaded.name, phoneNumber: loaded.phoneNumber, email: loaded.email },
      biologicalSex: loaded.biologicalSex,
      sleepQuality: loaded.answers.sleepQuality,
      mood: loaded.answers.mood,
      nutritionScore: loaded.answers.nutritionScore,
      adherenceScore: loaded.answers.adherenceScore,
      changesNoticed: loaded.answers.changesNoticed,
      changesOther: loaded.answers.changesOther,
      durationFit: loaded.answers.durationFit,
      difficultExerciseDescription: difficultDescription,
      improvementFeedback: loaded.notes.improvementFeedback,
      dorRelatada: Boolean(difficultDescription && hasSafetySignal(difficultDescription)),
      identifiedExerciseName,
      volumeAdjustmentSummary,
    });
    if (!text) return { status: 'SKIPPED' };

    const outbound: WhatsappOutboundJob = {
      userId,
      type: 'COACH_MESSAGE',
      dedupeId: `checkin-weekly-feedback-${checkinId}`,
      text: `Acabei de analisar seu check-in semanal!\n---\n${text}`,
    };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'checkin-weekly-feedback', outbound, {
      jobId: `wa-checkin-weekly-feedback-${checkinId}`,
    });
    return { status: 'SENT' };
  }

  /** Regenera o PDF com o conteúdo ajustado e reenfileira a entrega completa (US-2.6-PDF). */
  private async redeliverProtocol(
    userId: string,
    protocolId: string,
    version: number,
  ): Promise<void> {
    const personal = await this.protocolRepository.findLatestPersonalInfo(userId);
    if (!personal) throw new Error('anamnese submetida do titular não encontrada');
    const [protocolRow] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({
          content: protocols.content,
          mesocycleName: protocols.mesocycleName,
          startDate: protocols.startDate,
          endDate: protocols.endDate,
          totalWeeks: protocols.totalWeeks,
        })
        .from(protocols)
        .where(eq(protocols.id, protocolId))
        .limit(1),
    );
    if (!protocolRow) throw new Error('protocolo não encontrado após o ajuste');
    const pdf = await buildProtocolPdf({
      content: protocolRow.content as ProtocolStructure,
      mesocycleName: protocolRow.mesocycleName,
      startDate: protocolRow.startDate,
      endDate: protocolRow.endDate,
      totalWeeks: protocolRow.totalWeeks,
      signatureHash: null,
      signedAt: null,
      student: personal,
    });
    await this.protocolRepository.setPdfContent(userId, protocolId, pdf);
    await this.queues.enqueue(
      QUEUE.whatsappOutbound,
      'protocol-delivery',
      {
        userId,
        protocolId,
        protocolVersion: version,
        type: 'PROTOCOL_DELIVERY',
        deliveryReason: 'CHECKIN_ADJUSTMENT',
      },
      { jobId: `checkin-adjustment-delivery_${userId}_${version}` },
    );
  }

  private async load(
    userId: string,
    checkinId: string,
  ): Promise<{
    name: string | null;
    phoneNumber: string | null;
    email: string | null;
    biologicalSex: import('@movivo/shared').BiologicalSex | null;
    answers: {
      sleepQuality: string;
      mood: string;
      nutritionScore: number;
      adherenceScore: number;
      changesNoticed: string[];
      changesOther?: string;
      durationFit: 'ADEQUADA' | 'MAIS_CURTOS' | 'MAIS_LONGOS';
    };
    notes: { difficultExerciseDescription?: string; improvementFeedback?: string };
  } | null> {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const [self] = await tx
        .select({
          name: users.name,
          phoneNumber: users.phoneNumber,
          email: users.email,
          biologicalSex: users.biologicalSex,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!self) return null;

      const [checkin] = await tx
        .select({ answers: checkins.answers, notesCipher: checkins.notesCipher })
        .from(checkins)
        .where(eq(checkins.id, checkinId))
        .limit(1);
      if (!checkin) return null;

      let notes: { difficultExerciseDescription?: string; improvementFeedback?: string } = {};
      if (checkin.notesCipher) {
        try {
          notes = JSON.parse(await this.cipher.decryptHealth(checkin.notesCipher)) as typeof notes;
        } catch {
          notes = {};
        }
      }

      return {
        name: self.name,
        phoneNumber: self.phoneNumber,
        email: self.email,
        biologicalSex: self.biologicalSex,
        answers: checkin.answers as {
          sleepQuality: string;
          mood: string;
          nutritionScore: number;
          adherenceScore: number;
          changesNoticed: string[];
          changesOther?: string;
          durationFit: 'ADEQUADA' | 'MAIS_CURTOS' | 'MAIS_LONGOS';
        },
        notes,
      };
    });
  }
}
