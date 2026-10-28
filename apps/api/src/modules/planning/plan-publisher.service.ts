/**
 * Persistência do planejamento: estratégia do aluno, versões do plano de treino e de nutrição
 * e a agenda das primeiras semanas.
 *
 * Todos os métodos recebem a transação do chamador: a decisão do motor de políticas, a mudança
 * de estado e os eventos (outbox) saem juntos ou não saem. Versões antigas nunca são apagadas —
 * viram `SUPERSEDED`; só as sessões FUTURAS ainda planejadas da versão substituída são
 * removidas da agenda (as feitas, perdidas e puladas ficam como histórico).
 */
import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ne } from 'drizzle-orm';

import type {
  NutritionPlanStructure,
  TrainingPlanStructure,
  Weekday,
  AvailabilityWindow,
} from '@movivo/shared';

import {
  goalMilestones,
  goalTasks,
  nutritionPlans,
  planSessions,
  scheduledSessions,
  studentGoals,
  trainingPlans,
} from '../../core/database/schema';
import type { TenantTransaction } from '../../core/database/tenant-database.service';
import { DomainEventRecorder } from '../domain-events/domain-event-recorder';
import { occurrencesOf, windowsByWeekday } from './calc/plan-check';
import { sessionLoad } from './calc/load';
import type { HybridRules } from './calc/params';
import { addDays, mondayOf, planWeek } from './calc/week-planner';
import type { StrategyOutput } from './tasks/strategy';

/** Quantas semanas já nascem agendadas (a corrente a partir de hoje e a seguinte). */
const WEEKS_TO_SCHEDULE = 2;

export interface ScheduleContext {
  windows: readonly AvailabilityWindow[];
  rules: HybridRules;
  minEasyDaysBetweenIntense: number;
  externalFixedDays: Readonly<Record<string, readonly Weekday[]>>;
}

@Injectable()
export class PlanPublisher {
  constructor(private readonly events: DomainEventRecorder) {}

  // --- Estratégia -----------------------------------------------------------------------

  async saveStrategy(
    tx: TenantTransaction,
    input: {
      userId: string;
      goalId: string;
      decisionId: string;
      strategy: StrategyOutput;
      today: string;
    },
  ): Promise<void> {
    const { userId, goalId, decisionId, strategy, today } = input;
    await tx
      .update(studentGoals)
      .set({
        strategy: { ...strategy.strategy, studentMessage: strategy.studentMessage },
        strategyDecisionId: decisionId,
        reviewOn: addDays(today, strategy.strategy.reviewAfterWeeks * 7),
      })
      .where(and(eq(studentGoals.id, goalId), eq(studentGoals.userId, userId)));

    // Marcos e microtarefas da estratégia anterior saem; a nova estratégia traz os seus.
    await tx.delete(goalMilestones).where(eq(goalMilestones.goalId, goalId));
    await tx.delete(goalTasks).where(eq(goalTasks.goalId, goalId));
    await tx.insert(goalMilestones).values(
      strategy.milestones.map((milestone, index) => ({
        userId,
        goalId,
        ordinal: index + 1,
        milestone,
        dueOn: addDays(today, milestone.dueInWeeks * 7),
      })),
    );
    const weekStart = mondayOf(today);
    await tx.insert(goalTasks).values(
      strategy.tasks.map((task) => ({
        userId,
        goalId,
        kind: task.kind,
        title: task.title,
        windowStart: task.cadence === 'WEEKLY' ? weekStart : today,
        windowEnd:
          task.cadence === 'WEEKLY'
            ? addDays(weekStart, 6)
            : task.cadence === 'DAILY'
              ? today
              : addDays(today, 14),
        target: task.target,
      })),
    );
    await this.events.record(tx, {
      userId,
      type: 'StrategyDefined',
      payload: { goalId, energyStrategy: strategy.strategy.energyStrategy },
    });
  }

  // --- Plano de treino ------------------------------------------------------------------

  async nextVersion(tx: TenantTransaction, userId: string, kind: 'training' | 'nutrition') {
    const table = kind === 'training' ? trainingPlans : nutritionPlans;
    const [latest] = await tx
      .select({ version: table.version })
      .from(table)
      .where(eq(table.userId, userId))
      .orderBy(desc(table.version))
      .limit(1);
    return (latest?.version ?? 0) + 1;
  }

  async createTrainingDraft(
    tx: TenantTransaction,
    input: {
      userId: string;
      goalId: string;
      structure: TrainingPlanStructure;
      startsOn: string;
      methodologyVersions: Record<string, number>;
    },
  ): Promise<{ planId: string; version: number }> {
    const version = await this.nextVersion(tx, input.userId, 'training');
    const [plan] = await tx
      .insert(trainingPlans)
      .values({
        userId: input.userId,
        version,
        status: 'DRAFT',
        goalId: input.goalId,
        structure: input.structure,
        startsOn: input.startsOn,
        methodologyVersions: input.methodologyVersions,
      })
      .returning({ id: trainingPlans.id });
    if (!plan) throw new Error('falha ao gravar o plano de treino');
    await tx.insert(planSessions).values(
      input.structure.sessions.map((session) => ({
        userId: input.userId,
        planId: plan.id,
        key: session.key,
        modality: session.content.modality,
        title: session.title,
        priority: session.priority,
        weeklyFrequency: session.weeklyFrequency,
        estimatedMinutes: session.estimatedMinutes,
        estimatedLoad: sessionLoad(session),
        content: session.content,
      })),
    );
    return { planId: plan.id, version };
  }

