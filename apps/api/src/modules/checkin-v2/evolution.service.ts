/** Leitura da evolução do aluno: metas, medidas ao longo do tempo e treinos concluídos. */
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm';

import type {
  GoalMilestone,
  GoalStrategy,
  MeasurementInput,
  MeasurementKind,
  SessionContent,
  StudentProgress,
} from '@movivo/shared';
import { studentProgressOf } from '@movivo/shared';

import {
  bodyMeasurements,
  executionMetrics,
  executionSets,
  goalMilestones,
  goalTasks,
  planSessions,
  scheduledSessions,
  sessionExecutions,
  studentGoals,
  users,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { addDays, mondayOf } from '../planning/calc/week-planner';
import { todayIn } from '../planning/plan-generation.service';

const WEEKS = 8;
/** Quanto do histórico entra na constância e na progressão dos treinos. */
const HISTORY_DAYS = 120;

export interface EvolutionView {
  firstName: string | null;
  strategyTitle: string | null;
  strategy: GoalStrategy | null;
  milestones: { milestone: GoalMilestone; dueOn: string; status: string }[];
  tasks: { title: string; target: number; progress: number; windowEnd: string; status: string }[];
  measurements: Record<string, { on: string; value: number }[]>;
  weeks: { weekStart: string; sessions: number; load: number }[];
  /** Constância, últimas semanas, progressão por modalidade, recordes e previsões. */
  progress: StudentProgress;
}

@Injectable()
export class EvolutionService {
  constructor(private readonly db: TenantDatabase) {}

  async read(userId: string, now: Date = new Date()): Promise<EvolutionView> {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const [user] = await tx
        .select({ name: users.name, timezone: users.timezone })
        .from(users)
        .where(eq(users.id, userId));
      const today = todayIn(user?.timezone ?? null, now);
      const [goal] = await tx
        .select()
        .from(studentGoals)
        .where(and(eq(studentGoals.userId, userId), eq(studentGoals.status, 'ACTIVE')))
        .limit(1);
      const milestones = goal
        ? await tx
            .select()
            .from(goalMilestones)
            .where(eq(goalMilestones.goalId, goal.id))
            .orderBy(asc(goalMilestones.ordinal))
        : [];
      const tasks = goal
        ? await tx
            .select()
            .from(goalTasks)
            .where(eq(goalTasks.goalId, goal.id))
            .orderBy(desc(goalTasks.windowEnd))
            .limit(10)
        : [];
      const measures = await tx
        .select()
        .from(bodyMeasurements)
        .where(eq(bodyMeasurements.userId, userId))
        .orderBy(asc(bodyMeasurements.measuredOn));
      const measurements: EvolutionView['measurements'] = {};
      for (const m of measures) {
        (measurements[m.kind] ??= []).push({ on: m.measuredOn, value: m.value });
      }

      const firstWeek = addDays(mondayOf(today), -7 * (WEEKS - 1));
      const executions = await tx
        .select({
          performedOn: sessionExecutions.performedOn,
          load: sessionExecutions.load,
          status: sessionExecutions.status,
        })
        .from(sessionExecutions)
        .where(
          and(eq(sessionExecutions.userId, userId), gte(sessionExecutions.performedOn, firstWeek)),
        );
      const weeks = Array.from({ length: WEEKS }, (_, i) => {
        const weekStart = addDays(firstWeek, i * 7);
        const end = addDays(weekStart, 6);
        const inWeek = executions.filter(
          (e) => e.performedOn >= weekStart && e.performedOn <= end && e.status !== 'ABANDONED',
        );
        return {
          weekStart,
          sessions: inWeek.length,
          load: inWeek.reduce((sum, e) => sum + (e.load ?? 0), 0),
        };
      });

      const progress = await this.progressOf(tx, userId, today);

      return {
        progress,
        firstName: user?.name?.trim().split(/\s+/)[0] ?? null,
        strategyTitle: goal?.strategy?.title ?? null,
        strategy: goal?.strategy ?? null,
        milestones: milestones.map((m) => ({
          milestone: m.milestone,
          dueOn: m.dueOn,
          status: m.status,
        })),
        tasks: tasks.map((t) => ({
          title: t.title,
          target: t.target,
          progress: t.progress,
          windowEnd: t.windowEnd,
          status: t.status,
        })),
        measurements,
        weeks,
      };
    });
  }

  /** Os registros do histórico que alimentam a constância e a progressão dos treinos. */
  private async progressOf(
    tx: Parameters<Parameters<TenantDatabase['runAsUser']>[2]>[0],
    userId: string,
    today: string,
  ): Promise<StudentProgress> {
    const since = addDays(today, -HISTORY_DAYS);
    const scheduled = await tx
      .select({ date: scheduledSessions.scheduledOn, status: scheduledSessions.status })
      .from(scheduledSessions)
      .where(and(eq(scheduledSessions.userId, userId), gte(scheduledSessions.scheduledOn, since)));
    const executions = await tx
      .select({
        id: sessionExecutions.id,
        date: sessionExecutions.performedOn,
        status: sessionExecutions.status,
        modality: sessionExecutions.modality,
        durationMinutes: sessionExecutions.durationMinutes,
        planSessionId: sessionExecutions.planSessionId,
      })
      .from(sessionExecutions)
      .where(and(eq(sessionExecutions.userId, userId), gte(sessionExecutions.performedOn, since)));
    const ids = executions.map((e) => e.id);
    const metrics = ids.length
      ? await tx
          .select({
            executionId: executionMetrics.executionId,
            metrics: executionMetrics.metrics,
            confirmed: executionMetrics.confirmed,
          })
          .from(executionMetrics)
          .where(inArray(executionMetrics.executionId, ids))
      : [];
    const sets = ids.length
      ? await tx
          .select({
            executionId: executionSets.executionId,
            exerciseId: executionSets.exerciseId,
            reps: executionSets.reps,
            loadKg: executionSets.loadKg,
            completed: executionSets.completed,
            setNumber: executionSets.setNumber,
          })
          .from(executionSets)
          .where(inArray(executionSets.executionId, ids))
      : [];
    // Nome do exercício como estava no treino do aluno.
    const planIds = [
      ...new Set(executions.map((e) => e.planSessionId).filter(Boolean)),
    ] as string[];
    const contents = planIds.length
      ? await tx
          .select({ content: planSessions.content })
          .from(planSessions)
          .where(inArray(planSessions.id, planIds))
      : [];
    const exerciseNames = new Map<string, string>();
    for (const { content } of contents as { content: SessionContent }[]) {
      if (content.modality !== 'STRENGTH') continue;
      for (const exercise of content.exercises)
        exerciseNames.set(exercise.exerciseId, exercise.name);
    }
    const dateOf = new Map(executions.map((e) => [e.id, e.date]));
    const finished = new Set(
      executions.filter((e) => e.status === 'COMPLETED' || e.status === 'PARTIAL').map((e) => e.id),
    );
    return studentProgressOf({
      today,
      scheduled,
      executions: executions.map((e) => {
        const m = metrics.find((row) => row.executionId === e.id);
        return { ...e, metrics: m?.confirmed ? m.metrics : null };
      }),
      sets: sets
        .filter((s) => s.completed && s.setNumber >= 1 && finished.has(s.executionId))
        .map((s) => ({
          executionId: s.executionId,
          date: dateOf.get(s.executionId) ?? today,
          exerciseId: s.exerciseId,
          reps: s.reps,
          loadKg: s.loadKg,
        })),
      exerciseNames,
    });
  }

  /** Medidas informadas pelo aluno (opcionais). */
  async addMeasurements(userId: string, items: readonly MeasurementInput[]): Promise<number> {
    if (items.length === 0) return 0;
    await this.db.runAsUser(userId, 'USER', (tx) =>
      tx.insert(bodyMeasurements).values(
        items.map((item) => ({
          userId,
          kind: item.kind as MeasurementKind,
          value: item.value,
          method: item.method,
          measuredOn: item.measuredOn,
        })),
      ),
    );
    return items.length;
  }
}
