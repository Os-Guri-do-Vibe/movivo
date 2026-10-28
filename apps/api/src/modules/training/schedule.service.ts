/**
 * Agenda adaptativa (sem LLM): marca o que ficou para trás e reorganiza o que ainda dá tempo.
 *
 * Duas regras explícitas:
 *  - reagendar mexe SÓ em `scheduled_sessions`; o plano (`training_plans`/`plan_sessions`) nunca muda;
 *  - sessão perdida NÃO é compensada: não é empilhada nos dias seguintes. O que sobra da semana
 *    é reorganizado com as mesmas regras do planejamento, e o que não cabe sai dela (`SKIPPED`).
 */
import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';

import type { CoachingAction, Weekday } from '@movivo/shared';

import { planSessions, scheduledSessions, trainingPlans, users } from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import { DomainEventRecorder } from '../domain-events/domain-event-recorder';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { hybridRules, runningRules } from '../planning/calc/params';
import { windowsByWeekday } from '../planning/calc/plan-check';
import { isHeavyLower, isIntense } from '../planning/calc/load';
import { addDays, mondayOf, planWeek, type WeekOccurrence } from '../planning/calc/week-planner';
import { todayIn } from '../planning/plan-generation.service';
import { parseStateView } from '../planning/state-view';
import { StudentStateReader } from '../student-state/student-state.reader';

type RescheduleAction = Extract<CoachingAction, { type: 'RESCHEDULE_WEEK' }>;

const WEEKDAYS: readonly Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

