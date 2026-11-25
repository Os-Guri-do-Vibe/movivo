/** Lê do banco o que as métricas de carga precisam (leitura sob RLS do titular). */
import { and, asc, eq, gt, gte, inArray, lte } from 'drizzle-orm';

import {
  dailyCheckIns,
  planSessions,
  scheduledSessions,
  sessionExecutions,
} from '../../core/database/schema';
import type { TenantTransaction } from '../../core/database/tenant-database.service';
import { addDays } from '../planning/calc/week-planner';
import {
  computeLoadMetrics,
  type LoadDay,
  type LoadMetrics,
  type PlannedDay,
  type ReadinessDay,
} from './load-metrics';

const WINDOW_DAYS = 28;

export interface LoadInputs {
  executions: LoadDay[];
  planned: PlannedDay[];
  checkIns: ReadinessDay[];
  firstTrainingDay: string | null;
}

export async function collectLoadInputs(
  tx: TenantTransaction,
  userId: string,
  asOf: string,
  days: number = WINDOW_DAYS,
): Promise<LoadInputs> {
  const from = addDays(asOf, -(days - 1));

  const executed = await tx
    .select({ date: sessionExecutions.performedOn, load: sessionExecutions.load })
    .from(sessionExecutions)
    .where(
      and(
        eq(sessionExecutions.userId, userId),
        inArray(sessionExecutions.status, ['COMPLETED', 'PARTIAL']),
        gte(sessionExecutions.performedOn, from),
        lte(sessionExecutions.performedOn, asOf),
      ),
    );
  const [first] = await tx
    .select({ date: sessionExecutions.performedOn })
    .from(sessionExecutions)
    .where(
      and(
        eq(sessionExecutions.userId, userId),
        inArray(sessionExecutions.status, ['COMPLETED', 'PARTIAL']),
      ),
    )
    .orderBy(asc(sessionExecutions.performedOn))
    .limit(1);

  // Sessão que a agenda tirou do dia (SKIPPED/MOVED) não é carga prevista.
  const scheduled = await tx
    .select({ date: scheduledSessions.scheduledOn, load: planSessions.estimatedLoad })
    .from(scheduledSessions)
    .innerJoin(planSessions, eq(planSessions.id, scheduledSessions.planSessionId))
    .where(
      and(
        eq(scheduledSessions.userId, userId),
        inArray(scheduledSessions.status, ['PLANNED', 'DONE', 'PARTIAL', 'MISSED']),
        gte(scheduledSessions.scheduledOn, from),
        lte(scheduledSessions.scheduledOn, asOf),
      ),
    );

  const answers = await tx
    .select({
      date: dailyCheckIns.onDate,
      energy: dailyCheckIns.energy,
      sleep: dailyCheckIns.sleep,
      soreness: dailyCheckIns.soreness,
      mood: dailyCheckIns.mood,
      stress: dailyCheckIns.stress,
    })
    .from(dailyCheckIns)
    .where(
      and(
        eq(dailyCheckIns.userId, userId),
        gt(dailyCheckIns.onDate, addDays(asOf, -14)),
        lte(dailyCheckIns.onDate, asOf),
      ),
    );

  return {
    executions: executed.map((row) => ({ date: row.date, load: row.load ?? 0 })),
    planned: scheduled.map((row) => ({ date: row.date, load: row.load })),
    checkIns: answers,
    firstTrainingDay: first?.date ?? null,
  };
}

export async function collectLoadMetrics(
  tx: TenantTransaction,
  userId: string,
  asOf: string,
): Promise<LoadMetrics> {
  return computeLoadMetrics({ asOf, ...(await collectLoadInputs(tx, userId, asOf)) });
}
