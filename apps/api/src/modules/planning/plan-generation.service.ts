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
import { and, eq } from 'drizzle-orm';

import {
  type CoachedModality,
  type CoachingProposal,
  type PlanSession,
  type TrainingPlanStructure,
} from '@movivo/shared';

import type { AgentContextSources } from '../../core/agents/agent-context';
import { AgentRunner, AgentTaskError, type AgentRunResult } from '../../core/agents/agent-runner';
import type { AgentTask, StateSlice } from '../../core/agents/agent-task';
import { AccessLinkService } from '../../core/database/access-link.service';
import { AppConfigService } from '../../core/config';
import { nutritionPlans, trainingPlans } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { ExerciseCatalogProvider } from '../catalog/exercises/exercise-catalog-provider.service';
import { DecisionPipeline } from '../coaching/decision/decision-pipeline.service';
import { OutboxRelay } from '../domain-events/outbox-relay';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { StudentStateReader } from '../student-state/student-state.reader';
import { checkTrainingPlan, type PlanCheckContext } from './calc/plan-check';
import { hybridRules, nutritionRules, runningRules, hyroxRules } from './calc/params';
import {
  allocateSessions,
  coachedBudget,
  externalSessionsOf,
  hyroxInputOf,
  levelOf,
  nutritionInputOf,
  recentWeeklyLoad,
  runningInputOf,
  strategyInputOf,
  strengthInputOf,
} from './inputs';
import { PlanPublisher, type ScheduleContext } from './plan-publisher.service';
import { parseStateView, type StateView } from './state-view';
import type { BlockOutput } from './tasks/blocks';
import { hybridTask, type HybridInput } from './tasks/hybrid';
import { hyroxTask } from './tasks/hyrox';
import { nutritionTask } from './tasks/nutrition';
import { runningTask } from './tasks/running';
import { strategyTask } from './tasks/strategy';
import { strengthTask } from './tasks/strength';

const PLAN_STATE_SLICES: readonly StateSlice[] = [
  'identity',
  'goals',
  'availability',
  'restrictions',
  'preferences',
  'training',
  'body',
  'safety',
];

/** O link do plano vale por 90 dias (reemitido a cada versão publicada). */
const PLAN_LINK_TTL_MS = 90 * 86_400_000;

