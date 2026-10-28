import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';

import {
  bodyMeasurements,
  bodyPhotos,
  checkIns,
  foodLogs,
  goalMilestones,
  goalTasks,
  nutritionPlans,
  planSessions,
  sessionExecutions,
  studentGoals,
} from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import { addDays, mondayOf } from '../planning/calc/week-planner';
import {
  evaluateMilestone,
  measurementOf,
  taskProgress,
  taskStatus,
  type TaskWindowCounts,
} from './goal-progress';

const PROTEIN_HIT_RATIO = 0.9;

/** Atualiza microtarefas e marcos da meta ativa a partir dos eventos reais do aluno. */
@Injectable()
export class GoalProgressService {
  constructor(private readonly db: TenantDatabase) {}

  async sync(userId: string, today: string) {
    return this.db.runAsSystem(async (tx) => {
      const [goal] = await tx
        .select()
        .from(studentGoals)
        .where(and(eq(studentGoals.userId, userId), eq(studentGoals.status, 'ACTIVE')))
        .orderBy(desc(studentGoals.version))
        .limit(1);
      if (!goal) return { tasks: 0, milestones: 0, rolled: 0 };

      const proteinFloor = await this.proteinFloor(tx, userId);
      const tasks = await tx.select().from(goalTasks).where(eq(goalTasks.goalId, goal.id));
      let updated = 0;
      let rolled = 0;
      for (const task of tasks) {
        if (task.status !== 'OPEN') continue;
        const counts = await this.countsIn(
          tx,
          userId,
          task.windowStart,
          task.windowEnd < today ? task.windowEnd : today,
          proteinFloor,
        );
        const progress = taskProgress(task.kind as never, counts);
        if (progress === null) continue;
        const status = taskStatus(progress, task.target, task.windowEnd, today);
        if (progress !== task.progress || status !== 'OPEN') {
          await tx
            .update(goalTasks)
            .set({
              progress,
              status,
              completedAt: status === 'DONE' ? new Date() : null,
            })
            .where(eq(goalTasks.id, task.id));
          updated += 1;
        }
      }
      // Tarefa semanal que fechou abre a janela da semana corrente (mesmo tipo, título e alvo).
      const thisWeek = mondayOf(today);
      for (const task of tasks) {
        const weekly = Date.parse(task.windowEnd) - Date.parse(task.windowStart) === 6 * 86_400_000;
        if (!weekly || task.windowEnd >= thisWeek) continue;
        const inserted = await tx
          .insert(goalTasks)
          .values({
            userId,
            goalId: goal.id,
            kind: task.kind,
            title: task.title,
            windowStart: thisWeek,
            windowEnd: addDays(thisWeek, 6),
            target: task.target,
          })
          .onConflictDoNothing()
          .returning({ id: goalTasks.id });
        rolled += inserted.length;
      }

      const milestones = await this.resolveMilestones(tx, userId, goal, today);
      return { tasks: updated, milestones, rolled };
    });
  }

  private async proteinFloor(tx: TenantTransaction, userId: string): Promise<number | null> {
    const [plan] = await tx
      .select({ structure: nutritionPlans.structure })
      .from(nutritionPlans)
      .where(and(eq(nutritionPlans.userId, userId), eq(nutritionPlans.status, 'ACTIVE')));
    if (!plan) return null;
    return (
      Math.min(plan.structure.trainingDay.proteinG, plan.structure.restDay.proteinG) *
      PROTEIN_HIT_RATIO
    );
  }

