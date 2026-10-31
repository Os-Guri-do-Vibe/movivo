/**
 * Revisão do protocolo na fila: o profissional vê o rascunho inteiro (com a simulação da primeira
 * semana) e pode editá-lo à mão antes de aprovar. A edição passa pelas mesmas travas
 * determinísticas da geração (exercícios seguros para o aluno, semana que cabe, limites da
 * metodologia de nutrição, guardrails de linguagem); o volume de treino fica a critério dele.
 * Quem pode agir no caso é decidido pela fila de exceções, não aqui.
 */
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import type {
  CoachedModality,
  CoachingAction,
  EditProtocolRequest,
  NutritionPlanStructure,
  PlanStatus,
  ProtocolReview,
  TrainingPlanStructure,
} from '@movivo/shared';

import type { Violation } from '../../core/agents/agent-task';
import { nutritionPlans, planSessions, trainingPlans } from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import { ExerciseCatalogProvider } from '../catalog/exercises/exercise-catalog-provider.service';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { StudentStateReader } from '../student-state/student-state.reader';
import { checkTrainingPlan } from './calc/plan-check';
import { mondayOf } from './calc/week-planner';
import {
  levelOf,
  nutritionInputOf,
  planCheckContextOf,
  scheduleContextOf,
  viableStrengthExercises,
  withCatalogNames,
} from './inputs';
import { PLAN_STATE_SLICES, todayIn } from './plan-generation.service';
import {
  goalStrategyOf,
  insertPlanSessions,
  latestTrainingSessions,
  scheduleWeek,
} from './plan-publisher.service';
import { parseStateView, type StateView } from './state-view';
import { outputLanguageViolations } from './tasks/common';
import { nutritionTask, nutritionValidators } from './tasks/nutrition';

export type PublishPlanAction = Extract<
  CoachingAction,
  { type: 'PUBLISH_TRAINING_PLAN' | 'PUBLISH_NUTRITION_PLAN' }
>;

export function isPublishPlanAction(action: CoachingAction): action is PublishPlanAction {
  return action.type === 'PUBLISH_TRAINING_PLAN' || action.type === 'PUBLISH_NUTRITION_PLAN';
}

export function protocolKindOf(action: PublishPlanAction): 'TRAINING' | 'NUTRITION' {
  return action.type === 'PUBLISH_TRAINING_PLAN' ? 'TRAINING' : 'NUTRITION';
}

/** Estrutura validada, pronta para substituir a do rascunho. */
export type ValidatedProtocol =
  | { kind: 'TRAINING'; structure: TrainingPlanStructure }
  | { kind: 'NUTRITION'; structure: NutritionPlanStructure };

