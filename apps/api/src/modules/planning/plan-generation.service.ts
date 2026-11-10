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
import { and, desc, eq, sql } from 'drizzle-orm';

import {
  type CoachedModality,
  type CoachingProposal,
  POSTURE_REGION_LABELS,
  type GoalStrategy,
  type Mesocycle,
  type PostureRegion,
  type SessionPlan,
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
import { PhysiqueAssessmentService } from '../body-assessment/physique-assessment.service';
import { OutboxRelay } from '../domain-events/outbox-relay';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { StudentStateReader } from '../student-state/student-state.reader';
import { checkTrainingPlan, type PlanCheckContext } from './calc/plan-check';
import { nutritionRules, hybridRules, hyroxRules } from './calc/params';
import {
  externalSessionsOf,
  fallbackSessionPlan,
  hyroxInputOf,
  levelOf,
  mesocyclePhaseOf,
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
  'bodyComposition',
  'safety',
];

/** Próximo ciclo: a reavaliação do aluno e a análise dos agentes orientam os dois protocolos novos. */
export interface PlanRenewal {
  trainingInstruction: string;
  nutritionInstruction: string;
  /** Mesociclo de musculação do próximo ciclo, escolhido na reavaliação. */
  trainingMesocycle?: Mesocycle;
  /** Contexto para quem audita o protocolo na Fila (resumo do ciclo, pontos de saúde). */
  notes: string[];
}

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

/**
 * Alinhamento e simetria que a IA observou nas fotos, para o profissional que audita o protocolo.
 * Vão na justificativa do protocolo; ao aluno chegam como percepção, nunca como diagnóstico.
 */
export function physiqueNotesOf(view: StateView): string[] {
  const composition = view.bodyComposition;
  if (!composition) return [];
  const posture = composition.posture.map(
    (p) => `${POSTURE_REGION_LABELS[p.region as PostureRegion] ?? p.region}: ${p.finding}`,
  );
  const symmetry = composition.symmetry ? [`Simetria: ${composition.symmetry}`] : [];
  const lines = [...posture, ...symmetry];
  return lines.length === 0
    ? []
    : [`Avaliação postural por foto (leitura da IA, para auditoria): ${lines.join('; ')}.`];
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
    private readonly physique: PhysiqueAssessmentService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PlanGenerationService.name);
  }

  async generate(
    userId: string,
    options: { triggerEventId?: string | null; now?: Date; renewal?: PlanRenewal } = {},
  ): Promise<PlanGenerationResult> {
    const triggerEventId = options.triggerEventId ?? null;
    return this.withFailureCase(userId, triggerEventId, () =>
      this.run(userId, triggerEventId, options.now ?? new Date(), options.renewal),
    );
  }

  /**
   * Pedido de ajuste feito na fila: o caso encerrado traz a proposta (qual rascunho) e a orientação
   * do profissional (que só vive no banco, nunca na fila do Redis). O rascunho recusado vira
   * `SUPERSEDED` e os agentes refazem só aquele protocolo.
   */
  adjustFromCase(
    userId: string,
    exceptionCaseId: string,
    options: { triggerEventId?: string | null; now?: Date } = {},
  ): Promise<PlanGenerationResult> {
    return this.redoFromCase(userId, exceptionCaseId, 'ADJUSTMENT_REQUESTED', options);
  }

  /**
   * Regerar do zero, pedido na fila: mesmo caminho do ajuste, mas SEM orientação. O rascunho
   * recusado vira `SUPERSEDED` e os agentes montam outro protocolo daquele tipo a partir do
   * Estado do Aluno e da estratégia salva (o rascunho antigo não entra na entrada).
   */
  regenerateFromCase(
    userId: string,
    exceptionCaseId: string,
    options: { triggerEventId?: string | null; now?: Date } = {},
  ): Promise<PlanGenerationResult> {
    return this.redoFromCase(userId, exceptionCaseId, 'REGENERATION_REQUESTED', options);
  }

  private async redoFromCase(
    userId: string,
    exceptionCaseId: string,
    outcome: 'ADJUSTMENT_REQUESTED' | 'REGENERATION_REQUESTED',
    options: { triggerEventId?: string | null; now?: Date },
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
      const note = row?.resolution?.note;
      const action = row?.action;
      // Ajuste exige a orientação gravada no caso; a regeneração do zero não leva nenhuma.
      const instruction =
        outcome === 'ADJUSTMENT_REQUESTED' && typeof note === 'string' ? note : undefined;
      if (
        row?.resolution?.outcome !== outcome ||
        (outcome === 'ADJUSTMENT_REQUESTED' && instruction === undefined) ||
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
    return this.adjust(userId, request.domain, request.instruction, {
      ...options,
      sourceCaseId: exceptionCaseId,
    });
  }

  /**
   * Encerrar um caso de falha na Fila tenta de novo o que falhou: a regeração ou o ajuste daquele
   * protocolo (com a mesma orientação, lida do caso de origem) ou, sem origem, a geração inicial.
   */
  async retryFromFailureCase(
    userId: string,
    failureCaseId: string,
    options: { triggerEventId?: string | null; now?: Date } = {},
  ): Promise<PlanGenerationResult> {
    const [failure] = await this.db.runAsSystem((tx) =>
      tx
        .select({ subject: exceptionCases.subject })
        .from(exceptionCases)
        .where(and(eq(exceptionCases.id, failureCaseId), eq(exceptionCases.userId, userId))),
    );
    const { sourceCaseId, redoDomain } = failure?.subject ?? {};
    if (sourceCaseId) {
      const [source] = await this.db.runAsSystem((tx) =>
        tx
          .select({ resolution: exceptionCases.resolution })
          .from(exceptionCases)
          .where(and(eq(exceptionCases.id, sourceCaseId), eq(exceptionCases.userId, userId))),
      );
      const outcome = source?.resolution?.outcome;
      if (outcome === 'ADJUSTMENT_REQUESTED' || outcome === 'REGENERATION_REQUESTED') {
        return this.redoFromCase(userId, sourceCaseId, outcome, options);
      }
    }
    if (redoDomain === 'TRAINING' || redoDomain === 'NUTRITION') {
      return this.adjust(userId, redoDomain, undefined, options);
    }
    return this.generate(userId, options);
  }

  /**
   * Um especialista pede o ajuste do protocolo durante o acompanhamento semanal: o agente refaz o
   * treino ou a alimentação com a instrução dele, a partir da estratégia já salva. O rascunho
   * passa pelas políticas como qualquer outro (liberação automática com janela de revisão, ou
   * Fila do Profissional quando a política pede).
   */
  adjustByInstruction(
    userId: string,
    domain: 'TRAINING' | 'NUTRITION',
    instruction: string,
    options: { triggerEventId?: string | null; now?: Date } = {},
  ): Promise<PlanGenerationResult> {
    return this.adjust(userId, domain, instruction, options);
  }

  /**
   * Refaz só um dos protocolos (treino ou alimentação) a partir da estratégia já salva, com a
   * orientação do profissional que o revisou na fila ou sem nenhuma (regerar do zero). O novo
   * rascunho passa pelo motor de políticas como na geração inicial.
   */
  private async adjust(
    userId: string,
    domain: 'TRAINING' | 'NUTRITION',
    instruction: string | undefined,
    options: { triggerEventId?: string | null; now?: Date; sourceCaseId?: string } = {},
  ): Promise<PlanGenerationResult> {
    const triggerEventId = options.triggerEventId ?? null;
    return this.withFailureCase(
      userId,
      triggerEventId,
      async () => {
        // Retry ou reentrega do job para o MESMO pedido: se o rascunho já foi gravado, não refaz
        // (nem gasta modelo): só conclui o que faltar depois do commit (outbox e entrega).
        if (triggerEventId) {
          const taskId = domain === 'TRAINING' ? hybridTask.id : nutritionTask.id;
          const previous = await this.db.runAsSystem((tx) =>
            this.proposalForTrigger(tx, userId, triggerEventId, taskId),
          );
          if (previous) return this.finishAdjust(userId, domain, previous);
        }
        const { state, view, today } = await this.readState(userId, options.now ?? new Date());
        if (!view.goal || !view.availability || view.training.modalities.length === 0) {
          throw new PlanningBlocked(domain, 'faltam objetivo, modalidades ou disponibilidade');
        }
        const strategy = await this.savedStrategy(userId, view.goal.goalId);
        if (!strategy)
          throw new PlanningBlocked(domain, 'o aluno ainda não tem estratégia definida');
        const ctx: DraftContext = {
          userId,
          goalId: view.goal.goalId,
          today,
          triggerEventId,
          stateVersion: state.version,
          // O pedido da Fila gera no máximo um rascunho por evento, mesmo com retry ou corrida.
          dedupeByTrigger: true,
        };

        const proposed =
          domain === 'TRAINING'
            ? await this.buildTraining(
                view,
                userId,
                strategy.modalityFocus,
                // Estratégia anterior à decisão de frequência: respaldo calculado em código.
                strategy.sessionPlan ??
                  fallbackSessionPlan(
                    view,
                    strategy.modalityFocus,
                    hybridRules((await this.requireDomain('HYBRID', 'TRAINING')).parameters),
                  ),
                today,
                instruction,
              ).then((built) => this.db.runAsSystem((tx) => this.proposeTraining(tx, ctx, built)))
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
        return this.finishAdjust(userId, domain, proposed);
      },
      { domain, sourceCaseId: options.sourceCaseId },
    );
  }

  /**
   * O que acontece depois do commit do rascunho. A chave da entrega é o plano: se o job repetir
   * esta etapa (a anterior caiu depois do commit), o aluno não recebe a mensagem duas vezes.
   */
  private async finishAdjust(
    userId: string,
    domain: 'TRAINING' | 'NUTRITION',
    proposed: Proposed,
  ): Promise<PlanGenerationResult> {
    await this.outbox.flushSoon();
    if (!proposed.activated) {
      return {
        status: 'PENDING_REVIEW',
        exceptionCaseIds: proposed.exceptionCaseId ? [proposed.exceptionCaseId] : [],
      };
    }
    await this.delivery.sendAfterPublish(userId, domain, proposed.planId);
    return { status: 'ADJUSTED', planId: proposed.planId };
  }

  /** Proposta de publicação já gravada para este evento e esta tarefa (ou `null`). */
  private async proposalForTrigger(
    tx: TenantTransaction,
    userId: string,
    triggerEventId: string,
    taskId: string,
  ): Promise<Proposed | null> {
    const [proposal] = await tx
      .select({ id: coachingProposals.id, action: coachingProposals.action })
      .from(coachingProposals)
      .where(
        and(
          eq(coachingProposals.userId, userId),
          eq(coachingProposals.triggerEventId, triggerEventId),
          eq(coachingProposals.taskId, taskId),
        ),
      )
      .orderBy(desc(coachingProposals.createdAt))
      .limit(1);
    const action = proposal?.action;
    if (
      !proposal ||
      (action?.type !== 'PUBLISH_TRAINING_PLAN' && action?.type !== 'PUBLISH_NUTRITION_PLAN')
    ) {
      return null;
    }
    const table = action.type === 'PUBLISH_TRAINING_PLAN' ? trainingPlans : nutritionPlans;
    const [plan] = await tx
      .select({ status: table.status })
      .from(table)
      .where(and(eq(table.id, action.planId), eq(table.userId, userId)));
    const [reviewCase] = await tx
      .select({ id: exceptionCases.id })
      .from(exceptionCases)
      .where(
        and(
          eq(exceptionCases.userId, userId),
          sql`${exceptionCases.subject}->>'proposalId' = ${proposal.id}`,
        ),
      )
      .limit(1);
    return {
      planId: action.planId,
      activated: plan?.status === 'ACTIVE',
      exceptionCaseId: reviewCase?.id ?? null,
    };
  }

  /**
   * Dentro da transação que cria o rascunho: serializa pedidos iguais (lock por evento+tarefa) e,
   * se outro já gravou a proposta, devolve a dele em vez de criar um segundo rascunho.
   */
  private async claimTrigger(
    tx: TenantTransaction,
    ctx: DraftContext,
    taskId: string,
  ): Promise<Proposed | null> {
    if (!ctx.dedupeByTrigger || !ctx.triggerEventId) return null;
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`plan-redo:${ctx.userId}:${ctx.triggerEventId}:${taskId}`}))`,
    );
    return this.proposalForTrigger(tx, ctx.userId, ctx.triggerEventId, taskId);
  }

  /** Falha prevista (dado faltando, agente sem saída válida) vira caso na fila, não exceção. */
  private async withFailureCase(
    userId: string,
    triggerEventId: string | null,
    work: () => Promise<PlanGenerationResult>,
    redo?: { domain: 'TRAINING' | 'NUTRITION'; sourceCaseId?: string },
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
        const domain =
          error instanceof PlanningBlocked ? error.domain : (redo?.domain ?? 'GENERAL');
        const exceptionCaseId = await this.db.runAsSystem((tx) =>
          this.pipeline.openFailureCase(tx, {
            userId,
            domain,
            summary: `Não foi possível gerar o plano automaticamente: ${reason}`,
            // Encerrar o caso refaz o MESMO pedido (`retryFromFailureCase`), não a geração inicial.
            subject: {
              triggerEventId: triggerEventId ?? 'manual',
              ...(redo ? { redoDomain: redo.domain } : {}),
              ...(redo?.sourceCaseId ? { sourceCaseId: redo.sourceCaseId } : {}),
            },
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
    renewal?: PlanRenewal,
  ): Promise<PlanGenerationResult> {
    const first = await this.readState(userId, now);

    if (!first.view.goal) {
      throw new PlanningBlocked('GENERAL', 'o aluno não tem objetivo registrado');
    }
    if (first.view.training.modalities.length === 0 || !first.view.availability) {
      throw new PlanningBlocked('GENERAL', 'faltam modalidades ou disponibilidade na anamnese');
    }
    // Só a emergência impede a geração. Os demais sinais (PAR-Q de risco, dor, lesão) entram no
    // planejamento como restrição e o protocolo completo vai para a fila do profissional.
    if (first.view.safety.signals.some((s) => s.severity === 'EMERGENCY')) {
      return { status: 'SKIPPED', reason: 'SAFETY_SIGNAL' };
    }
    if (!renewal && (await this.alreadyPlanned(userId, first.view.goal.goalId))) {
      return { status: 'SKIPPED', reason: 'ALREADY_PLANNED' };
    }

    // Primeira avaliação: as fotos da anamnese viram avaliação física (grupos musculares, postura,
    // faixa de gordura) ANTES da estratégia, para treino, alimentação e recuperação partirem dela.
    // Falta de foto, de consentimento ou de leitura válida não trava o protocolo.
    const { state, view, today } =
      !renewal && (await this.physique.assessInitial(userId, first.today))
        ? await this.readState(userId, now)
        : first;
    if (!view.goal) throw new PlanningBlocked('GENERAL', 'o aluno não tem objetivo registrado');

    const nutritionDoc = await this.requireDomain('NUTRITION', 'NUTRITION');
    const hybridDoc = await this.requireDomain('HYBRID', 'TRAINING');

    // 1. Estratégia -------------------------------------------------------------------
    const strategyInput = strategyInputOf(
      view,
      nutritionRules(nutritionDoc.parameters),
      today,
      hybridRules(hybridDoc.parameters),
    );
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
    // Quantas sessões e como se dividem: decisão da estratégia (já validada contra o teto e o descanso).
    const { sessionPlan } = strategy.strategy;
    const nutritionFor = (built: BuiltTraining) => ({
      strategy: strategy.strategy.energyStrategy,
      sessions: built.structure.sessions,
      enduranceFocus: built.activeFocus[0] !== 'STRENGTH',
    });
    const withRenewal = (instruction: string | undefined, base: string | undefined) =>
      [base, instruction].filter(Boolean).join('\n') || undefined;
    let training = await this.buildTraining(
      view,
      userId,
      focus,
      sessionPlan,
      today,
      renewal?.trainingInstruction,
      renewal?.trainingMesocycle,
    );
    let nutrition = await this.buildNutrition(
      view,
      userId,
      nutritionFor(training),
      renewal?.nutritionInstruction,
    );

    // 4b. Coordenador: parecer sobre o protocolo inteiro e uma rodada de ajuste, se pedir.
    const review = await this.coordinate(userId, strategy.strategy, training, nutrition);
    const notes = [
      ...(renewal?.notes ?? []),
      ...physiqueNotesOf(view),
      ...(review
        ? [`Coordenador: ${review.professionalNote}`]
        : [
            'Coordenador sem parecer nesta geração: confira a coerência entre treino e alimentação.',
          ]),
    ];
    const adjustments = [...(review?.adjustments ?? [])].sort((a) =>
      a.target === 'TRAINING' ? -1 : 1,
    );
    for (const adjustment of adjustments) {
      notes.push(
        `Ajuste pedido pelo coordenador (${adjustment.target}): ${adjustment.instruction}`,
      );
      if (adjustment.target === 'TRAINING') {
        training = await this.buildTraining(
          view,
          userId,
          focus,
          sessionPlan,
          today,
          withRenewal(adjustment.instruction, renewal?.trainingInstruction),
          renewal?.trainingMesocycle,
        );
      } else {
        nutrition = await this.buildNutrition(
          view,
          userId,
          nutritionFor(training),
          withRenewal(adjustment.instruction, renewal?.nutritionInstruction),
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
    // Idempotente pelo id do plano: repetir a geração não manda os protocolos duas vezes.
    const linkSent = await this.delivery.sendProtocols(userId, published.trainingPlanId);
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
    sessionPlan: SessionPlan,
    today: string,
    instruction?: string,
    mesocycle?: Mesocycle,
  ): Promise<BuiltTraining> {
    const hybridDoc = await this.requireDomain('HYBRID', 'TRAINING');
    const external = externalSessionsOf(view);
    const allocation: Record<string, number> = Object.fromEntries(
      sessionPlan.byModality.map((item) => [item.modality, item.sessions]),
    );
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
          mesocycle,
          otherCardio: {
            runningSessions: allocation['RUNNING'] ?? 0,
            externalMinutesPerWeek: external.sessions.reduce(
              (sum, session) => sum + session.estimatedMinutes * session.weeklyFrequency,
              0,
            ),
          },
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
      sessionPlan.weekly,
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
    const previous = await this.claimTrigger(tx, ctx, hybridTask.id);
    if (previous) return previous;
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
    const previous = await this.claimTrigger(tx, ctx, nutritionTask.id);
    if (previous) return previous;
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
      mesocycle?: Mesocycle;
      /** Corrida e esporte externo do plano: descontam da meta de cardio da musculação. */
      otherCardio?: { runningSessions: number; externalMinutesPerWeek: number };
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
        mesocycle: options.mesocycle,
        otherCardio: options.otherCardio,
      });
      if (!input)
        throw new PlanningBlocked(
          'TRAINING',
          'sem exercícios viáveis para o local e as limitações do aluno',
        );
      const run = await this.execute(strengthTask, userId, { ...input, professionalInstruction });
      return {
        ...run,
        output: { ...run.output, phases: [mesocyclePhaseOf(input, run.output.phases)] },
      };
    }
    if (modality === 'RUNNING') {
      const input = runningInputOf(view, {
        sessions: options.sessions,
        priority: options.priority,
        today: options.today,
        params: options.domains['RUNNING']?.parameters,
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
    // Musculação como foco principal: o mesociclo dela define a linha do tempo do plano.
    const strength = blocks.find((b) => b.modality === 'STRENGTH' && b.priority === 1);
    return strength ? { ...run.output, phases: strength.run.output.phases } : run.output;
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
  /** No máximo um rascunho por (evento, tarefa): pedido da Fila reentregue não duplica. */
  dedupeByTrigger?: boolean;
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
