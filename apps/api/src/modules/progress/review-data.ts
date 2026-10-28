/** Números das semanas fechadas de um aluno, lidos do banco (leitura sob RLS do titular). */
import { and, eq, gte, inArray, lte } from 'drizzle-orm';

import type { WeekMetrics } from '@movivo/shared';

import {
  bodyMeasurements,
  foodLogs,
  planSessions,
  scheduledSessions,
  sessionExecutions,
} from '../../core/database/schema';
import type { TenantTransaction } from '../../core/database/tenant-database.service';
import { addDays, mondayOf } from '../planning/calc/week-planner';

const empty = (weekStart: string): WeekMetrics => ({
  weekStart,
  planned: 0,
  done: 0,
  missed: 0,
  keyPlanned: 0,
  keyDone: 0,
  load: 0,
  avgRpe: null,
  painReports: 0,
  foodLogDays: 0,
  weightKg: null,
});

/**
 * `count` semanas terminando em `lastWeekStart` (segunda-feira), da mais antiga à mais nova.
 * Sessão ainda `PLANNED` numa semana já fechada conta como perdida; `SKIPPED` e `MOVED` não
 * entram (o que a agenda tirou da semana não é falta do aluno).
 */
export async function collectWeeks(
  tx: TenantTransaction,
  userId: string,
  lastWeekStart: string,
  count: number,
): Promise<WeekMetrics[]> {
  const starts = Array.from({ length: count }, (_, i) =>
    addDays(lastWeekStart, (i - count + 1) * 7),
  );
  const from = starts[0] ?? lastWeekStart;
  const to = addDays(lastWeekStart, 6);
  const weeks = new Map(starts.map((start) => [start, empty(start)]));
  const of = (day: string) => weeks.get(mondayOf(day));

  const scheduled = await tx
    .select({
      on: scheduledSessions.scheduledOn,
      status: scheduledSessions.status,
      priority: planSessions.priority,
    })
    .from(scheduledSessions)
    .innerJoin(planSessions, eq(planSessions.id, scheduledSessions.planSessionId))
    .where(
      and(
        eq(scheduledSessions.userId, userId),
        gte(scheduledSessions.scheduledOn, from),
        lte(scheduledSessions.scheduledOn, to),
        inArray(scheduledSessions.status, ['PLANNED', 'DONE', 'PARTIAL', 'MISSED']),
      ),
    );
  for (const row of scheduled) {
    const week = of(row.on);
    if (!week) continue;
    const done = row.status === 'DONE' || row.status === 'PARTIAL';
    week.planned += 1;
    if (done) week.done += 1;
    else week.missed += 1;
    if (row.priority === 'KEY') {
      week.keyPlanned += 1;
      if (done) week.keyDone += 1;
    }
  }

  const executions = await tx
    .select({
      on: sessionExecutions.performedOn,
      rpe: sessionExecutions.rpe,
      load: sessionExecutions.load,
      pain: sessionExecutions.painReports,
    })
    .from(sessionExecutions)
    .where(
      and(
        eq(sessionExecutions.userId, userId),
        gte(sessionExecutions.performedOn, from),
        lte(sessionExecutions.performedOn, to),
        inArray(sessionExecutions.status, ['COMPLETED', 'PARTIAL']),
      ),
    );
  const rpes = new Map<string, number[]>();
  for (const row of executions) {
    const week = of(row.on);
    if (!week) continue;
    week.load += row.load ?? 0;
    week.painReports += row.pain.length;
    if (row.rpe !== null) rpes.set(week.weekStart, [...(rpes.get(week.weekStart) ?? []), row.rpe]);
  }
  for (const [start, values] of rpes) {
    const week = weeks.get(start);
    if (week)
      week.avgRpe = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
  }

  const logs = await tx
    .select({ on: foodLogs.loggedOn })
    .from(foodLogs)
    .where(
      and(
        eq(foodLogs.userId, userId),
        eq(foodLogs.confirmed, true),
        gte(foodLogs.loggedOn, from),
        lte(foodLogs.loggedOn, to),
      ),
    );
  const days = new Map<string, Set<string>>();
  for (const log of logs) {
    const week = of(log.on);
    if (week) days.set(week.weekStart, (days.get(week.weekStart) ?? new Set()).add(log.on));
  }
  for (const [start, set] of days) {
    const week = weeks.get(start);
    if (week) week.foodLogDays = set.size;
  }

  const weights = await tx
    .select({ on: bodyMeasurements.measuredOn, value: bodyMeasurements.value })
    .from(bodyMeasurements)
    .where(
      and(
        eq(bodyMeasurements.userId, userId),
        eq(bodyMeasurements.kind, 'WEIGHT'),
        gte(bodyMeasurements.measuredOn, from),
        lte(bodyMeasurements.measuredOn, to),
      ),
    )
    .orderBy(bodyMeasurements.measuredOn);
  for (const row of weights) {
    const week = of(row.on);
    if (week) week.weightKg = row.value;
  }
  return starts.map((start) => weeks.get(start) ?? empty(start));
}
