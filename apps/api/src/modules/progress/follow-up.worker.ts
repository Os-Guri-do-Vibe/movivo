/**
 * Acompanhamento em tempo real: o que o aluno faz no dia a dia dispara a análise dos agentes sem
 * esperar a revisão da semana. Hoje: dor relatada, retorno técnico depois de cada treino concluído e busca ativa de treino perdido. O evento de domínio só
 * enfileira; o trabalho (agentes, adaptação e conversa) roda no worker, idempotente por execução.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { DomainEventHandlers, type DomainEvent } from '../domain-events/domain-event-handlers';
import type { FollowUpJob } from '../jobs/follow-up.contract';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import { ConversationStore } from '../conversation/conversation-store';
import { todayIn } from '../planning/plan-generation.service';
import { MemoryCuratorService } from './memory-curator.service';
import { CareScheduler } from './care.scheduler';
import { CareService } from './care.service';
import { MealRoutineService } from './meal-routine.service';
import { MessageQualityService } from './message-quality.service';
import { SpecialistDailyService } from './specialist-daily.service';
import { MissedSessionService } from './missed-session.service';
import { SessionSnapshotService } from './session-snapshot.service';
import { SpecialistFollowUpScheduler } from './specialist-follow-up.scheduler';
import { NutritionFollowUpService } from './nutrition-follow-up.service';
import { PainGuidanceService } from './pain-guidance.service';
import { TrainingFollowUpService } from './training-follow-up.service';
import { WorkoutFeedbackService } from './workout-feedback.service';

/** Dá tempo de o aluno terminar de responder o check-in antes da leitura dos especialistas. */
const SPECIALIST_DAILY_DELAY_MS = 5 * 60_000;

@Injectable()
export class FollowUpWorker implements OnModuleInit {
  constructor(
    private readonly handlers: DomainEventHandlers,
    private readonly queues: QueueManager,
    private readonly workers: WorkerFactory,
    private readonly pain: PainGuidanceService,
    private readonly feedback: WorkoutFeedbackService,
    private readonly missed: MissedSessionService,
    private readonly curator: MemoryCuratorService,
    private readonly nutrition: NutritionFollowUpService,
    private readonly training: TrainingFollowUpService,
    private readonly specialistScan: SpecialistFollowUpScheduler,
    private readonly mealRoutine: MealRoutineService,
    private readonly specialistDaily: SpecialistDailyService,
    private readonly snapshots: SessionSnapshotService,
    private readonly care: CareService,
    private readonly careScan: CareScheduler,
    private readonly quality: MessageQualityService,
    private readonly store: ConversationStore,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(FollowUpWorker.name);
  }

  async onModuleInit(): Promise<void> {
    this.handlers.register({
      name: 'follow-up.session-executed',
      eventTypes: ['SessionExecuted'],
      handle: (event) => this.onSessionExecuted(event),
    });
    this.handlers.register({
      name: 'follow-up.check-in-submitted',
      eventTypes: ['CheckInSubmitted'],
      handle: (event) => this.onCheckInSubmitted(event),
    });
    this.handlers.register({
      name: 'follow-up.session-missed',
      eventTypes: ['SessionMissed'],
      handle: (event) => this.onSessionMissed(event),
    });
    this.workers.create<FollowUpJob>(QUEUE.studentFollowUp, async (job) => {
      const data = job.data;
      if (data.kind === 'SCAN') {
        // A execução manual do painel diz qual dos dois crons desta fila foi pedido.
        if (data.scriptId === 'meal-routine-scan') return this.mealRoutine.scan();
        if (data.scriptId === 'care-scan') {
          return this.careScan.scan(new Date(), { force: data.force === true });
        }
        return this.specialistScan.scan(new Date(), { force: data.force === true });
      }
      if (data.kind === 'MEAL_SCAN') return this.mealRoutine.scan();
      if (data.kind === 'CARE_SCAN') return this.careScan.scan();
      if (data.kind === 'QUALITY_REVIEW') return this.quality.review(data);
      if (data.kind === 'CARE') {
        return data.task === 'DAILY'
          ? this.care.daily(data.userId)
          : data.task === 'NIGHTLY'
            ? this.care.nightly(data.userId)
            : this.care.closeDigest(data.userId);
      }
      const result =
        data.kind === 'PAIN'
          ? await this.pain.handle(data.userId, data.executionId)
          : data.kind === 'WORKOUT_FEEDBACK'
            ? await this.feedback.handle(data.userId, data.executionId)
            : data.kind === 'SPECIALIST_DAILY'
              ? await this.specialistDaily.handle(data.userId, {
                  source: data.source,
                  replyAlways: data.replyAlways,
                })
              : data.kind === 'MEAL_REMINDER'
                ? await this.mealRoutine.reminder(data.userId, data.slot)
                : data.kind === 'DAY_SUMMARY'
                  ? await this.mealRoutine.daySummary(data.userId)
                  : data.kind === 'LOGGING_GAP'
                    ? await this.mealRoutine.loggingGap(data.userId)
                    : data.kind === 'MISSED_SESSION'
                      ? await this.missed.handle(data.userId)
                      : data.kind === 'NUTRITION_FOLLOW_UP'
                        ? await this.nutrition.handle(data.userId)
                        : data.kind === 'TRAINING_FOLLOW_UP'
                          ? await this.training.handle(data.userId)
                          : await this.curator.handle(data.userId);
      this.logger.info({ job: data.kind, status: result.status }, 'acompanhamento processado');
      return result;
    });
    await this.queues
      .get(QUEUE.studentFollowUp)
      .upsertJobScheduler(
        'specialist-follow-up-scan',
        { pattern: '* * * * *', tz: 'UTC' },
        { name: 'specialist-follow-up-scan', data: { kind: 'SCAN' } satisfies FollowUpJob },
      );
    await this.queues
      .get(QUEUE.studentFollowUp)
      .upsertJobScheduler(
        'care-scan',
        { pattern: '* * * * *', tz: 'UTC' },
        { name: 'care-scan', data: { kind: 'CARE_SCAN' } satisfies FollowUpJob },
      );
    await this.queues
      .get(QUEUE.studentFollowUp)
      .upsertJobScheduler(
        'meal-routine-scan',
        { pattern: '* * * * *', tz: 'UTC' },
        { name: 'meal-routine-scan', data: { kind: 'MEAL_SCAN' } satisfies FollowUpJob },
      );
  }

