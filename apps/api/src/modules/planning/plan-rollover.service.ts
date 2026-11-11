/**
 * Mantém a agenda de treino do aluno sempre à frente: o plano publica 2 semanas e, daqui em
 * diante, esta rotina agenda as semanas seguintes com a disponibilidade vigente. A semana leve
 * (deload) que a fase prevê entra como ajuste de volume da ocorrência. Sem isso o aluno ficaria
 * sem treino depois da segunda semana.
 */
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { planSessions, scheduledSessions, trainingPlans } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { DomainEventRecorder } from '../domain-events/domain-event-recorder';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { StudentStateReader } from '../student-state/student-state.reader';
import {
  deloadAdjustment,
  horizonWeeks,
  isDeloadWeek,
  runningProgressionAdjustment,
  weekIndexOf,
} from './calc/rollover';
import { scheduleContextOf } from './inputs';
import { PLAN_STATE_SLICES, todayIn } from './plan-generation.service';
import { scheduleWeek } from './plan-publisher.service';
import { parseStateView } from './state-view';

@Injectable()
export class PlanRolloverService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly stateReader: StudentStateReader,
    private readonly methodology: PublishedMethodologyReader,
    private readonly events: DomainEventRecorder,
  ) {}

  /** Agenda as semanas do horizonte que ainda não têm sessões. Idempotente por semana. */
  async ensureHorizon(
    userId: string,
    now: Date = new Date(),
  ): Promise<{ scheduled: number; weeks: number }> {
    const state = await this.stateReader.read(userId, PLAN_STATE_SLICES, now);
    const view = parseStateView(state.slices as Record<string, unknown>);
    const timezone = (state.slices.identity as { timezone?: string | null } | undefined)?.timezone;
    const today = todayIn(timezone ?? null, now);
    const [hybrid, running] = await Promise.all([
      this.methodology.publishedOf('HYBRID'),
      this.methodology.publishedOf('RUNNING'),
    ]);
    const schedule = scheduleContextOf(view, hybrid?.parameters, running?.parameters);

    return this.db.runAsSystem(async (tx) => {
      const [plan] = await tx
        .select({
          id: trainingPlans.id,
          startsOn: trainingPlans.startsOn,
          structure: trainingPlans.structure,
        })
        .from(trainingPlans)
        .where(and(eq(trainingPlans.userId, userId), eq(trainingPlans.status, 'ACTIVE')));
      if (!plan) return { scheduled: 0, weeks: 0 };

      const models = await tx
        .select({ id: planSessions.id, key: planSessions.key })
        .from(planSessions)
        .where(eq(planSessions.planId, plan.id));
      const idByKey = new Map(models.map((row) => [row.key, row.id]));
      const minutesByKey = new Map(plan.structure.sessions.map((s) => [s.key, s.estimatedMinutes]));
      const sessionByKey = new Map(plan.structure.sessions.map((s) => [s.key, s]));

      let scheduled = 0;
      let weeks = 0;
      for (const [index, weekStart] of horizonWeeks(today).entries()) {
        const existing = await tx
          .select({ id: scheduledSessions.id })
          .from(scheduledSessions)
          .where(
            and(
              eq(scheduledSessions.userId, userId),
              eq(scheduledSessions.planId, plan.id),
              eq(scheduledSessions.weekStart, weekStart),
            ),
          )
          .limit(1);
        if (existing.length > 0) continue;
        const week = scheduleWeek(
          plan.structure.sessions,
          schedule,
          weekStart,
          index === 0 ? today : weekStart,
        );
        const weekIndex = weekIndexOf(plan.startsOn, weekStart);
        const deload = isDeloadWeek(plan.structure.phases, weekIndex);
        const rows = week.assignments.flatMap((assignment) => {
          const planSessionId = idByKey.get(assignment.planSessionKey);
          if (!planSessionId) return [];
          const session = sessionByKey.get(assignment.planSessionKey);
          const progression = session
            ? runningProgressionAdjustment(session, weekIndex, deload)
            : undefined;
          return [
            {
              userId,
              planId: plan.id,
              planSessionId,
              weekStart,
              occurrence: assignment.occurrence,
              scheduledOn: assignment.date,
              slot: assignment.slot,
              changeSource: 'PLANNER' as const,
              decisionId: null,
              ...(deload
                ? {
                    adjustment: deloadAdjustment(minutesByKey.get(assignment.planSessionKey) ?? 40),
                  }
                : progression
                  ? { adjustment: progression }
                  : {}),
            },
          ];
        });
        if (rows.length === 0) continue;
        await tx.insert(scheduledSessions).values(rows);
        scheduled += rows.length;
        weeks += 1;
      }
      if (scheduled > 0) {
        await this.events.record(tx, {
          userId,
          type: 'SessionScheduled',
          payload: { planId: plan.id, count: scheduled, weeks, source: 'ROLLOVER' },
        });
      }
      return { scheduled, weeks };
    });
  }
}
