/**
 * Retorno técnico depois de cada treino concluído:
 *
 *   treino fechado → resumo técnico (feito × previsto × última vez, carga e prontidão)
 *                  → especialista da modalidade lê e devolve uma análise específica
 *                  → a persona conta ao aluno, em tom didático, pelo WhatsApp.
 *
 * Sessões com dor relatada seguem pelo fluxo de dor (outro especialista, com adaptação); aqui o
 * foco é treino sem queixa. O envio é idempotente por execução.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lt, ne } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { personaOf, type EnduranceMetrics } from '@movivo/shared';

import type { AgentContextSources } from '../../core/agents/agent-context';
import { AgentRunner, AgentTaskError } from '../../core/agents/agent-runner';
import {
  dailyCheckIns,
  executionMetrics,
  executionSets,
  planSessions,
  scheduledSessions,
  sessionExecutions,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { ConversationStore } from '../conversation/conversation-store';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { addDays } from '../planning/calc/week-planner';
import { todayIn } from '../planning/plan-generation.service';
import { StudentStateReader } from '../student-state/student-state.reader';
import { AgentMessenger } from './agent-messenger';
import { SessionSnapshotService } from './session-snapshot.service';
import { loadMetricsView } from './load-metrics';
import { collectLoadMetrics } from './load-metrics-data';
import {
  enduranceDigest,
  strengthDigest,
  type PlannedExercise,
  type PreviousSets,
  type SetRow,
} from './session-digest';
import {
  enduranceReviewTask,
  strengthReviewTask,
  workoutFeedbackTask,
  type WorkoutReviewInput,
} from './workout-feedback-tasks';

const MARKER_TTL_SECONDS = 14 * 86_400;
const RECENT_DAYS = 28;
const SETS_LOOKBACK_LIMIT = 400;
const FINISHED = ['COMPLETED', 'PARTIAL'];

export type WorkoutFeedbackResult =
  | {
      status: 'SKIPPED';
      reason:
        | 'NOT_FINISHED'
        | 'PAIN_FLOW'
        | 'ALREADY_HANDLED'
        | 'NO_DATA'
        | 'NO_VALID_REVIEW'
        | 'NO_VALID_MESSAGE';
    }
  | { status: 'SENT'; verdict: string };

@Injectable()
export class WorkoutFeedbackService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly runner: AgentRunner,
    private readonly state: StudentStateReader,
    private readonly methodology: PublishedMethodologyReader,
    private readonly store: ConversationStore,
    private readonly messenger: AgentMessenger,
    private readonly snapshots: SessionSnapshotService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WorkoutFeedbackService.name);
  }

  async handle(
    userId: string,
    executionId: string,
    now: Date = new Date(),
  ): Promise<WorkoutFeedbackResult> {
    const marker = this.keys.forUser(userId, 'workout-feedback', 'execution', executionId);
    if ((await this.redis.set(marker, '1', 'EX', MARKER_TTL_SECONDS, 'NX')) === null) {
      return { status: 'SKIPPED', reason: 'ALREADY_HANDLED' };
    }
    try {
      const result = await this.run(userId, executionId, now);
      // Sem retorno enviado por falta de leitura válida, o retry do job tenta de novo.
      if (result.status === 'SKIPPED' && result.reason.startsWith('NO_VALID')) {
        await this.redis.del(marker);
      }
      return result;
    } catch (error) {
      await this.redis.del(marker);
      throw error;
    }
  }

  private async run(
    userId: string,
    executionId: string,
    now: Date,
  ): Promise<WorkoutFeedbackResult> {
    const stateRead = await this.state.read(userId, ['identity'], now);
    const identity = stateRead.slices.identity as
      { timezone?: string | null; biologicalSex?: string | null } | undefined;
    const today = todayIn(identity?.timezone ?? null, now);

    const built = await this.db.runAsUser(userId, 'USER', (tx) =>
      this.buildInput(tx, userId, executionId, today),
    );
    if (built === 'NOT_FINISHED' || built === 'PAIN_FLOW') {
      return { status: 'SKIPPED', reason: built };
    }
    if (built === null) return { status: 'SKIPPED', reason: 'NO_DATA' };
    // Sessão lado a lado com a disposição do dia e com a última vez da mesma sessão.
    await this.snapshots.capture(userId, executionId);
    const reviewInput: WorkoutReviewInput = {
      ...built,
      sessionComparison: await this.snapshots.view(userId, executionId),
    };

    const sources = this.sources(userId, now);
    const task = reviewInput.modality === 'STRENGTH' ? strengthReviewTask : enduranceReviewTask;
    let review;
    try {
      review = (await this.runner.run(task, reviewInput, { userId, sources })).output;
    } catch (error) {
      if (!(error instanceof AgentTaskError)) throw error;
      this.logger.warn({ userId, executionId, taskId: error.taskId }, 'treino sem leitura válida');
      return { status: 'SKIPPED', reason: 'NO_VALID_REVIEW' };
    }

    const { firstName } = await this.store.loadUser(userId);
    let messages: string[];
    try {
      messages = (
        await this.runner.run(
          workoutFeedbackTask,
          {
            firstName,
            modality: reviewInput.modality,
            title: reviewInput.title,
            status: reviewInput.status,
            review,
          },
          { userId, sources, persona: personaOf(identity?.biologicalSex) },
        )
      ).output.messages;
    } catch (error) {
      if (!(error instanceof AgentTaskError)) throw error;
      this.logger.warn({ userId, executionId, taskId: error.taskId }, 'retorno sem texto válido');
      return { status: 'SKIPPED', reason: 'NO_VALID_MESSAGE' };
    }
    await this.messenger.send(userId, messages, `workout_${executionId}`);
    this.logger.info(
      { event: 'workout_feedback', userId, executionId, verdict: review.verdict },
      'retorno do treino enviado',
    );
    return { status: 'SENT', verdict: review.verdict };
  }

  /** Reúne o resumo técnico do treino. `null` quando não há o que analisar. */
  private async buildInput(
    tx: Parameters<Parameters<TenantDatabase['runAsUser']>[2]>[0],
    userId: string,
    executionId: string,
    today: string,
  ): Promise<Omit<WorkoutReviewInput, 'sessionComparison'> | 'NOT_FINISHED' | 'PAIN_FLOW' | null> {
    const [execution] = await tx
      .select()
      .from(sessionExecutions)
      .where(and(eq(sessionExecutions.id, executionId), eq(sessionExecutions.userId, userId)));
    if (!execution) return null;
    if (!FINISHED.includes(execution.status)) return 'NOT_FINISHED';
    if (execution.painReports.length > 0) return 'PAIN_FLOW';
    if (execution.modality !== 'STRENGTH' && execution.rpe === null) return null;

    const [scheduled] = execution.scheduledSessionId
      ? await tx
          .select({
            title: planSessions.title,
            content: planSessions.content,
            minutes: planSessions.estimatedMinutes,
            load: planSessions.estimatedLoad,
          })
          .from(scheduledSessions)
          .innerJoin(planSessions, eq(planSessions.id, scheduledSessions.planSessionId))
          .where(eq(scheduledSessions.id, execution.scheduledSessionId))
      : [];

    const recent = await tx
      .select({ rpe: sessionExecutions.rpe })
      .from(sessionExecutions)
      .where(
        and(
          eq(sessionExecutions.userId, userId),
          inArray(sessionExecutions.status, FINISHED),
          gte(sessionExecutions.performedOn, addDays(execution.performedOn, -RECENT_DAYS)),
        ),
      );
    const rpes = recent.map((r) => r.rpe).filter((rpe): rpe is number => rpe !== null);

    const [checkIn] = await tx
      .select()
      .from(dailyCheckIns)
      .where(
        and(eq(dailyCheckIns.userId, userId), eq(dailyCheckIns.onDate, execution.performedOn)),
      );
    const loadMetrics = await collectLoadMetrics(
      tx,
      userId,
      execution.performedOn > today ? today : execution.performedOn,
    );

    const base = {
      title: scheduled?.title ?? null,
      status: execution.status as 'COMPLETED' | 'PARTIAL',
      rpe: execution.rpe,
      durationMinutes: execution.durationMinutes,
      load: execution.load,
      enjoyment: execution.enjoyment,
      planned: {
        minutes: scheduled?.minutes ?? null,
        load: scheduled?.load ?? null,
        kind: scheduled?.content.modality === 'RUNNING' ? scheduled.content.kind : null,
      },
      recent: {
        sessions28d: recent.length,
        avgRpe28d:
          rpes.length > 0
            ? Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10
            : null,
      },
      checkIn: checkIn
        ? {
            energy: checkIn.energy,
            sleep: checkIn.sleep,
            soreness: checkIn.soreness,
            mood: checkIn.mood,
            stress: checkIn.stress,
          }
        : null,
      loadMetrics: loadMetricsView(loadMetrics),
    };

    if (execution.modality === 'STRENGTH') {
      const planned: PlannedExercise[] =
        scheduled?.content.modality === 'STRENGTH'
          ? scheduled.content.exercises.map((e) => ({
              exerciseId: e.exerciseId,
              name: e.name,
              sets: e.sets,
              reps: e.reps,
              durationSeconds: e.durationSeconds,
              rir: e.rir,
              loadStrategy: e.loadStrategy,
            }))
          : [];
      const sets: SetRow[] = await tx
        .select({
          exerciseId: executionSets.exerciseId,
          setNumber: executionSets.setNumber,
          reps: executionSets.reps,
          loadKg: executionSets.loadKg,
          durationSeconds: executionSets.durationSeconds,
          rir: executionSets.rir,
          completed: executionSets.completed,
        })
        .from(executionSets)
        .where(eq(executionSets.executionId, executionId));
      if (sets.filter((s) => s.completed).length === 0) return null;
      // Sem prescrição (treino avulso), os exercícios feitos viram o "previsto" de cada um.
      const exercises: PlannedExercise[] =
        planned.length > 0
          ? planned
          : [...new Set(sets.map((s) => s.exerciseId))].map((exerciseId) => ({
              exerciseId,
              name: exerciseId.replaceAll('_', ' '),
              sets: sets.filter((s) => s.exerciseId === exerciseId && s.setNumber >= 1).length,
              loadStrategy: 'RIR',
            }));
      const previous = await this.previousSets(tx, userId, execution, exercises);
      const previousTonnage = [...previous.values()].reduce(
        (total, p) => total + p.sets.reduce((sum, s) => sum + (s.reps ?? 0) * (s.loadKg ?? 0), 0),
        0,
      );
      return {
        ...base,
        modality: 'STRENGTH',
        strength: strengthDigest({
          planned: exercises,
          sets,
          previous,
          previousSessionTonnageKg: previousTonnage > 0 ? Math.round(previousTonnage) : null,
        }),
        endurance: null,
      };
    }

    const [metrics] = await tx
      .select({ metrics: executionMetrics.metrics })
      .from(executionMetrics)
      .where(eq(executionMetrics.executionId, executionId));
    const [before] = await tx
      .select({ date: sessionExecutions.performedOn, metrics: executionMetrics.metrics })
      .from(sessionExecutions)
      .innerJoin(executionMetrics, eq(executionMetrics.executionId, sessionExecutions.id))
      .where(
        and(
          eq(sessionExecutions.userId, userId),
          eq(sessionExecutions.modality, execution.modality),
          inArray(sessionExecutions.status, FINISHED),
          ne(sessionExecutions.id, executionId),
          lt(sessionExecutions.performedOn, execution.performedOn),
        ),
      )
      .orderBy(desc(sessionExecutions.performedOn))
      .limit(1);
    return {
      ...base,
      modality: execution.modality as 'RUNNING' | 'HYROX' | 'EXTERNAL_SPORT',
      strength: null,
      endurance: enduranceDigest({
        metrics: (metrics?.metrics ?? {}) as EnduranceMetrics,
        durationMinutes: execution.durationMinutes,
        previous: before ? { date: before.date, metrics: before.metrics } : null,
      }),
    };
  }

  /** A última vez que cada exercício foi feito antes desta sessão. */
  private async previousSets(
    tx: Parameters<Parameters<TenantDatabase['runAsUser']>[2]>[0],
    userId: string,
    execution: { id: string; performedOn: string },
    exercises: readonly PlannedExercise[],
  ): Promise<Map<string, PreviousSets>> {
    const ids = exercises.map((e) => e.exerciseId);
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select({
        executionId: executionSets.executionId,
        date: sessionExecutions.performedOn,
        exerciseId: executionSets.exerciseId,
        setNumber: executionSets.setNumber,
        reps: executionSets.reps,
        loadKg: executionSets.loadKg,
        durationSeconds: executionSets.durationSeconds,
        rir: executionSets.rir,
        completed: executionSets.completed,
      })
      .from(executionSets)
      .innerJoin(sessionExecutions, eq(sessionExecutions.id, executionSets.executionId))
      .where(
        and(
          eq(executionSets.userId, userId),
          inArray(executionSets.exerciseId, ids),
          inArray(sessionExecutions.status, FINISHED),
          ne(sessionExecutions.id, execution.id),
          lt(sessionExecutions.performedOn, execution.performedOn),
        ),
      )
      .orderBy(desc(sessionExecutions.performedOn))
      .limit(SETS_LOOKBACK_LIMIT);
    const latest = new Map<string, { executionId: string; date: string }>();
    for (const row of rows) {
      if (!latest.has(row.exerciseId)) latest.set(row.exerciseId, row);
    }
    const out = new Map<string, PreviousSets>();
    for (const [exerciseId, ref] of latest) {
      out.set(exerciseId, {
        date: ref.date,
        sets: rows.filter((r) => r.exerciseId === exerciseId && r.executionId === ref.executionId),
      });
    }
    return out;
  }

  private sources(userId: string, now: Date): AgentContextSources {
    return {
      methodology: (domains) => this.methodology.render(domains),
      state: (slices) => this.state.read(userId, slices, now),
    };
  }
}
