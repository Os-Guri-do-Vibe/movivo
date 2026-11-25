/**
 * Acompanhamento semanal de treino:
 *
 *   semana do aluno em números (adesão, esforço, carga, prontidão, progressão dos exercícios) →
 *   o treinador lê e, se os dados pedem, altera o protocolo (volume, exercícios, estrutura,
 *   progressão) dentro da zona segura; o rascunho passa pelas políticas e pela auditoria →
 *   a persona conta ao aluno o que viu, o que muda e a tentativa de progressão da semana.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { personaOf, type DeclaredGoalKind } from '@movivo/shared';

import type { AgentContextSources } from '../../core/agents/agent-context';
import { AgentRunner, AgentTaskError } from '../../core/agents/agent-runner';
import { executionSets, sessionExecutions, trainingPlans } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { ConversationStore } from '../conversation/conversation-store';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { addDays, mondayOf } from '../planning/calc/week-planner';
import { reviewWeekStart } from './review-week';
import { isDeloadWeek, weekIndexOf } from '../planning/calc/rollover';
import { PlanGenerationService, todayIn } from '../planning/plan-generation.service';
import { CommitmentService } from '../student-state/commitment.service';
import { StudentStateReader } from '../student-state/student-state.reader';
import { AgentMessenger } from './agent-messenger';
import { loadMetricsView } from './load-metrics';
import { collectLoadMetrics } from './load-metrics-data';
import { collectWeeks } from './review-data';
import {
  trainingFollowUpTask,
  trainingTalkTask,
  type TrainingFollowUp,
  type TrainingFollowUpInput,
} from './training-follow-up-tasks';
import { SessionSnapshotService } from './session-snapshot.service';
import { GOAL_DIRECTION } from './weekly-review.service';

const MARKER_TTL_SECONDS = 10 * 86_400;
const WEEKS = 3;
const PROGRESSION_DAYS = 35;
const TOP_EXERCISES = 6;
const FINISHED = ['COMPLETED', 'PARTIAL'];

export type TrainingFollowUpResult =
  | {
      status: 'SKIPPED';
      reason:
        'NO_PLAN' | 'NO_ACTIVITY' | 'ALREADY_HANDLED' | 'NO_VALID_READING' | 'NO_VALID_MESSAGE';
    }
  | { status: 'SENT'; readingStatus: TrainingFollowUp['status']; adjusted: boolean };

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

@Injectable()
export class TrainingFollowUpService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly runner: AgentRunner,
    private readonly state: StudentStateReader,
    private readonly methodology: PublishedMethodologyReader,
    private readonly generation: PlanGenerationService,
    private readonly store: ConversationStore,
    private readonly messenger: AgentMessenger,
    private readonly snapshots: SessionSnapshotService,
    private readonly commitments: CommitmentService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TrainingFollowUpService.name);
  }

  async handle(userId: string, now: Date = new Date()): Promise<TrainingFollowUpResult> {
    const read = await this.state.read(userId, ['identity', 'goals'], now);
    const identity = read.slices.identity as
      { timezone?: string | null; biologicalSex?: string | null } | undefined;
    const today = todayIn(identity?.timezone ?? null, now);
    const marker = this.keys.forUser(userId, 'training-follow-up', 'week', mondayOf(today));
    if ((await this.redis.set(marker, '1', 'EX', MARKER_TTL_SECONDS, 'NX')) === null) {
      return { status: 'SKIPPED', reason: 'ALREADY_HANDLED' };
    }
    try {
      const declared = (read.slices.goals as { declared?: { primary?: DeclaredGoalKind } } | null)
        ?.declared;
      const direction = (declared?.primary && GOAL_DIRECTION[declared.primary]) || 'MAINTAIN';
      const result = await this.run(userId, today, direction, identity, now);
      if (result.status === 'SKIPPED') await this.redis.del(marker);
      return result;
    } catch (error) {
      await this.redis.del(marker);
      throw error;
    }
  }

  private async run(
    userId: string,
    today: string,
    direction: TrainingFollowUpInput['goalDirection'],
    identity: { biologicalSex?: string | null } | undefined,
    now: Date,
  ): Promise<TrainingFollowUpResult> {
    const base = await this.db.runAsUser(userId, 'USER', (tx) =>
      this.buildInput(tx, userId, today, direction),
    );
    if (base === 'NO_PLAN') return { status: 'SKIPPED', reason: 'NO_PLAN' };
    if (base === 'NO_ACTIVITY') return { status: 'SKIPPED', reason: 'NO_ACTIVITY' };
    const input: TrainingFollowUpInput = {
      ...base,
      sessionHistory: await this.snapshots.recent(userId),
      openCommitments: await this.commitments.openForReview(userId, ['TRAINING', 'HABITS'], today),
    };

    const sources = this.sources(userId, now);
    let reading: TrainingFollowUp;
    try {
      reading = (await this.runner.run(trainingFollowUpTask, input, { userId, sources })).output;
    } catch (error) {
      if (!(error instanceof AgentTaskError)) throw error;
      this.logger.warn({ userId, taskId: error.taskId }, 'treino sem leitura válida');
      return { status: 'SKIPPED', reason: 'NO_VALID_READING' };
    }

    await this.commitments.applyReview(userId, reading.commitmentReview);

    // O especialista altera o protocolo; o rascunho segue pelas políticas e pela auditoria.
    let adjusted = false;
    let protocolChange: string | null = null;
    if (reading.adjustment.kind === 'ADJUST_PROTOCOL') {
      protocolChange = reading.adjustment.reason;
      const result = await this.generation.adjustByInstruction(
        userId,
        'TRAINING',
        reading.adjustment.instruction,
        { now },
      );
      adjusted = result.status === 'ADJUSTED' || result.status === 'PENDING_REVIEW';
      if (!adjusted) protocolChange = null;
    }

    const { firstName } = await this.store.loadUser(userId);
    try {
      const { adjustment: _adjustment, ...followUp } = reading;
      const talk = await this.runner.run(
        trainingTalkTask,
        { firstName, followUp, protocolChange },
        { userId, sources, persona: personaOf(identity?.biologicalSex) },
      );
      await this.messenger.send(userId, talk.output.messages, `training_${userId}_${today}`);
      await this.commitments.record(userId, 'TRAINING', reading.nextStep, today);
    } catch (error) {
      if (!(error instanceof AgentTaskError)) throw error;
      this.logger.warn({ userId, taskId: error.taskId }, 'treino sem texto válido');
      return { status: 'SKIPPED', reason: 'NO_VALID_MESSAGE' };
    }
    this.logger.info(
      { event: 'training_follow_up', userId, status: reading.status, adjusted },
      'acompanhamento de treino enviado',
    );
    return { status: 'SENT', readingStatus: reading.status, adjusted };
  }

  private async buildInput(
    tx: Parameters<Parameters<TenantDatabase['runAsUser']>[2]>[0],
    userId: string,
    today: string,
    direction: TrainingFollowUpInput['goalDirection'],
  ): Promise<
    Omit<TrainingFollowUpInput, 'sessionHistory' | 'openCommitments'> | 'NO_PLAN' | 'NO_ACTIVITY'
  > {
    const [plan] = await tx
      .select({
        startsOn: trainingPlans.startsOn,
        structure: trainingPlans.structure,
        publishedAt: trainingPlans.publishedAt,
      })
      .from(trainingPlans)
      .where(and(eq(trainingPlans.userId, userId), eq(trainingPlans.status, 'ACTIVE')));
    if (!plan) return 'NO_PLAN';

    const lastClosedWeek = reviewWeekStart(today);
    const weeks = await collectWeeks(tx, userId, lastClosedWeek, WEEKS);
    if (weeks.every((w) => w.planned === 0 && w.load === 0)) return 'NO_ACTIVITY';

    const phases = plan.structure.phases;
    const weekIndex = weekIndexOf(plan.startsOn, mondayOf(today));
    let cursor = weekIndex;
    let phase = phases.at(-1);
    for (const candidate of phases) {
      if (cursor < candidate.weeks) {
        phase = candidate;
        break;
      }
      cursor -= candidate.weeks;
    }

    const since = addDays(today, -PROGRESSION_DAYS);
    const sets = await tx
      .select({
        date: sessionExecutions.performedOn,
        executionId: executionSets.executionId,
        exerciseId: executionSets.exerciseId,
        reps: executionSets.reps,
        loadKg: executionSets.loadKg,
        rir: executionSets.rir,
      })
      .from(executionSets)
      .innerJoin(sessionExecutions, eq(sessionExecutions.id, executionSets.executionId))
      .where(
        and(
          eq(executionSets.userId, userId),
          eq(executionSets.completed, true),
          gte(executionSets.setNumber, 1),
          inArray(sessionExecutions.status, FINISHED),
          gte(sessionExecutions.performedOn, since),
        ),
      )
      .orderBy(asc(sessionExecutions.performedOn));
    const perExercise = new Map<string, Map<string, typeof sets>>();
    for (const row of sets) {
      const sessions = perExercise.get(row.exerciseId) ?? new Map<string, typeof sets>();
      sessions.set(row.executionId, [...(sessions.get(row.executionId) ?? []), row]);
      perExercise.set(row.exerciseId, sessions);
    }
    const progression = [...perExercise]
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, TOP_EXERCISES)
      .map(([exerciseId, sessions]) => ({
        exerciseId,
        sessions: [...sessions.values()].slice(-4).map((rows) => {
          const top = [...rows].sort(
            (a, b) => (b.loadKg ?? 0) - (a.loadKg ?? 0) || (b.reps ?? 0) - (a.reps ?? 0),
          )[0];
          const rirs = rows.map((r) => r.rir).filter((r): r is number => r !== null);
          return {
            date: rows[0]?.date ?? today,
            topLoadKg: top?.loadKg ?? null,
            repsAtTop: top?.reps ?? null,
            avgRir:
              rirs.length > 0
                ? Math.round((rirs.reduce((a, b) => a + b, 0) / rirs.length) * 10) / 10
                : null,
            sets: rows.length,
          };
        }),
      }));

    const [lastPlan] = await tx
      .select({ publishedAt: trainingPlans.publishedAt })
      .from(trainingPlans)
      .where(and(eq(trainingPlans.userId, userId), eq(trainingPlans.status, 'ACTIVE')))
      .orderBy(desc(trainingPlans.publishedAt))
      .limit(1);

    return {
      goalDirection: direction,
      protocol: {
        weekNumber: weekIndex + 1,
        totalWeeks: phases.reduce((total, p) => total + p.weeks, 0),
        phaseName: phase?.name ?? 'Fase atual',
        phaseFocus: phase?.focus ?? '',
        plannedDeloadWeek: isDeloadWeek(phases, weekIndex),
        sessionsPerWeek: plan.structure.sessions.reduce((total, s) => total + s.weeklyFrequency, 0),
      },
      weeks,
      loadMetrics: loadMetricsView(await collectLoadMetrics(tx, userId, today)),
      progression,
      daysSinceProtocolChange: lastPlan?.publishedAt
        ? daysBetween(lastPlan.publishedAt.toISOString().slice(0, 10), today)
        : null,
    };
  }

  private sources(userId: string, now: Date): AgentContextSources {
    return {
      methodology: (domains) => this.methodology.render(domains),
      state: (slices) => this.state.read(userId, slices, now),
    };
  }
}