@Injectable()
export class ScheduleService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly events: DomainEventRecorder,
    private readonly methodology: PublishedMethodologyReader,
    private readonly state: StudentStateReader,
  ) {}

  /**
   * Sessões planejadas de dias anteriores ao dia local do aluno viram `MISSED` (e geram o evento
   * para o orquestrador). Idempotente: só toca o que ainda está `PLANNED`.
   */
  async markMissed(now: Date = new Date()): Promise<number> {
    return this.db.runAsSystem(async (tx) => {
      const horizon = addDays(now.toISOString().slice(0, 10), 1);
      const candidates = await tx
        .select({
          id: scheduledSessions.id,
          userId: scheduledSessions.userId,
          scheduledOn: scheduledSessions.scheduledOn,
          timezone: users.timezone,
        })
        .from(scheduledSessions)
        .innerJoin(users, eq(users.id, scheduledSessions.userId))
        .where(
          and(eq(scheduledSessions.status, 'PLANNED'), lt(scheduledSessions.scheduledOn, horizon)),
        );
      const overdue = candidates.filter((c) => c.scheduledOn < todayIn(c.timezone, now));
      if (overdue.length === 0) return 0;
      await tx
        .update(scheduledSessions)
        .set({ status: 'MISSED' })
        .where(
          inArray(
            scheduledSessions.id,
            overdue.map((c) => c.id),
          ),
        );
      const perUser = new Map<string, string[]>();
      for (const c of overdue) perUser.set(c.userId, [...(perUser.get(c.userId) ?? []), c.id]);
      for (const [userId, ids] of perUser) {
        await this.events.record(tx, {
          userId,
          type: 'SessionMissed',
          payload: { count: ids.length, firstScheduledSessionId: ids[0] ?? null },
        });
      }
      return overdue.length;
    });
  }

  /**
   * Propõe a reorganização do que resta da semana corrente: sessões `PLANNED` de hoje em
   * diante, com a disponibilidade vigente (inclui exceção da semana). `null` se nada a mover.
   */
  async proposeWeek(userId: string, now: Date = new Date()): Promise<RescheduleAction | null> {
    const stateRead = await this.state.read(userId, ['identity', 'availability'], now);
    const timezone = (stateRead.slices.identity as { timezone?: string | null } | undefined)
      ?.timezone;
    const today = todayIn(timezone ?? null, now);
    const weekStart = mondayOf(today);
    const view = parseStateView(stateRead.slices as Record<string, unknown>);
    const constraints = (stateRead.slices.availability ?? []) as {
      kind: string;
      weekStart?: string;
      windows?: typeof view.availability extends infer A
        ? A extends { windows: infer W }
          ? W
          : never
        : never;
    }[];
    const override = constraints.find(
      (c) => c.kind === 'AVAILABILITY_OVERRIDE' && c.weekStart === weekStart,
    );
    const windows = override?.windows ?? view.availability?.windows ?? [];
    if (windows.length === 0) return null;

    const hybrid = await this.methodology.publishedOf('HYBRID');
    const running = await this.methodology.publishedOf('RUNNING');

    const remaining = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({
          scheduled: scheduledSessions,
          plan: planSessions,
          structure: trainingPlans.structure,
        })
        .from(scheduledSessions)
        .innerJoin(planSessions, eq(planSessions.id, scheduledSessions.planSessionId))
        .innerJoin(trainingPlans, eq(trainingPlans.id, scheduledSessions.planId))
        .where(
          and(
            eq(scheduledSessions.userId, userId),
            eq(scheduledSessions.status, 'PLANNED'),
            eq(scheduledSessions.weekStart, weekStart),
            gte(scheduledSessions.scheduledOn, today),
            eq(trainingPlans.status, 'ACTIVE'),
          ),
        )
        .orderBy(asc(scheduledSessions.scheduledOn)),
    );
    if (remaining.length === 0) return null;

    const occurrences: WeekOccurrence[] = remaining.map((row) => {
      const planSession = row.structure.sessions.find((s) => s.key === row.plan.key);
      const fixedWeekday = view.training.externalSports.find(
        (sport) => `EXT_${view.training.externalSports.indexOf(sport) + 1}` === row.plan.key,
      )?.fixedDays;
      const sameKeyBefore = remaining.filter(
        (r) => r.plan.key === row.plan.key && r.scheduled.occurrence < row.scheduled.occurrence,
      ).length;
      const fixed = fixedWeekday?.[sameKeyBefore];
      return {
        planSessionKey: row.plan.key,
        occurrence: row.scheduled.occurrence,
        priority: row.plan.priority as WeekOccurrence['priority'],
        minutes: row.plan.estimatedMinutes,
        intense: planSession ? isIntense(planSession) : false,
        heavyLower: planSession ? isHeavyLower(planSession) : false,
        intenseRun: planSession
          ? planSession.content.modality === 'RUNNING' && isIntense(planSession)
          : false,
        fixedOn: fixed ? addDays(weekStart, WEEKDAYS.indexOf(fixed)) : undefined,
      };
    });
    const result = planWeek({
      weekStart,
      notBefore: today,
      windows: windowsByWeekday(windows),
      occurrences,
      rules: hybridRules(hybrid?.parameters),
      minEasyDaysBetweenIntense: Math.max(
        0,
        runningRules(running?.parameters, 'INTERMEDIATE').minEasyDaysBetweenQuality ?? 1,
      ),
    });
    const unchanged =
      result.dropped.length === 0 &&
      result.assignments.every((a) =>
        remaining.some(
          (r) =>
            r.plan.key === a.planSessionKey &&
            r.scheduled.occurrence === a.occurrence &&
            r.scheduled.scheduledOn === a.date,
        ),
      );
    if (unchanged) return null;
    return {
      type: 'RESCHEDULE_WEEK',
      weekStart,
      assignments: result.assignments
        .filter(
          (a) =>
            !occurrences.find(
              (o) => o.planSessionKey === a.planSessionKey && o.occurrence === a.occurrence,
            )?.fixedOn,
        )
        .map((a) => ({ planSessionKey: a.planSessionKey, date: a.date, slot: a.slot })),
      dropped: [...new Set(result.dropped.map((d) => d.planSessionKey))],
    };
  }

  /**
   * Comando de domínio da ação `RESCHEDULE_WEEK`: move as ocorrências ainda `PLANNED` da semana
   * (na ordem de ocorrência) e tira da semana as que não couberam. Não toca no plano nem no que
   * já foi feito, perdido ou pulado.
   */
  async applyReschedule(
    tx: TenantTransaction,
    userId: string,
    action: RescheduleAction,
    decisionId: string | null,
  ): Promise<{ moved: number; dropped: number }> {
    const planned = await tx
      .select({ scheduled: scheduledSessions, key: planSessions.key })
      .from(scheduledSessions)
      .innerJoin(planSessions, eq(planSessions.id, scheduledSessions.planSessionId))
      .where(
        and(
          eq(scheduledSessions.userId, userId),
          eq(scheduledSessions.weekStart, action.weekStart),
          eq(scheduledSessions.status, 'PLANNED'),
        ),
      )
      .orderBy(asc(scheduledSessions.occurrence));

    let moved = 0;
    const cursor = new Map<string, number>();
    for (const assignment of action.assignments) {
      const index = cursor.get(assignment.planSessionKey) ?? 0;
      cursor.set(assignment.planSessionKey, index + 1);
      const target = planned.filter((p) => p.key === assignment.planSessionKey)[index];
      if (!target) continue;
      await tx
        .update(scheduledSessions)
        .set({
          scheduledOn: assignment.date,
          slot: assignment.slot,
          changeSource: 'COACHING',
          decisionId,
        })
        .where(eq(scheduledSessions.id, target.scheduled.id));
      moved += 1;
    }
    let dropped = 0;
    for (const key of action.dropped) {
      // As primeiras N ocorrências foram reposicionadas acima; as demais saem da semana.
      const toDrop = planned.filter((p) => p.key === key).slice(cursor.get(key) ?? 0);
      if (toDrop.length === 0) continue;
      await tx
        .update(scheduledSessions)
        .set({ status: 'SKIPPED', changeSource: 'COACHING', decisionId })
        .where(
          inArray(
            scheduledSessions.id,
            toDrop.map((p) => p.scheduled.id),
          ),
        );
      dropped += toDrop.length;
    }
    await this.events.record(tx, {
      userId,
      type: 'SessionRescheduled',
      payload: { weekStart: action.weekStart, moved, dropped },
    });
    return { moved, dropped };
  }
}
