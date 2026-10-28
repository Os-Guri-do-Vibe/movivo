/**
 * Comandos de domínio que executam as ações propostas depois do motor de políticas. Cada um
 * recebe a transação de quem decidiu: a decisão, a mudança de estado e os eventos são atômicos.
 * Nenhum agente chama isto direto — só o orquestrador, com a decisão `EXECUTE` em mãos.
 */
import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull } from 'drizzle-orm';

import type {
  AvailabilityWindow,
  CoachingAction,
  NutritionPlanStructure,
  TrainingPlanStructure,
} from '@movivo/shared';

import {
  nutritionPlans,
  planSessions,
  scheduledSessions,
  studentConstraints,
  trainingPlans,
} from '../../core/database/schema';
import type { TenantTransaction } from '../../core/database/tenant-database.service';
import { ExerciseCatalogProvider } from '../catalog/exercises/exercise-catalog-provider.service';
import { DomainEventRecorder } from '../domain-events/domain-event-recorder';
import { sessionLoad } from '../planning/calc/load';
import { ScheduleService } from '../training/schedule.service';

type Action<T extends CoachingAction['type']> = Extract<CoachingAction, { type: T }>;

export interface CommandResult {
  command: string;
  result: Record<string, unknown>;
}

@Injectable()
export class DomainCommands {
  constructor(
    private readonly schedule: ScheduleService,
    private readonly events: DomainEventRecorder,
    private readonly catalog: ExerciseCatalogProvider,
  ) {}

  async recordConstraint(
    tx: TenantTransaction,
    userId: string,
    action: Action<'RECORD_CONSTRAINT'>,
    today: string,
  ): Promise<CommandResult> {
    const { constraint } = action;
    const active = await tx
      .select()
      .from(studentConstraints)
      .where(
        and(
          eq(studentConstraints.userId, userId),
          eq(studentConstraints.kind, constraint.kind),
          isNull(studentConstraints.supersededAt),
        ),
      );
    // Exceção de agenda da MESMA semana e a disponibilidade-base substituem a anterior; restrições
    // alimentares e de equipamento se somam.
    const replace = active.filter((c) => {
      if (constraint.kind === 'AVAILABILITY') return true;
      return (
        constraint.kind === 'AVAILABILITY_OVERRIDE' &&
        c.constraint.kind === 'AVAILABILITY_OVERRIDE' &&
        c.constraint.weekStart === constraint.weekStart
      );
    });
    if (replace.length > 0) {
      await tx
        .update(studentConstraints)
        .set({ supersededAt: new Date() })
        .where(
          inArray(
            studentConstraints.id,
            replace.map((c) => c.id),
          ),
        );
    }
    const [row] = await tx
      .insert(studentConstraints)
      .values({
        userId,
        kind: constraint.kind,
        constraint,
        origin: 'DECLARED',
        validFrom: today,
        validUntil:
          constraint.kind === 'AVAILABILITY_OVERRIDE' ? addDays(constraint.weekStart, 6) : null,
      })
      .returning({ id: studentConstraints.id });
    await this.events.record(tx, {
      userId,
      type: 'ConstraintChanged',
      payload: { kind: constraint.kind, constraintId: row?.id ?? null },
    });
    return { command: 'state.record_constraint', result: { constraintId: row?.id ?? null } };
  }

  async rescheduleWeek(
    tx: TenantTransaction,
    userId: string,
    action: Action<'RESCHEDULE_WEEK'>,
    decisionId: string,
  ): Promise<CommandResult> {
    const result = await this.schedule.applyReschedule(tx, userId, action, decisionId);
    return { command: 'training.reschedule', result };
  }

  async shortenSession(
    tx: TenantTransaction,
    userId: string,
    action: Action<'SHORTEN_SESSION'>,
    factor: number,
    decisionId: string,
  ): Promise<CommandResult> {
    const [row] = await tx
      .update(scheduledSessions)
      .set({
        adjustment: { shorten: { targetMinutes: action.targetMinutes, factor } },
        changeSource: 'COACHING',
        decisionId,
      })
      .where(
        and(
          eq(scheduledSessions.id, action.scheduledSessionId),
          eq(scheduledSessions.userId, userId),
          eq(scheduledSessions.status, 'PLANNED'),
        ),
      )
      .returning({ id: scheduledSessions.id });
    return {
      command: 'training.shorten_session',
      result: { scheduledSessionId: row?.id ?? null, targetMinutes: action.targetMinutes },
    };
  }

