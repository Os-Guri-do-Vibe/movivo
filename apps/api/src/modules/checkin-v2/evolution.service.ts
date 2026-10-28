/** Leitura da evolução do aluno: metas, medidas ao longo do tempo e treinos concluídos. */
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte } from 'drizzle-orm';

import type {
  GoalMilestone,
  GoalStrategy,
  MeasurementInput,
  MeasurementKind,
} from '@movivo/shared';

import {
  bodyMeasurements,
  goalMilestones,
  goalTasks,
  sessionExecutions,
  studentGoals,
  users,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { addDays, mondayOf } from '../planning/calc/week-planner';
import { todayIn } from '../planning/plan-generation.service';

const WEEKS = 8;

export interface EvolutionView {
  firstName: string | null;
  strategyTitle: string | null;
  strategy: GoalStrategy | null;
  milestones: { milestone: GoalMilestone; dueOn: string; status: string }[];
  tasks: { title: string; target: number; progress: number; windowEnd: string; status: string }[];
  measurements: Record<string, { on: string; value: number }[]>;
  weeks: { weekStart: string; sessions: number; load: number }[];
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

      return {
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