export type PlanGenerationResult =
  | { status: 'PUBLISHED'; trainingPlanId: string; nutritionPlanId: string; linkSent: boolean }
  | { status: 'PENDING_REVIEW'; exceptionCaseIds: string[] }
  | { status: 'SKIPPED'; reason: 'SAFETY_SIGNAL' | 'ALREADY_PLANNED' }
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
    private readonly accessLinks: AccessLinkService,
    private readonly queues: QueueManager,
    private readonly outbox: OutboxRelay,
    private readonly config: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PlanGenerationService.name);
  }

  async generate(
    userId: string,
    options: { triggerEventId?: string | null; now?: Date } = {},
  ): Promise<PlanGenerationResult> {
    const triggerEventId = options.triggerEventId ?? null;
    try {
      return await this.run(userId, triggerEventId, options.now ?? new Date());
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

  private async run(
    userId: string,
    triggerEventId: string | null,
    now: Date,
  ): Promise<PlanGenerationResult> {
    const state = await this.stateReader.read(userId, PLAN_STATE_SLICES, now);
    const view = parseStateView(state.slices as Record<string, unknown>);
    const timezone = (state.slices.identity as { timezone?: string | null } | undefined)?.timezone;
    const today = todayIn(timezone ?? null, now);

    if (!view.goal) throw new PlanningBlocked('GENERAL', 'o aluno não tem objetivo registrado');
    if (view.training.modalities.length === 0 || !view.availability) {
      throw new PlanningBlocked('GENERAL', 'faltam modalidades ou disponibilidade na anamnese');
    }
    const suspended = view.safety.signals.some((s) =>
      ['TRAINING', 'NUTRITION', 'ALL'].includes(s.scope),
    );
    if (suspended) return { status: 'SKIPPED', reason: 'SAFETY_SIGNAL' };
    if (await this.alreadyPlanned(userId, view.goal.goalId)) {
      return { status: 'SKIPPED', reason: 'ALREADY_PLANNED' };
    }

    const nutritionDoc = await this.requireDomain('NUTRITION', 'NUTRITION');
    const hybridDoc = await this.requireDomain('HYBRID', 'TRAINING');
    const nutritionParams = nutritionDoc.parameters;

    // 1. Estratégia -------------------------------------------------------------------
    const strategyInput = strategyInputOf(view, nutritionRules(nutritionParams), today);
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

    // 2. Blocos por modalidade --------------------------------------------------------
    const focus = strategy.strategy.modalityFocus;
    const external = externalSessionsOf(view);
    const budget = coachedBudget(view, focus.length);
    const allocation = allocateSessions(focus, budget);
    const activeFocus = focus.filter((m) => allocation[m] !== undefined);
    const domains = await this.requireFocusDomains(activeFocus);

    const blocks = await Promise.all(
      activeFocus.map(async (modality, index) => {
        const sessions = allocation[modality] ?? 1;
        const block = await this.buildBlock(modality, view, {
          userId,
          sessions,
          priority: index + 1,
          today,
          primary: index === 0,
          domains,
        });
        return { modality, priority: index + 1, run: block };
      }),
    );

    // 3. Plano integrado --------------------------------------------------------------
    const methodologyVersions: Record<string, number> = {
      NUTRITION: nutritionDoc.version,
      HYBRID: hybridDoc.version,
      ...Object.fromEntries(Object.entries(domains).map(([d, doc]) => [d, doc.version])),
    };
    const checkContext = this.checkContext(
      view,
      external.fixedDays,
      activeFocus,
      domains,
      hybridDoc.parameters,
      today,
    );
    const structure = await this.integrate({
      userId,
      view,
      blocks,
      external,
      checkContext,
      today,
      hybridParameters: hybridDoc.parameters,
      domains,
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

    // 4. Nutrição ---------------------------------------------------------------------
    const nutritionInput = nutritionInputOf(view, nutritionParams, {
      strategy: strategy.strategy.energyStrategy,
      sessions: structure.sessions,
      enduranceFocus: activeFocus[0] !== 'STRENGTH',
    });
    if (!nutritionInput) {
      throw new PlanningBlocked(
        'NUTRITION',
        'faltam peso, altura, idade ou sexo para o plano alimentar',
      );
    }
    const nutritionRun = await this.execute(nutritionTask, userId, nutritionInput);

    // 5. Decisão e publicação ---------------------------------------------------------
    const schedule: ScheduleContext = {
      windows: checkContext.windows,
      rules: checkContext.rules,
      minEasyDaysBetweenIntense: checkContext.minEasyDaysBetweenIntense,
      externalFixedDays: external.fixedDays,
    };
    const published = await this.db.runAsSystem(async (tx) => {
      const training = await this.publisher.createTrainingDraft(tx, {
        userId,
        goalId,
        structure,
        startsOn: today,
        methodologyVersions,
      });
      const nutrition = await this.publisher.createNutritionDraft(tx, {
        userId,
        goalId,
        structure: nutritionRun.output,
        startsOn: today,
        methodologyVersions: { NUTRITION: nutritionDoc.version },
      });
      const trainingRuns = blocks.map((b) => b.run);
      const exceptionCaseIds: string[] = [];

      const trainingDecision = await this.pipeline.decide(tx, {
        userId,
        taskId: hybridTask.id,
        triggerEventId,
        stateVersion: state.version,
        modelRunId: trainingRuns.flatMap((r) => r.modelRunIds).at(-1) ?? null,
        proposal: proposalOf(
          { type: 'PUBLISH_TRAINING_PLAN', planId: training.planId },
          [structure.summary],
          [],
          trainingRuns[0] ?? strategyRun,
          'Aderência às sessões-chave nas primeiras quatro semanas.',
        ),
      });
      if (trainingDecision.verdict === 'EXECUTE') {
        const result = await this.publisher.activateTraining(tx, {
          userId,
          planId: training.planId,
          structure,
          startsOn: today,
          schedule,
          decisionId: trainingDecision.decisionId,
        });
        await this.pipeline.recordExecution(tx, {
          userId,
          decisionId: trainingDecision.decisionId,
          command: 'training.publish_plan',
          status: 'SUCCEEDED',
          result: { planId: training.planId, ...result },
        });
      } else if (trainingDecision.exceptionCaseId) {
        exceptionCaseIds.push(trainingDecision.exceptionCaseId);
      }

      const nutritionDecision = await this.pipeline.decide(tx, {
        userId,
        taskId: nutritionTask.id,
        triggerEventId,
        stateVersion: state.version,
        modelRunId: nutritionRun.modelRunIds.at(-1) ?? null,
        proposal: proposalOf(
          { type: 'PUBLISH_NUTRITION_PLAN', planId: nutrition.planId },
          [nutritionRun.output.summary],
          [],
          nutritionRun,
          'Registro de refeições e proteína na meta em pelo menos cinco dias por semana.',
        ),
      });
      if (nutritionDecision.verdict === 'EXECUTE') {
        await this.publisher.activateNutrition(tx, { userId, planId: nutrition.planId });
        await this.pipeline.recordExecution(tx, {
          userId,
          decisionId: nutritionDecision.decisionId,
          command: 'nutrition.publish_plan',
          status: 'SUCCEEDED',
          result: { planId: nutrition.planId },
        });
      } else if (nutritionDecision.exceptionCaseId) {
        exceptionCaseIds.push(nutritionDecision.exceptionCaseId);
      }
      return {
        trainingPlanId: training.planId,
        nutritionPlanId: nutrition.planId,
        activated:
          trainingDecision.verdict === 'EXECUTE' && nutritionDecision.verdict === 'EXECUTE',
        exceptionCaseIds,
      };
    });
    await this.outbox.flushSoon();

    if (!published.activated) {
      return { status: 'PENDING_REVIEW', exceptionCaseIds: published.exceptionCaseIds };
    }
    const linkSent = await this.sendPlanLink(userId);
    return {
      status: 'PUBLISHED',
      trainingPlanId: published.trainingPlanId,
      nutritionPlanId: published.nutritionPlanId,
      linkSent,
    };
  }

  // --- Montagem -------------------------------------------------------------------------

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
    },
  ): Promise<AgentRunResult<BlockOutput>> {
    const { userId } = options;
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
      return this.execute(strengthTask, userId, input);
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
      return this.execute(runningTask, userId, input);
    }
    const hyroxParams = hyroxRules(options.domains['HYROX']?.parameters);
    const input = hyroxInputOf(view, hyroxParams, {
      sessions: options.sessions,
      priority: options.priority,
      today: options.today,
    });
    if (!input) throw new PlanningBlocked('TRAINING', 'dados insuficientes para o bloco de HYROX');
    return this.execute(hyroxTask, userId, input);
  }

  private checkContext(
    view: StateView,
    externalFixedDays: PlanCheckContext['externalFixedDays'],
    focus: readonly CoachedModality[],
    domains: Record<string, { parameters: Record<string, Record<string, unknown>> }>,
    hybridParameters: Record<string, Record<string, unknown>>,
    today: string,
  ): PlanCheckContext {
    const availability = view.availability;
    if (!availability) throw new PlanningBlocked('GENERAL', 'sem disponibilidade informada');
    const runningLevel = levelOf(view, 'RUNNING');
    return {
      windows: availability.windows,
      maxSessionsPerWeek: Math.max(1, availability.maxSessionsPerWeek),
      externalFixedDays,
      focus,
      rules: hybridRules(hybridParameters),
      minEasyDaysBetweenIntense: Math.max(
        0,
        runningRules(domains['RUNNING']?.parameters, runningLevel).minEasyDaysBetweenQuality ?? 1,
      ),
      recentWeeklyLoad: recentWeeklyLoad(view),
      startsOn: today,
    };
  }

  /** Uma modalidade e nenhum esporte externo: o código monta. Senão, o planejador híbrido reconcilia. */
  private async integrate(input: {
    userId: string;
    view: StateView;
    blocks: { modality: CoachedModality; priority: number; run: AgentRunResult<BlockOutput> }[];
    external: ReturnType<typeof externalSessionsOf>;
    checkContext: PlanCheckContext;
    today: string;
    hybridParameters: Record<string, Record<string, unknown>>;
    domains: Record<string, { parameters: Record<string, Record<string, unknown>> }>;
  }): Promise<TrainingPlanStructure> {
    const { blocks, external } = input;
    const only = blocks[0];
    if (blocks.length === 1 && only && external.sessions.length === 0) {
      const block = only.run.output;
      return {
        summary: block.summary,
        modalityPriorities: [{ modality: only.modality, priority: 1 }],
        phases: block.phases,
        sessions: this.withCatalogNames(block.sessions),
      };
    }
    const hybridInput: HybridInput = {
      blocks: blocks.map((b) => ({
        modality: b.modality,
        priority: b.priority,
        block: { ...b.run.output, sessions: this.withCatalogNames(b.run.output.sessions) },
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
    };
    const run = await this.execute(hybridTask, input.userId, hybridInput);
    return run.output;
  }

  /** O nome exibido do exercício vem SEMPRE do catálogo, não do que o modelo escreveu. */
  private withCatalogNames(sessions: PlanSession[]): PlanSession[] {
    const byId = new Map(this.catalog.getAll().map((e) => [e.id, e.name]));
    return sessions.map((session) =>
      session.content.modality === 'STRENGTH'
        ? {
            ...session,
            content: {
              ...session.content,
              exercises: session.content.exercises.map((e) => ({
                ...e,
                name: byId.get(e.exerciseId) ?? e.name,
              })),
            },
          }
        : session,
    );
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

  // --- Entrega ---------------------------------------------------------------------------

  private async sendPlanLink(userId: string): Promise<boolean> {
    const { token } = await this.accessLinks.issue('PLAN', userId, userId, PLAN_LINK_TTL_MS);
    const url = `${this.config.whatsapp.publicSiteUrl}/plano/${token}`;
    await this.queues.enqueue(
      QUEUE.whatsappOutbound,
      'plan-ready',
      {
        userId,
        type: 'CONVERSATION_MESSAGE',
        dedupeId: `plan-ready_${userId}_${Date.now()}`,
        text: `Seu plano de treino e alimentação está pronto. Ele foi montado a partir do que você contou e segue a metodologia dos profissionais de Educação Física e Nutrição da MOVIVO.\n---\nVeja aqui: ${url}\n---\nSe algo não combinar com a sua rotina, é só responder por aqui que a gente ajusta.`,
      },
      { jobId: `plan-ready_${userId}_${Date.now()}` },
    );
    return true;
  }
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
