/**
 * Acompanhamento nutricional proativo, toda semana:
 *
 *   semana alimentar em números → especialista de nutrição lê e ajusta o plano (energia ou a
 *   orientação de uma refeição) dentro das políticas → a persona conversa com o aluno, conta o
 *   que viu e propõe um passo pequeno. Sem dados, convida a registrar e pergunta.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import {
  personaOf,
  type CoachingProposal,
  type DeclaredGoalKind,
  type MealSlot,
} from '@movivo/shared';

import type { AgentContextSources } from '../../core/agents/agent-context';
import { AgentRunner, AgentTaskError } from '../../core/agents/agent-runner';
import {
  bodyMeasurements,
  dailyCheckIns,
  foodLogs,
  nutritionPlans,
  sessionExecutions,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { DecisionExecutor } from '../coaching/decision/decision-executor.service';
import { ConversationStore } from '../conversation/conversation-store';
import { DomainCommands } from '../conversation/domain-commands.service';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { addDays, mondayOf } from '../planning/calc/week-planner';
import { PlanGenerationService, todayIn } from '../planning/plan-generation.service';
import { CommitmentService } from '../student-state/commitment.service';
import { StudentStateReader } from '../student-state/student-state.reader';
import { AgentMessenger } from './agent-messenger';
import { loadMetricsView } from './load-metrics';
import { collectLoadMetrics } from './load-metrics-data';
import { summarizeNutritionWeek } from './nutrition-week';
import {
  nutritionFollowUpTask,
  nutritionTalkTask,
  type NutritionFollowUp,
  type NutritionFollowUpInput,
} from './nutrition-follow-up-tasks';
import { GOAL_DIRECTION } from './weekly-review.service';

const MARKER_TTL_SECONDS = 10 * 86_400;
/** Mesmo piso do comando que ajusta a energia do plano. */
const ENERGY_FLOOR_KCAL = 1_200;

export type NutritionFollowUpResult =
  | {
      status: 'SKIPPED';
      reason: 'NO_PLAN' | 'ALREADY_HANDLED' | 'NO_VALID_READING' | 'NO_VALID_MESSAGE';
    }
  | { status: 'SENT'; readingStatus: NutritionFollowUp['status']; adjusted: boolean };

function proposalOf(
  action: CoachingProposal['action'],
  rationale: string,
  expectedOutcome: string,
): CoachingProposal {
  return {
    action,
    rationale: [rationale],
    evidence: [],
    assumptions: [],
    uncertainty: 'LOW',
    expectedOutcome,
  };
}

const targetsOf = (plan: { trainingDay: Targets; restDay: Targets }) => ({
  trainingDay: {
    energyKcal: plan.trainingDay.energyKcal,
    proteinG: plan.trainingDay.proteinG,
    fiberG: plan.trainingDay.fiberG,
  },
  restDay: {
    energyKcal: plan.restDay.energyKcal,
    proteinG: plan.restDay.proteinG,
    fiberG: plan.restDay.fiberG,
  },
});
interface Targets {
  energyKcal: { min: number; max: number };
  proteinG: number;
  fiberG: number;
}