@Injectable()
export class ProtocolReviewService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly stateReader: StudentStateReader,
    private readonly methodology: PublishedMethodologyReader,
    private readonly catalog: ExerciseCatalogProvider,
  ) {}

  /** Protocolo do caso; `canEdit` vem da fila (caso aberto, proposta pendente, conselho certo). */
  async view(
    userId: string,
    action: PublishPlanAction,
    canEdit: boolean,
    now: Date = new Date(),
  ): Promise<ProtocolReview> {
    const kind = protocolKindOf(action);
    const plan = await this.plan(userId, action);
    const strategy = await this.strategyOf(userId, plan.goalId);
    const base = {
      planId: plan.id,
      version: plan.version,
      status: plan.status as PlanStatus,
      editable: canEdit && plan.status === 'DRAFT',
      strategy: strategy
        ? {
            title: strategy.title,
            modalityFocus: strategy.modalityFocus,
            energyStrategy: strategy.energyStrategy,
            studentMessage: strategy.studentMessage,
          }
        : null,
    };
    if (kind === 'NUTRITION') {
      return { kind, ...base, structure: plan.structure as NutritionPlanStructure };
    }
    const structure = plan.structure as TrainingPlanStructure;
    const { view, today } = await this.readState(userId, now);
    const schedule = scheduleContextOf(
      view,
      (await this.methodology.publishedOf('HYBRID'))?.parameters,
      (await this.methodology.publishedOf('RUNNING'))?.parameters,
    );
    const weekStart = mondayOf(today);
    const week = scheduleWeek(structure.sessions, schedule, weekStart, today);
    const byKey = new Map(structure.sessions.map((s) => [s.key, s]));
    return {
      kind,
      ...base,
      structure,
      weekPreview: {
        weekStart,
        startsOn: today,
        sessions: week.assignments.flatMap((a) => {
          const session = byKey.get(a.planSessionKey);
          return session
            ? [
                {
                  date: a.date,
                  slot: a.slot,
                  sessionKey: a.planSessionKey,
                  occurrence: a.occurrence,
                  title: session.title,
                  modality: session.content.modality,
                  priority: session.priority,
                },
              ]
            : [];
        }),
        dropped: week.dropped.map((d) => ({
          sessionKey: d.planSessionKey,
          title: byKey.get(d.planSessionKey)?.title ?? d.planSessionKey,
          reason: d.reason,
        })),
      },
      exerciseOptions: viableStrengthExercises(
        view,
        levelOf(view, 'STRENGTH'),
        this.catalog.getAll(),
      )
        .map((e) => ({ id: e.id, name: e.name, measurement: e.measurement ?? 'REPS' }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    };
  }

  /** Confere a edição contra o aluno e a metodologia; erro 400 com cada problema em PT-BR. */
  async validate(
    userId: string,
    action: PublishPlanAction,
    request: EditProtocolRequest,
    now: Date = new Date(),
  ): Promise<ValidatedProtocol> {
    if (request.kind !== protocolKindOf(action)) {
      throw new BadRequestException('A edição não corresponde ao tipo de protocolo do caso.');
    }
    const plan = await this.plan(userId, action);
    if (plan.status !== 'DRAFT') {
      throw new ConflictException('O protocolo não está mais em revisão.');
    }
    const { view, today, slices } = await this.readState(userId, now);

    if (request.kind === 'TRAINING') {
      const original = plan.structure as TrainingPlanStructure;
      const focus = [...original.modalityPriorities]
        .sort((a, b) => a.priority - b.priority)
        .map((p) => p.modality as CoachedModality);
      const checkContext = planCheckContextOf(
        view,
        focus,
        (await this.methodology.publishedOf('HYBRID'))?.parameters,
        (await this.methodology.publishedOf('RUNNING'))?.parameters,
        today,
      );
      const violations = [
        ...this.strengthViolations(request.structure, view),
        ...checkTrainingPlan(request.structure, checkContext),
        ...outputLanguageViolations(request.structure),
      ];
      rejectIfAny(violations);
      const catalog = this.catalog.getAll();
      return {
        kind: 'TRAINING',
        structure: {
          ...request.structure,
          sessions: withCatalogNames(request.structure.sessions, catalog),
        },
      };
    }

    const doc = await this.methodology.publishedOf('NUTRITION');
    if (!doc) throw new ConflictException('A metodologia de nutrição não está publicada.');
    const original = plan.structure as NutritionPlanStructure;
    const strategy = await this.strategyOf(userId, plan.goalId);
    const input = nutritionInputOf(view, doc.parameters, {
      strategy: original.strategy,
      sessions: await this.db.runAsSystem((tx) => latestTrainingSessions(tx, userId)),
      enduranceFocus: (strategy?.modalityFocus[0] ?? 'STRENGTH') !== 'STRENGTH',
    });
    if (!input) {
      throw new ConflictException('Faltam dados do aluno para conferir o plano alimentar.');
    }
    const context = { state: slices, methodology: { NUTRITION: doc.parameters } };
    const violations: Violation[] = [];
    for (const validator of nutritionValidators) {
      violations.push(...(await validator(input, request.structure, context)));
    }
    rejectIfAny(violations);
    return { kind: 'NUTRITION', structure: request.structure };
  }

  /** Grava a estrutura editada no rascunho (só enquanto ele ainda é rascunho). */
  async replaceDraft(
    tx: TenantTransaction,
    userId: string,
    action: PublishPlanAction,
    edited: ValidatedProtocol,
  ): Promise<void> {
    if (edited.kind === 'TRAINING') {
      const updated = await tx
        .update(trainingPlans)
        .set({ structure: edited.structure })
        .where(
          and(
            eq(trainingPlans.id, action.planId),
            eq(trainingPlans.userId, userId),
            eq(trainingPlans.status, 'DRAFT'),
          ),
        )
        .returning({ id: trainingPlans.id });
      if (updated.length === 0)
        throw new ConflictException('O protocolo não está mais em revisão.');
      await tx.delete(planSessions).where(eq(planSessions.planId, action.planId));
      await insertPlanSessions(tx, userId, action.planId, edited.structure.sessions);
      return;
    }
    const updated = await tx
      .update(nutritionPlans)
      .set({ structure: edited.structure })
      .where(
        and(
          eq(nutritionPlans.id, action.planId),
          eq(nutritionPlans.userId, userId),
          eq(nutritionPlans.status, 'DRAFT'),
        ),
      )
      .returning({ id: nutritionPlans.id });
    if (updated.length === 0) throw new ConflictException('O protocolo não está mais em revisão.');
  }

  /** Exercício de força só do catálogo, seguro para o aluno e medido do jeito certo. */
  private strengthViolations(structure: TrainingPlanStructure, view: StateView): Violation[] {
    const viable = new Map(
      viableStrengthExercises(view, levelOf(view, 'STRENGTH'), this.catalog.getAll()).map((e) => [
        e.id,
        e,
      ]),
    );
    const violations: Violation[] = [];
    structure.sessions.forEach((session, si) => {
      if (session.content.modality !== 'STRENGTH') return;
      session.content.exercises.forEach((exercise, ei) => {
        const path = `sessions.${si}.content.exercises.${ei}`;
        const found = viable.get(exercise.exerciseId);
        if (!found) {
          violations.push({
            path: `${path}.exerciseId`,
            message: `"${exercise.name}" não está entre os exercícios seguros e viáveis para este aluno (local, nível, restrições ou rejeição)`,
          });
        } else if ((found.measurement ?? 'REPS') === 'DURATION' && exercise.reps) {
          violations.push({
            path: `${path}.reps`,
            message: `"${found.name}" é prescrito por tempo`,
          });
        } else if ((found.measurement ?? 'REPS') === 'REPS' && exercise.durationSeconds) {
          violations.push({
            path: `${path}.durationSeconds`,
            message: `"${found.name}" é prescrito por repetições`,
          });
        }
      });
    });
    return violations;
  }

  private async readState(userId: string, now: Date) {
    const slices = [...new Set([...PLAN_STATE_SLICES, ...nutritionTask.state])];
    const state = await this.stateReader.read(userId, slices, now);
    const view = parseStateView(state.slices as Record<string, unknown>);
    const timezone = (state.slices.identity as { timezone?: string | null } | undefined)?.timezone;
    return {
      view,
      slices: state.slices as Record<string, unknown>,
      today: todayIn(timezone ?? null, now),
    };
  }

  private async plan(userId: string, action: PublishPlanAction) {
    const table = action.type === 'PUBLISH_TRAINING_PLAN' ? trainingPlans : nutritionPlans;
    const [plan] = await this.db.runAsSystem((tx) =>
      tx
        .select({
          id: table.id,
          version: table.version,
          status: table.status,
          goalId: table.goalId,
          structure: table.structure,
        })
        .from(table)
        .where(and(eq(table.id, action.planId), eq(table.userId, userId))),
    );
    if (!plan) throw new ConflictException('O protocolo deste caso não existe mais.');
    return plan;
  }

  private strategyOf(userId: string, goalId: string | null) {
    return goalId ? this.db.runAsSystem((tx) => goalStrategyOf(tx, userId, goalId)) : null;
  }
}

function rejectIfAny(violations: readonly Violation[]): void {
  if (violations.length === 0) return;
  throw new BadRequestException({
    code: 'PROTOCOL_INVALID',
    message: 'O protocolo editado não passou na conferência.',
    issues: violations.slice(0, 20).map((v) => ({ path: v.path, message: v.message })),
  });
}