  /** Troca por equivalente: só na próxima ocorrência, ou no plano todo (nova versão do plano). */
  async substituteExercise(
    tx: TenantTransaction,
    userId: string,
    action: Action<'SUBSTITUTE_EXERCISE'>,
    decisionId: string,
    today: string,
  ): Promise<CommandResult> {
    const target = this.catalog.getById(action.toExerciseId);
    if (!target || !this.catalog.getById(action.fromExerciseId)) {
      return {
        command: 'training.substitute_exercise',
        result: { applied: false, reason: 'EXERCISE_UNKNOWN' },
      };
    }
    if (action.scope === 'NEXT_SESSION') {
      const [next] = await tx
        .select({ scheduled: scheduledSessions })
        .from(scheduledSessions)
        .innerJoin(planSessions, eq(planSessions.id, scheduledSessions.planSessionId))
        .where(
          and(
            eq(scheduledSessions.userId, userId),
            eq(scheduledSessions.status, 'PLANNED'),
            gte(scheduledSessions.scheduledOn, today),
            eq(planSessions.key, action.planSessionKey),
          ),
        )
        .orderBy(asc(scheduledSessions.scheduledOn))
        .limit(1);
      if (!next)
        return {
          command: 'training.substitute_exercise',
          result: { applied: false, reason: 'NO_SESSION' },
        };
      const current = next.scheduled.adjustment ?? {};
      const substitutions = [
        ...(current.substitutions ?? []).filter((s) => s.fromExerciseId !== action.fromExerciseId),
        {
          fromExerciseId: action.fromExerciseId,
          toExerciseId: action.toExerciseId,
          toName: target.name,
        },
      ];
      await tx
        .update(scheduledSessions)
        .set({ adjustment: { ...current, substitutions }, changeSource: 'COACHING', decisionId })
        .where(eq(scheduledSessions.id, next.scheduled.id));
      return {
        command: 'training.substitute_exercise',
        result: { applied: true, scope: 'NEXT_SESSION', scheduledSessionId: next.scheduled.id },
      };
    }

    const published = await this.patchActiveTrainingPlan(
      tx,
      userId,
      (structure) => ({
        ...structure,
        sessions: structure.sessions.map((session) =>
          session.content.modality === 'STRENGTH'
            ? {
                ...session,
                content: {
                  ...session.content,
                  exercises: session.content.exercises.map((e) =>
                    e.exerciseId === action.fromExerciseId
                      ? { ...e, exerciseId: action.toExerciseId, name: target.name }
                      : e,
                  ),
                },
              }
            : session,
        ),
      }),
      today,
    );
    return {
      command: 'training.substitute_exercise',
      result: { applied: published !== null, scope: 'PLAN', planId: published },
    };
  }

  async adjustMealGuidance(
    tx: TenantTransaction,
    userId: string,
    action: Action<'ADJUST_MEAL_GUIDANCE'>,
  ): Promise<CommandResult> {
    const [current] = await tx
      .select()
      .from(nutritionPlans)
      .where(and(eq(nutritionPlans.userId, userId), eq(nutritionPlans.status, 'ACTIVE')));
    if (!current) return { command: 'nutrition.adjust_meal_guidance', result: { applied: false } };
    const structure: NutritionPlanStructure = {
      ...current.structure,
      meals: current.structure.meals.map((meal) =>
        meal.slot === action.slot
          ? { ...meal, guidance: action.guidance, examples: action.examples }
          : meal,
      ),
    };
    await tx
      .update(nutritionPlans)
      .set({ status: 'SUPERSEDED' })
      .where(eq(nutritionPlans.id, current.id));
    const [created] = await tx
      .insert(nutritionPlans)
      .values({
        userId,
        version: current.version + 1,
        status: 'ACTIVE',
        goalId: current.goalId,
        structure,
        startsOn: current.startsOn,
        methodologyVersions: current.methodologyVersions,
        publishedAt: new Date(),
      })
      .returning({ id: nutritionPlans.id, version: nutritionPlans.version });
    await this.events.record(tx, {
      userId,
      type: 'NutritionPlanPublished',
      payload: { planId: created?.id ?? null, version: created?.version ?? null },
    });
    return {
      command: 'nutrition.adjust_meal_guidance',
      result: { applied: true, planId: created?.id ?? null },
    };
  }