  private async countsIn(
    tx: TenantTransaction,
    userId: string,
    from: string,
    to: string,
    proteinFloor: number | null,
  ): Promise<TaskWindowCounts> {
    const executions = await tx
      .select({ priority: planSessions.priority })
      .from(sessionExecutions)
      .leftJoin(planSessions, eq(planSessions.id, sessionExecutions.planSessionId))
      .where(
        and(
          eq(sessionExecutions.userId, userId),
          inArray(sessionExecutions.status, ['COMPLETED', 'PARTIAL']),
          gte(sessionExecutions.performedOn, from),
          lte(sessionExecutions.performedOn, to),
        ),
      );
    const meals = await tx
      .select({
        day: foodLogs.loggedOn,
        protein: sql<number>`sum((${foodLogs.totals}->>'proteinG')::numeric)`.mapWith(Number),
      })
      .from(foodLogs)
      .where(
        and(
          eq(foodLogs.userId, userId),
          eq(foodLogs.confirmed, true),
          gte(foodLogs.loggedOn, from),
          lte(foodLogs.loggedOn, to),
        ),
      )
      .groupBy(foodLogs.loggedOn);
    const measurements = await tx
      .select({ id: bodyMeasurements.id })
      .from(bodyMeasurements)
      .where(
        and(
          eq(bodyMeasurements.userId, userId),
          gte(bodyMeasurements.measuredOn, from),
          lte(bodyMeasurements.measuredOn, to),
        ),
      );
    const photos = await tx
      .select({ id: bodyPhotos.id })
      .from(bodyPhotos)
      .where(
        and(
          eq(bodyPhotos.userId, userId),
          isNull(bodyPhotos.deletedAt),
          gte(bodyPhotos.takenOn, from),
          lte(bodyPhotos.takenOn, to),
        ),
      );
    const answered = await tx
      .select({ id: checkIns.id })
      .from(checkIns)
      .where(
        and(
          eq(checkIns.userId, userId),
          eq(checkIns.status, 'ANSWERED'),
          gte(checkIns.answeredAt, new Date(`${from}T00:00:00Z`)),
          lte(checkIns.answeredAt, new Date(`${addDays(to, 1)}T00:00:00Z`)),
        ),
      );
    return {
      executionsDone: executions.length,
      keySessionsDone: executions.filter((e) => e.priority === 'KEY').length,
      foodLogDays: meals.length,
      proteinDays:
        proteinFloor === null ? 0 : meals.filter((m) => m.protein >= proteinFloor).length,
      measurements: measurements.length,
      photos: photos.length,
      checkInsAnswered: answered.length,
    };
  }

  private async resolveMilestones(
    tx: TenantTransaction,
    userId: string,
    goal: typeof studentGoals.$inferSelect,
    today: string,
  ): Promise<number> {
    const pending = await tx
      .select()
      .from(goalMilestones)
      .where(and(eq(goalMilestones.goalId, goal.id), eq(goalMilestones.status, 'PENDING')));
    const indicators = goal.strategy?.indicators ?? [];
    let resolved = 0;
    for (const row of pending) {
      const indicator = indicators.find((i) => i.key === row.milestone.indicatorKey);
      if (!indicator) continue;
      const reading = await this.readIndicator(tx, userId, indicator, goal.startedOn);
      const verdict = evaluateMilestone(row.milestone.condition, reading, row.dueOn, today);
      if (verdict === 'PENDING') continue;
      await tx
        .update(goalMilestones)
        .set({ status: verdict, resolvedAt: new Date() })
        .where(eq(goalMilestones.id, row.id));
      resolved += 1;
    }
    return resolved;
  }

  private async readIndicator(
    tx: TenantTransaction,
    userId: string,
    indicator: NonNullable<(typeof studentGoals.$inferSelect)['strategy']>['indicators'][number],
    startedOn: string,
  ) {
    const kind = measurementOf(indicator);
    if (kind) {
      const rows = await tx
        .select({ value: bodyMeasurements.value })
        .from(bodyMeasurements)
        .where(
          and(
            eq(bodyMeasurements.userId, userId),
            eq(bodyMeasurements.kind, kind),
            gte(bodyMeasurements.measuredOn, startedOn),
          ),
        )
        .orderBy(asc(bodyMeasurements.measuredOn));
      return { current: rows.at(-1)?.value ?? null, baseline: rows[0]?.value ?? null };
    }
    if (
      (indicator.source === 'ADHERENCE' || indicator.source === 'TRAINING') &&
      /session|sess|treino/.test(indicator.key)
    ) {
      const rows = await tx
        .select({ id: sessionExecutions.id })
        .from(sessionExecutions)
        .where(
          and(
            eq(sessionExecutions.userId, userId),
            inArray(sessionExecutions.status, ['COMPLETED', 'PARTIAL']),
            gte(sessionExecutions.performedOn, startedOn),
          ),
        );
      return { current: rows.length, baseline: 0 };
    }
    return { current: null, baseline: null };
  }
}
