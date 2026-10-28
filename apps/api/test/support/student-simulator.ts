/**
 * Aluno sintético: 8 semanas de eventos (sessões, execuções, alimentação, peso) gravadas direto
 * no banco, no formato que os fluxos reais produzem. Cada persona conta uma história diferente.
 */
import { and, eq, lt } from 'drizzle-orm';

import {
  bodyMeasurements,
  foodLogs,
  planSessions,
  scheduledSessions,
  sessionExecutions,
  trainingPlans,
} from '../../src/core/database/schema';
import type { TenantDatabase } from '../../src/core/database/tenant-database.service';

export type Persona = 'STEADY' | 'STAGNANT_WEIGHT' | 'DROPPING_OFF';

export const SIM_FIRST_WEEK = '2026-09-07';
export const SIM_WEEKS = 8;

const day = (iso: string, plus: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + plus * 86_400_000).toISOString().slice(0, 10);

interface WeekScript {
  done: boolean[];
  rpe: number;
  foodDays: number;
  weightKg: number;
}

function script(persona: Persona, week: number): WeekScript {
  switch (persona) {
    case 'STEADY':
      return { done: [true, true, true], rpe: 6, foodDays: 5, weightKg: 80 + week * 0.25 };
    case 'STAGNANT_WEIGHT':
      return { done: [true, true, true], rpe: 6.5, foodDays: 5, weightKg: 80 + (week % 2) * 0.04 };
    case 'DROPPING_OFF':
      return week < 4
        ? { done: [true, true, true], rpe: 6, foodDays: 5, weightKg: 80 + week * 0.2 }
        : {
            // A noite (sessões 1 e 3) é o que cai primeiro.
            done: [false, true, false],
            rpe: 7,
            foodDays: week >= 6 ? 1 : 4,
            weightKg: 80 + week * 0.2,
          };
  }
}

/**
 * Substitui a agenda anterior a `beforeDay` pela história da persona. A agenda de hoje em
 * diante (gerada pelo planejamento) fica intacta.
 */
export async function simulateStudent(
  db: TenantDatabase,
  userId: string,
  persona: Persona,
  beforeDay: string,
): Promise<void> {
  await db.runAsSystem(async (tx) => {
    const [plan] = await tx
      .select({ id: trainingPlans.id })
      .from(trainingPlans)
      .where(and(eq(trainingPlans.userId, userId), eq(trainingPlans.status, 'ACTIVE')));
    const sessions = await tx
      .select({
        id: planSessions.id,
        key: planSessions.key,
        minutes: planSessions.estimatedMinutes,
      })
      .from(planSessions)
      .where(eq(planSessions.planId, plan?.id ?? ''))
      .orderBy(planSessions.key);
    if (!plan || sessions.length < 3) throw new Error('plano do aluno sintético incompleto');

    await tx
      .delete(scheduledSessions)
      .where(
        and(eq(scheduledSessions.userId, userId), lt(scheduledSessions.scheduledOn, beforeDay)),
      );

    for (let week = 0; week < SIM_WEEKS; week += 1) {
      const start = day(SIM_FIRST_WEEK, week * 7);
      const s = script(persona, week);
      for (const [index, session] of sessions.slice(0, 3).entries()) {
        const on = day(start, index * 2);
        const done = s.done[index] ?? false;
        const [scheduled] = await tx
          .insert(scheduledSessions)
          .values({
            userId,
            planId: plan.id,
            planSessionId: session.id,
            weekStart: start,
            occurrence: 1,
            scheduledOn: on,
            slot: index === 1 ? 'MORNING' : 'EVENING',
            status: done ? 'DONE' : 'MISSED',
            changeSource: 'PLANNER',
          })
          .returning({ id: scheduledSessions.id });
        if (!done || !scheduled) continue;
        const minutes = Math.min(session.minutes, 45);
        await tx.insert(sessionExecutions).values({
          userId,
          scheduledSessionId: scheduled.id,
          planSessionId: session.id,
          modality: 'STRENGTH',
          performedOn: on,
          status: 'COMPLETED',
          source: 'LINK',
          startedAt: new Date(`${on}T12:00:00Z`),
          finishedAt: new Date(`${on}T12:45:00Z`),
          rpe: s.rpe,
          durationMinutes: minutes,
          load: Math.round(s.rpe * minutes),
          enjoyment: index === 1 ? 5 : 3,
        });
      }
      for (let d = 0; d < s.foodDays; d += 1) {
        await tx.insert(foodLogs).values({
          userId,
          loggedOn: day(start, d),
          meal: 'LUNCH',
          items: [],
          totals: {
            energyKcal: 700,
            proteinG: 40,
            carbsG: 80,
            fatG: 20,
            fiberG: 8,
            micros: {},
            unmatchedItems: 0,
          },
          source: 'MANUAL',
          confirmed: true,
        });
      }
      await tx.insert(bodyMeasurements).values({
        userId,
        kind: 'WEIGHT',
        value: s.weightKg,
        method: 'SCALE',
        measuredOn: day(start, 6),
      });
    }
  });
}