  // --- Nova versão do plano de treino (troca no plano) -----------------------------------

  /**
   * Cria a versão seguinte do plano com a estrutura alterada, mantendo a agenda: as ocorrências
   * futuras ainda planejadas passam a apontar para as sessões da versão nova (mesma chave).
   */
  private async patchActiveTrainingPlan(
    tx: TenantTransaction,
    userId: string,
    mutate: (structure: TrainingPlanStructure) => TrainingPlanStructure,
    today: string,
  ): Promise<string | null> {
    const [current] = await tx
      .select()
      .from(trainingPlans)
      .where(and(eq(trainingPlans.userId, userId), eq(trainingPlans.status, 'ACTIVE')));
    if (!current) return null;
    const structure = mutate(current.structure);
    await tx
      .update(trainingPlans)
      .set({ status: 'SUPERSEDED' })
      .where(eq(trainingPlans.id, current.id));
    const [created] = await tx
      .insert(trainingPlans)
      .values({
        userId,
        version: current.version + 1,
        status: 'ACTIVE',
        goalId: current.goalId,
        structure,
        startsOn: current.startsOn,
        methodologyVersions: current.methodologyVersions,
        publishedAt: new Date(),
      })
      .returning({ id: trainingPlans.id, version: trainingPlans.version });
    if (!created) return null;
    const inserted = await tx
      .insert(planSessions)
      .values(
        structure.sessions.map((session) => ({
          userId,
          planId: created.id,
          key: session.key,
          modality: session.content.modality,
          title: session.title,
          priority: session.priority,
          weeklyFrequency: session.weeklyFrequency,
          estimatedMinutes: session.estimatedMinutes,
          estimatedLoad: sessionLoad(session),
          content: session.content,
        })),
      )
      .returning({ id: planSessions.id, key: planSessions.key });
    const idByKey = new Map(inserted.map((row) => [row.key, row.id]));
    const future = await tx
      .select({ id: scheduledSessions.id, key: planSessions.key })
      .from(scheduledSessions)
      .innerJoin(planSessions, eq(planSessions.id, scheduledSessions.planSessionId))
      .where(
        and(
          eq(scheduledSessions.userId, userId),
          eq(scheduledSessions.planId, current.id),
          eq(scheduledSessions.status, 'PLANNED'),
          gte(scheduledSessions.scheduledOn, today),
        ),
      );
    for (const row of future) {
      const planSessionId = idByKey.get(row.key);
      if (!planSessionId) continue;
      await tx
        .update(scheduledSessions)
        .set({ planId: created.id, planSessionId })
        .where(eq(scheduledSessions.id, row.id));
    }
    await this.events.record(tx, {
      userId,
      type: 'PlanVersionPublished',
      payload: { planId: created.id, version: created.version, reason: 'EXERCISE_SUBSTITUTION' },
    });
    return created.id;
  }
}

export function windowsFor(
  weekdays: readonly AvailabilityWindow['weekday'][],
  base: readonly AvailabilityWindow[],
): AvailabilityWindow[] {
  const typical = base.length
    ? ([...base.map((w) => w.maxMinutes)].sort((a, b) => a - b)[Math.floor(base.length / 2)] ?? 60)
    : 60;
  return weekdays.map((weekday) => {
    const known = base.find((w) => w.weekday === weekday);
    return known ?? { weekday, slot: 'ANY', maxMinutes: typical };
  });
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
