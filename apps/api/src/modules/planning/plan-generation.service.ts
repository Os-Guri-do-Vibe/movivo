/**
 * Geração do plano integrado de um aluno: do onboarding concluído à primeira semana agendada.
 *
 *   estratégia (Motor de Objetivos) → blocos por modalidade → reconciliação híbrida →
 *   verificação determinística → nutrição → decisão do motor de políticas → publicação.
 *
 * Os agentes PROPÕEM; cada saída passa por validadores determinísticos e correção; a publicação
 * só acontece se o motor de políticas autorizar (senão abre um caso para a equipe). O que muda
 * o estado do aluno roda numa transação só, com os eventos no outbox.
 */
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { and, eq, sql } from 'drizzle-orm';

import {
  type CoachedModality,
  type CoachingProposal,
  type GoalStrategy,
  type NutritionPlanStructure,
  type PlanSession,
  type TrainingPlanStructure,
} from '@movivo/shared';

import type { AgentContextSources } from '../../core/agents/agent-context';
import { AgentRunner, AgentTaskError, type AgentRunResult } from '../../core/agents/agent-runner';
import type { AgentTask, StateSlice } from '../../core/agents/agent-task';
import {
  coachingProposals,
  exceptionCases,
  nutritionPlans,
  trainingPlans,
} from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import { ExerciseCatalogProvider } from '../catalog/exercises/exercise-catalog-provider.service';
import { DecisionPipeline } from '../coaching/decision/decision-pipeline.service';
import { OutboxRelay } from '../domain-events/outbox-relay';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { StudentStateReader } from '../student-state/student-state.reader';
import { checkTrainingPlan, type PlanCheckContext } from './calc/plan-check';
import { nutritionRules, hyroxRules } from './calc/params';
import {
  allocateSessions,
  coachedBudget,
  externalSessionsOf,
  hyroxInputOf,
  levelOf,
  nutritionInputOf,
  planCheckContextOf,
  runningInputOf,
  scheduleContextOf,
  strategyInputOf,
  strengthInputOf,
  withCatalogNames,
} from './inputs';
import { PlanDelivery } from './plan-delivery.service';
import {
  goalStrategyOf,
  latestTrainingSessions,
  PlanPublisher,
  type ScheduleContext,
} from './plan-publisher.service';
import { parseStateView, type StateView } from './state-view';
import type { BlockOutput } from './tasks/blocks';
import { hybridTask, type HybridInput } from './tasks/hybrid';
import { hyroxTask } from './tasks/hyrox';
import { coordinatorInputOf, coordinatorTask, type CoordinatorOutput } from './tasks/coordinator';
import { FoodCandidatesService } from '../nutrition/food-candidates.service';
import { finalizeNutrition, nutritionTask, type NutritionOutput } from './tasks/nutrition';
import { runningTask } from './tasks/running';
import { strategyTask } from './tasks/strategy';
import { strengthTask } from './tasks/strength';

export const PLAN_STATE_SLICES: readonly StateSlice[] = [
  'identity',
  'goals',
  'availability',
  'restrictions',
  'preferences',
  'training',
  'body',
  'safety',
];

export type PlanGenerationResult =
  | { status: 'PUBLISHED'; trainingPlanId: string; nutritionPlanId: string; linkSent: boolean }
  | { status: 'PENDING_REVIEW'; exceptionCaseIds: string[] }
  | { status: 'ADJUSTED'; planId: string }
  | { status: 'SKIPPED'; reason: 'SAFETY_SIGNAL' | 'ALREADY_PLANNED' | 'NO_ADJUSTMENT' }
  | { status: 'FAILED'; exceptionCaseId: string; reason: string };

class PlanningBlocked extends Error {
  constructor(
    readonly domain: 'TRAINING' | 'NUTRITION' | 'GENERAL',
    message: string,
  ) {
    super(message);
  }
}