  /** Dor vai para o especialista de recuperação; treino sem queixa recebe o retorno técnico. */
  private async onSessionExecuted(event: DomainEvent): Promise<void> {
    const { executionId, painCount, status } = event.payload;
    if (!event.userId || typeof executionId !== 'string') return;
    // Todo treino concluído vira dado comparável de sessão a sessão, com ou sem queixa de dor.
    if (status === 'COMPLETED' || status === 'PARTIAL') {
      await this.snapshots.capture(event.userId, executionId).catch((err: unknown) => {
        this.logger.warn({ err, executionId, event: 'session_snapshot_failed' }, 'snapshot falhou');
      });
    }
    if (Number(painCount) > 0) {
      const job: FollowUpJob = { kind: 'PAIN', userId: event.userId, executionId };
      await this.queues.enqueue(QUEUE.studentFollowUp, 'pain-guidance', job, {
        jobId: `pain-guidance_${executionId}`,
      });
      return;
    }
    if (status !== 'COMPLETED' && status !== 'PARTIAL') return;
    const job: FollowUpJob = { kind: 'WORKOUT_FEEDBACK', userId: event.userId, executionId };
    await this.queues.enqueue(QUEUE.studentFollowUp, 'workout-feedback', job, {
      jobId: `workout-feedback_${executionId}`,
    });
    await this.enqueueDailyRead(event.userId);
  }

  /** O check-in do dia (descanso) acorda os especialistas na hora; o semanal tem o fluxo dele. */
  private async onCheckInSubmitted(event: DomainEvent): Promise<void> {
    if (!event.userId || event.payload.scope !== 'DAILY') return;
    await this.enqueueDailyRead(event.userId);
  }

  /** Uma leitura por aluno e dia, alguns minutos depois (o aluno pode ainda estar respondendo). */
  private async enqueueDailyRead(userId: string): Promise<void> {
    const { timezone } = await this.store.loadUser(userId);
    const job: FollowUpJob = { kind: 'SPECIALIST_DAILY', userId, source: 'CHECK_IN' };
    await this.queues.enqueue(QUEUE.studentFollowUp, 'specialist-daily', job, {
      jobId: `specialist-daily_${userId}_${todayIn(timezone, new Date())}`,
      delay: SPECIALIST_DAILY_DELAY_MS,
    });
  }

  /** Treino perdido: a busca ativa sai assim que a agenda fecha o dia (a MOVIVO atende 24/7). */
  private async onSessionMissed(event: DomainEvent): Promise<void> {
    if (!event.userId) return;
    const { timezone } = await this.store.loadUser(event.userId);
    const job: FollowUpJob = { kind: 'MISSED_SESSION', userId: event.userId };
    await this.queues.enqueue(QUEUE.studentFollowUp, 'missed-session', job, {
      jobId: `missed-session_${event.userId}_${todayIn(timezone, new Date())}`,
    });
  }
}