  /** Ativa o rascunho, substitui a versão anterior e agenda as primeiras semanas. */
  async activateTraining(
    tx: TenantTransaction,
    input: {
      userId: string;
      planId: string;
      structure: TrainingPlanStructure;
      startsOn: string;
      schedule: ScheduleContext;
      decisionId: string | null;
    },
  ): Promise<{ scheduled: number; dropped: number }> {
    const { userId, planId, startsOn } = input;
    const superseded = await tx
      .update(trainingPlans)
      .set({ status: 'SUPERSEDED' })
      .where(
        and(
          eq(trainingPlans.userId, userId),
          eq(trainingPlans.status, 'ACTIVE'),
          ne(trainingPlans.id, planId),
        ),
      )
      .returning({ id: trainingPlans.id });
    for (const old of superseded) {
      await tx
        .delete(scheduledSessions)
        .where(
          and(
            eq(scheduledSessions.planId, old.id),
            eq(scheduledSessions.status, 'PLANNED'),
            gte(scheduledSessions.scheduledOn, startsOn),
          ),
        );
    }
    const [plan] = await tx
      .update(trainingPlans)
      .set({ status: 'ACTIVE', publishedAt: new Date() })
      .where(and(eq(trainingPlans.id, planId), eq(trainingPlans.userId, userId)))
      .returning({ version: trainingPlans.version });
    if (!plan) throw new Error('plano de treino não encontrado');

    const rows = await tx
      .select({ id: planSessions.id, key: planSessions.key })
      .from(planSessions)
      .where(eq(planSessions.planId, planId));
    const idByKey = new Map(rows.map((r) => [r.key, r.id]));

    let scheduled = 0;
    let dropped = 0;
    const firstMonday = mondayOf(startsOn);
    for (let week = 0; week < WEEKS_TO_SCHEDULE; week += 1) {
      const weekStart = addDays(firstMonday, week * 7);
      const result = planWeek({
        weekStart,
        notBefore: week === 0 ? startsOn : weekStart,
        windows: windowsByWeekday(input.schedule.windows),
        occurrences: occurrencesOf(
          input.structure.sessions,
          input.schedule.externalFixedDays,
          weekStart,
        ),
        rules: input.schedule.rules,
        minEasyDaysBetweenIntense: input.schedule.minEasyDaysBetweenIntense,
      });
      dropped += result.dropped.length;
      if (result.assignments.length > 0) {
        await tx.insert(scheduledSessions).values(
          result.assignments.map((assignment) => ({
            userId,
            planId,
            planSessionId: idByKey.get(assignment.planSessionKey) as string,
            weekStart,
            occurrence: assignment.occurrence,
            scheduledOn: assignment.date,
            slot: assignment.slot,
            changeSource: 'PLANNER' as const,
            decisionId: input.decisionId,
          })),
        );
        scheduled += result.assignments.length;
      }
    }
    await this.events.record(tx, {
      userId,
      type: 'PlanVersionPublished',
      payload: { planId, version: plan.version, modalities: modalitiesOf(input.structure) },
    });
    await this.events.record(tx, {
      userId,
      type: 'SessionScheduled',
      payload: { planId, count: scheduled, weeks: WEEKS_TO_SCHEDULE },
    });
    return { scheduled, dropped };
  }

  // --- Plano de nutrição ----------------------------------------------------------------

  async createNutritionDraft(
    tx: TenantTransaction,
    input: {
      userId: string;
      goalId: string;
      structure: NutritionPlanStructure;
      startsOn: string;
      methodologyVersions: Record<string, number>;
    },
  ): Promise<{ planId: string; version: number }> {
    const version = await this.nextVersion(tx, input.userId, 'nutrition');
    const [plan] = await tx
      .insert(nutritionPlans)
      .values({
        userId: input.userId,
        version,
        status: 'DRAFT',
        goalId: input.goalId,
        structure: input.structure,
        startsOn: input.startsOn,
        methodologyVersions: input.methodologyVersions,
      })
      .returning({ id: nutritionPlans.id });
    if (!plan) throw new Error('falha ao gravar o plano de nutrição');
    return { planId: plan.id, version };
  }

  async activateNutrition(
    tx: TenantTransaction,
    input: { userId: string; planId: string },
  ): Promise<void> {
    await tx
      .update(nutritionPlans)
      .set({ status: 'SUPERSEDED' })
      .where(
        and(
          eq(nutritionPlans.userId, input.userId),
          eq(nutritionPlans.status, 'ACTIVE'),
          ne(nutritionPlans.id, input.planId),
        ),
      );
    const [plan] = await tx
      .update(nutritionPlans)
      .set({ status: 'ACTIVE', publishedAt: new Date() })
      .where(and(eq(nutritionPlans.id, input.planId), eq(nutritionPlans.userId, input.userId)))
      .returning({ version: nutritionPlans.version });
    if (!plan) throw new Error('plano de nutrição não encontrado');
    await this.events.record(tx, {
      userId: input.userId,
      type: 'NutritionPlanPublished',
      payload: { planId: input.planId, version: plan.version },
    });
  }
}

function modalitiesOf(structure: TrainingPlanStructure): string {
  return [...new Set(structure.sessions.map((s) => s.content.modality))].join(',');
}