/** Data de hoje no fuso do aluno (padrão: São Paulo). */
export function todayIn(timezone: string | null, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone ?? 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

@Injectable()
export class PlanGenerationService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly runner: AgentRunner,
    private readonly stateReader: StudentStateReader,
    private readonly methodology: PublishedMethodologyReader,
    private readonly catalog: ExerciseCatalogProvider,
    private readonly pipeline: DecisionPipeline,
    private readonly publisher: PlanPublisher,
    private readonly foods: FoodCandidatesService,
    private readonly delivery: PlanDelivery,
    private readonly outbox: OutboxRelay,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PlanGenerationService.name);
  }

  async generate(
    userId: string,
    options: { triggerEventId?: string | null; now?: Date } = {},
  ): Promise<PlanGenerationResult> {
    const triggerEventId = options.triggerEventId ?? null;
    return this.withFailureCase(userId, triggerEventId, () =>
      this.run(userId, triggerEventId, options.now ?? new Date()),
    );
  }

  /**
   * Pedido de ajuste feito na fila: o caso encerrado traz a proposta (qual rascunho) e a orientação
   * do profissional (que só vive no banco, nunca na fila do Redis). O rascunho recusado vira
   * `SUPERSEDED` e os agentes refazem só aquele protocolo.
   */
  async adjustFromCase(
    userId: string,
    exceptionCaseId: string,
    options: { triggerEventId?: string | null; now?: Date } = {},
  ): Promise<PlanGenerationResult> {
    const request = await this.db.runAsSystem(async (tx) => {
      const [row] = await tx
        .select({ resolution: exceptionCases.resolution, action: coachingProposals.action })
        .from(exceptionCases)
        .innerJoin(
          coachingProposals,
          eq(coachingProposals.id, sql`(${exceptionCases.subject}->>'proposalId')::uuid`),
        )
        .where(and(eq(exceptionCases.id, exceptionCaseId), eq(exceptionCases.userId, userId)));
      const instruction = row?.resolution?.note;
      const action = row?.action;
      if (
        row?.resolution?.outcome !== 'ADJUSTMENT_REQUESTED' ||
        typeof instruction !== 'string' ||
        (action?.type !== 'PUBLISH_TRAINING_PLAN' && action?.type !== 'PUBLISH_NUTRITION_PLAN')
      ) {
        return null;
      }
      const training = action.type === 'PUBLISH_TRAINING_PLAN';
      const table = training ? trainingPlans : nutritionPlans;
      await tx
        .update(table)
        .set({ status: 'SUPERSEDED' })
        .where(
          and(eq(table.id, action.planId), eq(table.userId, userId), eq(table.status, 'DRAFT')),
        );
      return { domain: training ? ('TRAINING' as const) : ('NUTRITION' as const), instruction };
    });
    if (!request) return { status: 'SKIPPED', reason: 'NO_ADJUSTMENT' };
    return this.adjust(userId, request.domain, request.instruction, options);
  }

  /**
   * Refaz só um dos protocolos (treino ou alimentação) com a orientação do profissional que o
   * revisou na fila, a partir da estratégia já salva. O novo rascunho passa pelo motor de
   * políticas como na geração inicial.
   */
  private async adjust(
    userId: string,
    domain: 'TRAINING' | 'NUTRITION',
    instruction: string,
    options: { triggerEventId?: string | null; now?: Date } = {},
  ): Promise<PlanGenerationResult> {
    const triggerEventId = options.triggerEventId ?? null;
    return this.withFailureCase(userId, triggerEventId, async () => {
      const { state, view, today } = await this.readState(userId, options.now ?? new Date());
      if (!view.goal || !view.availability || view.training.modalities.length === 0) {
        throw new PlanningBlocked(domain, 'faltam objetivo, modalidades ou disponibilidade');
      }
      const strategy = await this.savedStrategy(userId, view.goal.goalId);
      if (!strategy) throw new PlanningBlocked(domain, 'o aluno ainda não tem estratégia definida');
      const ctx: DraftContext = {
        userId,
        goalId: view.goal.goalId,
        today,
        triggerEventId,
        stateVersion: state.version,
      };

      const proposed =
        domain === 'TRAINING'
          ? await this.buildTraining(view, userId, strategy.modalityFocus, today, instruction).then(
              (built) => this.db.runAsSystem((tx) => this.proposeTraining(tx, ctx, built)),
            )
          : await this.buildNutrition(
              view,
              userId,
              {
                strategy: strategy.energyStrategy,
                sessions: await this.latestTrainingSessions(userId),
                enduranceFocus: strategy.modalityFocus[0] !== 'STRENGTH',
              },
              instruction,
            ).then((built) => this.db.runAsSystem((tx) => this.proposeNutrition(tx, ctx, built)));
      await this.outbox.flushSoon();
      if (!proposed.activated) {
        return {
          status: 'PENDING_REVIEW',
          exceptionCaseIds: proposed.exceptionCaseId ? [proposed.exceptionCaseId] : [],
        };
      }
      await this.delivery.sendWhenComplete(userId);
      return { status: 'ADJUSTED', planId: proposed.planId };
    });
  }

  /** Falha prevista (dado faltando, agente sem saída válida) vira caso na fila, não exceção. */
  private async withFailureCase(
    userId: string,
    triggerEventId: string | null,
    work: () => Promise<PlanGenerationResult>,
  ): Promise<PlanGenerationResult> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof PlanningBlocked || error instanceof AgentTaskError) {
        const reason =
          error instanceof AgentTaskError
            ? `o agente ${error.taskId} não produziu uma saída válida: ${error.violations
                .slice(0, 5)
                .map((v) => `${v.path}: ${v.message}`)
                .join('; ')}`
            : error.message;
        const domain = error instanceof PlanningBlocked ? error.domain : 'GENERAL';
        const exceptionCaseId = await this.db.runAsSystem((tx) =>
          this.pipeline.openFailureCase(tx, {
            userId,
            domain,
            summary: `Não foi possível gerar o plano automaticamente: ${reason}`,
            subject: { triggerEventId: triggerEventId ?? 'manual' },
            priority: 'HIGH',
          }),
        );
        await this.outbox.flushSoon();
        this.logger.warn({ userId, reason }, 'geração do plano bloqueada; caso aberto');
        return { status: 'FAILED', exceptionCaseId, reason };
      }
      throw error;
    }
  }

  private sources(userId: string): AgentContextSources {
    return {
      methodology: (domains) => this.methodology.render(domains),
      state: (slices) => this.stateReader.read(userId, slices),
    };
  }

  private async execute<I, O>(
    task: AgentTask<I, O>,
    userId: string,
    input: I,
  ): Promise<AgentRunResult<O>> {
    return this.runner.run(task, input, { userId, sources: this.sources(userId) });
  }

  private async readState(userId: string, now: Date) {
    const state = await this.stateReader.read(userId, PLAN_STATE_SLICES, now);
    const view = parseStateView(state.slices as Record<string, unknown>);
    const timezone = (state.slices.identity as { timezone?: string | null } | undefined)?.timezone;
    return { state, view, today: todayIn(timezone ?? null, now) };
  }

  private async run(
    userId: string,
    triggerEventId: string | null,
    now: Date,
  ): Promise<PlanGenerationResult> {
    const { state, view, today } = await this.readState(userId, now);

    if (!view.goal) throw new PlanningBlocked('GENERAL', 'o aluno não tem objetivo registrado');
    if (view.training.modalities.length === 0 || !view.availability) {
      throw new PlanningBlocked('GENERAL', 'faltam modalidades ou disponibilidade na anamnese');
    }
    // Só a emergência impede a geração. Os demais sinais (PAR-Q de risco, dor, lesão) entram no
    // planejamento como restrição e o protocolo completo vai para a fila do profissional.
    if (view.safety.signals.some((s) => s.severity === 'EMERGENCY')) {
      return { status: 'SKIPPED', reason: 'SAFETY_SIGNAL' };
    }
    if (await this.alreadyPlanned(userId, view.goal.goalId)) {
      return { status: 'SKIPPED', reason: 'ALREADY_PLANNED' };
    }

    const nutritionDoc = await this.requireDomain('NUTRITION', 'NUTRITION');
    await this.requireDomain('HYBRID', 'TRAINING');

    // 1. Estratégia -------------------------------------------------------------------
    const strategyInput = strategyInputOf(view, nutritionRules(nutritionDoc.parameters), today);
    if (!strategyInput)
      throw new PlanningBlocked('GENERAL', 'dados insuficientes para a estratégia');
    const strategyRun = await this.execute(strategyTask, userId, strategyInput);
    const strategy = strategyRun.output;
    const goalId = view.goal.goalId;

    const strategyDecision = await this.db.runAsSystem(async (tx) => {
      const decision = await this.pipeline.decide(tx, {
        userId,
        taskId: strategyTask.id,
        triggerEventId,
        stateVersion: state.version,
        modelRunId: strategyRun.modelRunIds.at(-1) ?? null,
        proposal: proposalOf(
          { type: 'DEFINE_STRATEGY', goalId },
          strategy.strategy.rationale,
          strategy.strategy.openQuestions,
          strategyRun,
          `Reavaliar a estratégia em ${strategy.strategy.reviewAfterWeeks} semanas pelos indicadores definidos.`,
        ),
      });
      if (decision.verdict === 'EXECUTE') {
        await this.publisher.saveStrategy(tx, {
          userId,
          goalId,
          decisionId: decision.decisionId,
          strategy,
          today,
        });
        await this.pipeline.recordExecution(tx, {
          userId,
          decisionId: decision.decisionId,
          command: 'goals.save_strategy',
          status: 'SUCCEEDED',
          result: { goalId },
        });
      }
      return decision;
    });
    await this.outbox.flushSoon();
    if (strategyDecision.verdict !== 'EXECUTE') {
      return {
        status: 'PENDING_REVIEW',
        exceptionCaseIds: strategyDecision.exceptionCaseId
          ? [strategyDecision.exceptionCaseId]
          : [],
      };
    }

    // 2–4. Treino (blocos + integração + verificação) e alimentação ---------------------
    const focus = strategy.strategy.modalityFocus;
    const nutritionFor = (built: BuiltTraining) => ({
      strategy: strategy.strategy.energyStrategy,
      sessions: built.structure.sessions,
      enduranceFocus: built.activeFocus[0] !== 'STRENGTH',
    });
    let training = await this.buildTraining(view, userId, focus, today);
    let nutrition = await this.buildNutrition(view, userId, nutritionFor(training));

    // 4b. Coordenador: parecer sobre o protocolo inteiro e uma rodada de ajuste, se pedir.
    const review = await this.coordinate(userId, strategy.strategy, training, nutrition);
    const notes = review
      ? [`Coordenador: ${review.professionalNote}`]
      : ['Coordenador sem parecer nesta geração: confira a coerência entre treino e alimentação.'];
    const adjustments = [...(review?.adjustments ?? [])].sort((a) =>
      a.target === 'TRAINING' ? -1 : 1,
    );
    for (const adjustment of adjustments) {
      notes.push(
        `Ajuste pedido pelo coordenador (${adjustment.target}): ${adjustment.instruction}`,
      );
      if (adjustment.target === 'TRAINING') {
        training = await this.buildTraining(view, userId, focus, today, adjustment.instruction);
      } else {
        nutrition = await this.buildNutrition(
          view,
          userId,
          nutritionFor(training),
          adjustment.instruction,
        );
      }
    }

    // 5. Decisão e publicação ---------------------------------------------------------
    const ctx: DraftContext = {
      userId,
      goalId,
      today,
      triggerEventId,
      stateVersion: state.version,
      notes,
    };
    const published = await this.db.runAsSystem(async (tx) => {
      const trainingDraft = await this.proposeTraining(tx, ctx, training);
      const nutritionDraft = await this.proposeNutrition(tx, ctx, nutrition);
      return {
        trainingPlanId: trainingDraft.planId,
        nutritionPlanId: nutritionDraft.planId,
        activated: trainingDraft.activated && nutritionDraft.activated,
        exceptionCaseIds: [trainingDraft.exceptionCaseId, nutritionDraft.exceptionCaseId].filter(
          (id): id is string => id !== null,
        ),
      };
    });
    await this.outbox.flushSoon();

    if (!published.activated) {
      return { status: 'PENDING_REVIEW', exceptionCaseIds: published.exceptionCaseIds };
    }
    const linkSent = await this.delivery.sendPlanLink(userId);
    return {
      status: 'PUBLISHED',
      trainingPlanId: published.trainingPlanId,
      nutritionPlanId: published.nutritionPlanId,
      linkSent,
    };
  }

  /** Parecer do coordenador; sem saída válida, a geração segue e o profissional é avisado. */
  private async coordinate(
    userId: string,
    strategy: Pick<GoalStrategy, 'title' | 'energyStrategy' | 'modalityFocus'>,
    training: BuiltTraining,
    nutrition: BuiltNutrition,
  ): Promise<CoordinatorOutput | null> {
    try {
      const input = coordinatorInputOf(
        {
          title: strategy.title,
          energyStrategy: strategy.energyStrategy,
          modalityFocus: strategy.modalityFocus,
        },
        training.structure,
        nutrition.structure,
      );
      return (await this.execute(coordinatorTask, userId, input)).output;
    } catch (error) {
      if (!(error instanceof AgentTaskError)) throw error;
      this.logger.warn({ userId }, 'coordenador sem parecer válido; geração segue sem ele');
      return null;
    }
  }

  // --- Montagem -------------------------------------------------------------------------

  /** Blocos por modalidade → plano integrado → verificação determinística. */
  private async buildTraining(
    view: StateView,
    userId: string,
    focus: readonly CoachedModality[],
    today: string,
    instruction?: string,
  ): Promise<BuiltTraining> {
    const hybridDoc = await this.requireDomain('HYBRID', 'TRAINING');
    const external = externalSessionsOf(view);
    const allocation = allocateSessions(focus, coachedBudget(view, focus.length));
    const activeFocus = focus.filter((m) => allocation[m] !== undefined);
    const domains = await this.requireFocusDomains(activeFocus);

    const blocks = await Promise.all(
      activeFocus.map(async (modality, index) => ({
        modality,
        priority: index + 1,
        run: await this.buildBlock(modality, view, {
          userId,
          sessions: allocation[modality] ?? 1,
          priority: index + 1,
          today,
          primary: index === 0,
          domains,
          instruction,
        }),
      })),
    );

    const runningParameters = domains['RUNNING']?.parameters;
    const checkContext = planCheckContextOf(
      view,
      activeFocus,
      hybridDoc.parameters,
      runningParameters,
      today,
    );
    const structure = await this.integrate({
      userId,
      view,
      blocks,
      external,
      checkContext,
      today,
      instruction,
    });
    const violations = checkTrainingPlan(structure, checkContext);
    if (violations.length > 0) {
      throw new PlanningBlocked(
        'TRAINING',
        `o plano montado não passou na verificação final: ${violations
          .map((v) => v.message)
          .join('; ')}`,
      );
    }
    return {
      structure,
      activeFocus,
      schedule: scheduleContextOf(view, hybridDoc.parameters, runningParameters),
      methodologyVersions: {
        HYBRID: hybridDoc.version,
        ...Object.fromEntries(Object.entries(domains).map(([d, doc]) => [d, doc.version])),
      },
      runs: blocks.map((b) => b.run),
    };
  }

  private async buildNutrition(
    view: StateView,
    userId: string,
    options: Parameters<typeof nutritionInputOf>[2],
    instruction?: string,
  ): Promise<BuiltNutrition> {
    const doc = await this.requireDomain('NUTRITION', 'NUTRITION');
    const input = nutritionInputOf(view, doc.parameters, options);
    if (!input) {
      throw new PlanningBlocked(
        'NUTRITION',
        'faltam peso, altura, idade ou sexo para o plano alimentar',
      );
    }
    const fullInput = {
      ...input,
      foods: await this.foods.forStudent(userId, input.dietaryRestrictions),
      professionalInstruction: instruction,
    };
    const run = await this.execute(nutritionTask, userId, fullInput);
    return { run, structure: finalizeNutrition(run.output, fullInput), version: doc.version };
  }

  /** Grava o rascunho de treino e pede a decisão; com `EXECUTE`, ativa e agenda na hora. */
  private async proposeTraining(
    tx: TenantTransaction,
    ctx: DraftContext,
    built: BuiltTraining,
  ): Promise<Proposed> {
    const { planId } = await this.publisher.createTrainingDraft(tx, {
      userId: ctx.userId,
      goalId: ctx.goalId,
      structure: built.structure,
      startsOn: ctx.today,
      methodologyVersions: built.methodologyVersions,
    });
    const decision = await this.pipeline.decide(tx, {
      userId: ctx.userId,
      taskId: hybridTask.id,
      triggerEventId: ctx.triggerEventId,
      stateVersion: ctx.stateVersion,
      modelRunId: built.runs.flatMap((r) => r.modelRunIds).at(-1) ?? null,
      proposal: proposalOf(
        { type: 'PUBLISH_TRAINING_PLAN', planId },
        [built.structure.summary, ...(ctx.notes ?? [])],
        [],
        built.runs[0] ?? { correctionRounds: 0 },
        'Aderência às sessões-chave nas primeiras quatro semanas.',
      ),
    });
    if (decision.verdict !== 'EXECUTE') {
      return { planId, activated: false, exceptionCaseId: decision.exceptionCaseId };
    }
    const result = await this.publisher.activateTraining(tx, {
      userId: ctx.userId,
      planId,
      structure: built.structure,
      startsOn: ctx.today,
      schedule: built.schedule,
      decisionId: decision.decisionId,
    });
    await this.pipeline.recordExecution(tx, {
      userId: ctx.userId,
      decisionId: decision.decisionId,
      command: 'training.publish_plan',
      status: 'SUCCEEDED',
      result: { planId, ...result },
    });
    return { planId, activated: true, exceptionCaseId: null };
  }

  private async proposeNutrition(
    tx: TenantTransaction,
    ctx: DraftContext,
    built: BuiltNutrition,
  ): Promise<Proposed> {
    const { planId } = await this.publisher.createNutritionDraft(tx, {
      userId: ctx.userId,
      goalId: ctx.goalId,
      structure: built.structure,
      startsOn: ctx.today,
      methodologyVersions: { NUTRITION: built.version },
    });
    const decision = await this.pipeline.decide(tx, {
      userId: ctx.userId,
      taskId: nutritionTask.id,
      triggerEventId: ctx.triggerEventId,
      stateVersion: ctx.stateVersion,
      modelRunId: built.run.modelRunIds.at(-1) ?? null,
      proposal: proposalOf(
        { type: 'PUBLISH_NUTRITION_PLAN', planId },
        [built.run.output.summary, ...(ctx.notes ?? [])],
        [],
        built.run,
        'Registro de refeições e proteína na meta em pelo menos cinco dias por semana.',
      ),
    });
    if (decision.verdict !== 'EXECUTE') {
      return { planId, activated: false, exceptionCaseId: decision.exceptionCaseId };
    }
    await this.publisher.activateNutrition(tx, { userId: ctx.userId, planId });
    await this.pipeline.recordExecution(tx, {
      userId: ctx.userId,
      decisionId: decision.decisionId,
      command: 'nutrition.publish_plan',
      status: 'SUCCEEDED',
      result: { planId },
    });
    return { planId, activated: true, exceptionCaseId: null };
  }

  private async buildBlock(
    modality: CoachedModality,
    view: StateView,
    options: {
      userId: string;
      sessions: number;
      priority: number;
      today: string;
      primary: boolean;
      domains: Record<
        string,
        { version: number; parameters: Record<string, Record<string, unknown>> }
      >;
      instruction?: string;
    },
  ): Promise<AgentRunResult<BlockOutput>> {
    const { userId } = options;
    const professionalInstruction = options.instruction;
    if (modality === 'STRENGTH') {
      const input = strengthInputOf(view, options.domains['STRENGTH']?.parameters, {
        sessions: options.sessions,
        priority: options.priority,
        strengthIsPrimary: options.primary,
        catalog: this.catalog.getAll(),
      });
      if (!input)
        throw new PlanningBlocked(
          'TRAINING',
          'sem exercícios viáveis para o local e as limitações do aluno',
        );
      return this.execute(strengthTask, userId, { ...input, professionalInstruction });
    }
    if (modality === 'RUNNING') {
      const input = runningInputOf(view, {
        sessions: options.sessions,
        priority: options.priority,
        today: options.today,
        runningIsPrimary: options.primary,
      });
      if (!input)
        throw new PlanningBlocked('TRAINING', 'dados insuficientes para o bloco de corrida');
      return this.execute(runningTask, userId, { ...input, professionalInstruction });
    }
    const hyroxParams = hyroxRules(options.domains['HYROX']?.parameters);
    const input = hyroxInputOf(view, hyroxParams, {
      sessions: options.sessions,
      priority: options.priority,
      today: options.today,
    });
    if (!input) throw new PlanningBlocked('TRAINING', 'dados insuficientes para o bloco de HYROX');
    return this.execute(hyroxTask, userId, { ...input, professionalInstruction });
  }

  /** Uma modalidade e nenhum esporte externo: o código monta. Senão, o planejador híbrido reconcilia. */
  private async integrate(input: {
    userId: string;
    view: StateView;
    blocks: { modality: CoachedModality; priority: number; run: AgentRunResult<BlockOutput> }[];
    external: ReturnType<typeof externalSessionsOf>;
    checkContext: PlanCheckContext;
    today: string;
    instruction?: string;
  }): Promise<TrainingPlanStructure> {
    const { blocks, external } = input;
    const catalog = this.catalog.getAll();
    const only = blocks[0];
    if (blocks.length === 1 && only && external.sessions.length === 0) {
      const block = only.run.output;
      return {
        summary: block.summary,
        modalityPriorities: [{ modality: only.modality, priority: 1 }],
        phases: block.phases,
        sessions: withCatalogNames(block.sessions, catalog),
      };
    }
    const hybridInput: HybridInput = {
      blocks: blocks.map((b) => ({
        modality: b.modality,
        priority: b.priority,
        block: { ...b.run.output, sessions: withCatalogNames(b.run.output.sessions, catalog) },
      })),
      externalSessions: external.sessions,
      availability: {
        maxSessionsPerWeek: input.checkContext.maxSessionsPerWeek,
        windows: input.checkContext.windows.map((w) => ({ ...w })),
        externalFixedDays: Object.fromEntries(
          Object.entries(external.fixedDays).map(([key, days]) => [key, [...days]]),
        ),
      },
      recentWeeklyLoad: input.checkContext.recentWeeklyLoad,
      startsOn: input.today,
      runningLevel: levelOf(input.view, 'RUNNING'),
      professionalInstruction: input.instruction,
    };
    const run = await this.execute(hybridTask, input.userId, hybridInput);
    return run.output;
  }

  // --- Pré-requisitos ---------------------------------------------------------------------

  private async requireDomain(
    domain: 'NUTRITION' | 'HYBRID' | 'STRENGTH' | 'RUNNING' | 'HYROX',
    area: 'TRAINING' | 'NUTRITION',
  ) {
    const doc = await this.methodology.publishedOf(domain);
    if (!doc) throw new PlanningBlocked(area, `a metodologia ${domain} ainda não foi publicada`);
    return doc;
  }

  private async requireFocusDomains(focus: readonly CoachedModality[]) {
    const out: Record<
      string,
      { version: number; parameters: Record<string, Record<string, unknown>> }
    > = {};
    for (const modality of focus) {
      const doc = await this.requireDomain(modality, 'TRAINING');
      out[modality] = { version: doc.version, parameters: doc.parameters };
    }
    // A corrida entra no plano híbrido mesmo quando não está no foco (regras de espaçamento).
    if (!out['RUNNING']) {
      const running = await this.methodology.publishedOf('RUNNING');
      if (running) out['RUNNING'] = { version: running.version, parameters: running.parameters };
    }
    return out;
  }

  private async alreadyPlanned(userId: string, goalId: string): Promise<boolean> {
    const [training] = await this.db.runAsSystem((tx) =>
      tx
        .select({ id: trainingPlans.id })
        .from(trainingPlans)
        .where(and(eq(trainingPlans.userId, userId), eq(trainingPlans.goalId, goalId)))
        .limit(1),
    );
    if (training) return true;
    const [nutrition] = await this.db.runAsSystem((tx) =>
      tx
        .select({ id: nutritionPlans.id })
        .from(nutritionPlans)
        .where(and(eq(nutritionPlans.userId, userId), eq(nutritionPlans.goalId, goalId)))
        .limit(1),
    );
    return nutrition !== undefined;
  }

  private savedStrategy(userId: string, goalId: string): Promise<GoalStrategy | null> {
    return this.db.runAsSystem((tx) => goalStrategyOf(tx, userId, goalId));
  }

  private latestTrainingSessions(userId: string): Promise<PlanSession[]> {
    return this.db.runAsSystem((tx) => latestTrainingSessions(tx, userId));
  }
}