@Injectable()
export class NutritionFollowUpService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly runner: AgentRunner,
    private readonly state: StudentStateReader,
    private readonly methodology: PublishedMethodologyReader,
    private readonly executor: DecisionExecutor,
    private readonly commands: DomainCommands,
    private readonly generation: PlanGenerationService,
    private readonly commitments: CommitmentService,
    private readonly store: ConversationStore,
    private readonly messenger: AgentMessenger,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(NutritionFollowUpService.name);
  }

  async handle(userId: string, now: Date = new Date()): Promise<NutritionFollowUpResult> {
    const read = await this.state.read(userId, ['identity', 'goals'], now);
    const identity = read.slices.identity as
      { timezone?: string | null; biologicalSex?: string | null } | undefined;
    const today = todayIn(identity?.timezone ?? null, now);
    const marker = this.keys.forUser(userId, 'nutrition-follow-up', 'week', mondayOf(today));
    if ((await this.redis.set(marker, '1', 'EX', MARKER_TTL_SECONDS, 'NX')) === null) {
      return { status: 'SKIPPED', reason: 'ALREADY_HANDLED' };
    }
    try {
      const declared = (read.slices.goals as { declared?: { primary?: DeclaredGoalKind } } | null)
        ?.declared;
      const direction = (declared?.primary && GOAL_DIRECTION[declared.primary]) || 'MAINTAIN';
      const result = await this.run(userId, today, direction, identity, now);
      if (result.status === 'SKIPPED') await this.redis.del(marker);
      return result;
    } catch (error) {
      await this.redis.del(marker);
      throw error;
    }
  }

  private async run(
    userId: string,
    today: string,
    direction: NutritionFollowUpInput['goalDirection'],
    identity: { biologicalSex?: string | null } | undefined,
    now: Date,
  ): Promise<NutritionFollowUpResult> {
    const base = await this.db.runAsUser(userId, 'USER', (tx) =>
      this.buildInput(tx, userId, today, direction),
    );
    if (!base) return { status: 'SKIPPED', reason: 'NO_PLAN' };
    const input: NutritionFollowUpInput = {
      ...base,
      openCommitments: await this.commitments.openForReview(userId, ['NUTRITION'], today),
    };

    const sources = this.sources(userId, now);
    let reading: NutritionFollowUp;
    let modelRunId: string | null;
    try {
      const run = await this.runner.run(nutritionFollowUpTask, input, { userId, sources });
      reading = run.output;
      modelRunId = run.modelRunIds[0] ?? null;
    } catch (error) {
      if (!(error instanceof AgentTaskError)) throw error;
      this.logger.warn({ userId, taskId: error.taskId }, 'nutrição sem leitura válida');
      return { status: 'SKIPPED', reason: 'NO_VALID_READING' };
    }

    await this.commitments.applyReview(userId, reading.commitmentReview);
    const changed = await this.apply(userId, reading, modelRunId, now);

    const { firstName } = await this.store.loadUser(userId);
    try {
      const { adjustment: _adjustment, ...followUp } = reading;
      const talk = await this.runner.run(
        nutritionTalkTask,
        { firstName, followUp, changed },
        { userId, sources, persona: personaOf(identity?.biologicalSex) },
      );
      await this.messenger.send(userId, talk.output.messages, `nutrition_${userId}_${today}`);
      await this.commitments.record(userId, 'NUTRITION', reading.nextStep, today);
    } catch (error) {
      if (!(error instanceof AgentTaskError)) throw error;
      this.logger.warn({ userId, taskId: error.taskId }, 'nutrição sem texto válido');
      return { status: 'SKIPPED', reason: 'NO_VALID_MESSAGE' };
    }
    this.logger.info(
      { event: 'nutrition_follow_up', userId, status: reading.status, adjusted: changed.applied },
      'acompanhamento nutricional enviado',
    );
    return { status: 'SENT', readingStatus: reading.status, adjusted: changed.applied };
  }

  /** O especialista ajusta o plano pelas políticas; o que não passa vira só orientação na conversa. */
  private async apply(
    userId: string,
    reading: NutritionFollowUp,
    modelRunId: string | null,
    now: Date,
  ) {
    const none = {
      applied: false,
      energyDeltaKcal: null as number | null,
      mealSlot: null as MealSlot | null,
      rebuilt: false,
    };
    const { adjustment } = reading;
    if (adjustment.kind === 'NONE') return none;
    if (adjustment.kind === 'REBUILD_PLAN') {
      // Mudança estrutural e permanente: o plano é refeito pelo mesmo caminho do treino (políticas,
      // auditoria e fila) e, publicado, o aluno recebe o novo PDF do plano alimentar.
      const result = await this.generation.adjustByInstruction(
        userId,
        'NUTRITION',
        adjustment.instruction,
        { now },
      );
      const rebuilt = result.status === 'ADJUSTED' || result.status === 'PENDING_REVIEW';
      return rebuilt ? { ...none, applied: true, rebuilt: true } : none;
    }
    if (adjustment.kind === 'ENERGY') {
      const action = { type: 'ADJUST_ENERGY_TARGET' as const, deltaKcal: adjustment.deltaKcal };
      const outcome = await this.executor.decideAndRun(
        userId,
        nutritionFollowUpTask.id,
        proposalOf(action, adjustment.reason, 'O corpo passa a responder como o objetivo pede.'),
        (tx) => this.commands.adjustEnergyTarget(tx, userId, action),
        { modelRunId },
      );
      const applied = outcome.verdict === 'EXECUTE' && outcome.execution?.result.applied === true;
      return applied ? { ...none, applied, energyDeltaKcal: adjustment.deltaKcal } : none;
    }
    const action = {
      type: 'ADJUST_MEAL_GUIDANCE' as const,
      slot: adjustment.slot,
      guidance: adjustment.guidance,
      examples: adjustment.examples,
    };
    const outcome = await this.executor.decideAndRun(
      userId,
      nutritionFollowUpTask.id,
      proposalOf(action, adjustment.reason, 'A refeição passa a caber melhor na rotina do aluno.'),
      (tx) => this.commands.adjustMealGuidance(tx, userId, action),
      { modelRunId },
    );
    const applied = outcome.verdict === 'EXECUTE' && outcome.execution?.result.applied === true;
    return applied ? { ...none, applied, mealSlot: adjustment.slot } : none;
  }

  private async buildInput(
    tx: Parameters<Parameters<TenantDatabase['runAsUser']>[2]>[0],
    userId: string,
    today: string,
    direction: NutritionFollowUpInput['goalDirection'],
  ): Promise<Omit<NutritionFollowUpInput, 'openCommitments'> | null> {
    const [plan] = await tx
      .select({ structure: nutritionPlans.structure })
      .from(nutritionPlans)
      .where(and(eq(nutritionPlans.userId, userId), eq(nutritionPlans.status, 'ACTIVE')));
    if (!plan) return null;
    const from = addDays(today, -6);
    const logs = await tx
      .select({ date: foodLogs.loggedOn, meal: foodLogs.meal, totals: foodLogs.totals })
      .from(foodLogs)
      .where(
        and(
          eq(foodLogs.userId, userId),
          eq(foodLogs.confirmed, true),
          gte(foodLogs.loggedOn, from),
          lte(foodLogs.loggedOn, today),
        ),
      );
    const checkIns = await tx
      .select({ date: dailyCheckIns.onDate, nutrition: dailyCheckIns.nutrition })
      .from(dailyCheckIns)
      .where(and(eq(dailyCheckIns.userId, userId), gte(dailyCheckIns.onDate, from)));
    const weights = await tx
      .select({ date: bodyMeasurements.measuredOn, value: bodyMeasurements.value })
      .from(bodyMeasurements)
      .where(
        and(
          eq(bodyMeasurements.userId, userId),
          eq(bodyMeasurements.kind, 'WEIGHT'),
          gte(bodyMeasurements.measuredOn, addDays(today, -56)),
        ),
      );
    const trained = await tx
      .select({ date: sessionExecutions.performedOn })
      .from(sessionExecutions)
      .where(
        and(
          eq(sessionExecutions.userId, userId),
          inArray(sessionExecutions.status, ['COMPLETED', 'PARTIAL']),
          gte(sessionExecutions.performedOn, from),
        ),
      );
    const lastSent = await this.daysSinceLast(userId, today);

    const { trainingDay, restDay } = targetsOf(plan.structure);
    const week = summarizeNutritionWeek({
      today,
      logs: logs.map((l) => ({
        date: l.date,
        meal: l.meal,
        energyKcal: l.totals.energyKcal,
        proteinG: l.totals.proteinG,
        fiberG: l.totals.fiberG,
      })),
      trainingDay,
      restDay,
      trainingDates: new Set(trained.map((t) => t.date)),
      checkIns,
      weights,
    });
    return {
      planSlots: plan.structure.meals.map((meal) => meal.slot),
      targets: {
        trainingDayKcal: trainingDay.energyKcal,
        restDayKcal: restDay.energyKcal,
        proteinG: restDay.proteinG,
        fiberG: restDay.fiberG,
      },
      energyFloorKcal: ENERGY_FLOOR_KCAL,
      goalDirection: direction,
      week,
      loadMetrics: loadMetricsView(await collectLoadMetrics(tx, userId, today)),
      daysSinceLastFollowUp: lastSent,
    };
  }

  /** Dias desde o último acompanhamento nutricional enviado (a marca semanal anterior). */
  private async daysSinceLast(userId: string, today: string): Promise<number | null> {
    const previous = this.keys.forUser(
      userId,
      'nutrition-follow-up',
      'week',
      addDays(mondayOf(today), -7),
    );
    return (await this.redis.exists(previous)) === 1 ? 7 : null;
  }

  private sources(userId: string, now: Date): AgentContextSources {
    return {
      methodology: (domains) => this.methodology.render(domains),
      state: (slices) => this.state.read(userId, slices, now),
    };
  }
}