interface DraftContext {
  userId: string;
  goalId: string;
  today: string;
  triggerEventId: string | null;
  stateVersion: number;
  /** Parecer do coordenador: vai na justificativa da proposta, para o profissional. */
  notes?: readonly string[];
}

interface BuiltTraining {
  structure: TrainingPlanStructure;
  activeFocus: CoachedModality[];
  schedule: ScheduleContext;
  methodologyVersions: Record<string, number>;
  runs: AgentRunResult<BlockOutput>[];
}

interface BuiltNutrition {
  run: AgentRunResult<NutritionOutput>;
  /** Plano gravado: porções, nutrientes e trocas calculados a partir do rascunho do agente. */
  structure: NutritionPlanStructure;
  version: number;
}

interface Proposed {
  planId: string;
  activated: boolean;
  exceptionCaseId: string | null;
}

function proposalOf(
  action: CoachingProposal['action'],
  rationale: string[],
  assumptions: string[],
  run: Pick<AgentRunResult<unknown>, 'correctionRounds'>,
  expectedOutcome: string,
): CoachingProposal {
  return {
    action,
    rationale: rationale.slice(0, 6),
    evidence: [],
    assumptions: assumptions.slice(0, 5),
    uncertainty: run.correctionRounds >= 2 ? 'MEDIUM' : assumptions.length > 2 ? 'MEDIUM' : 'LOW',
    expectedOutcome,
  };
}
