/**
 * Orquestrador conversacional: da mensagem do aluno à ação executada (ou à pergunta, ou ao caso
 * para a equipe) e à resposta.
 *
 *   idempotência → sentinela (regras + detector de texto) → classificação → fluxo da intenção →
 *   proposta → motor de políticas → EXECUTAR | PERGUNTAR | ESCALAR | BLOQUEAR → resposta.
 *
 * O modelo classifica e responde dúvidas; QUEM executa é o código, com a decisão do motor de
 * políticas na mesma transação. As respostas às ações são texto fixo (verificável).
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, asc, eq, gte, inArray } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import {
  MEAL_SLOT_LABELS,
  type MealSlot,
  PERSONAS,
  personaOf,
  type CoachingProposal,
  type PersonaKey,
  type SafetySignal,
  NON_BLOCKING_SIGNAL_KINDS,
  type SafetySignalKind,
  type Weekday,
} from '@movivo/shared';

import type { AgentContextSources } from '../../core/agents/agent-context';
import type { StateSlice } from '../../core/agents/agent-task';
import { AgentRunner, AgentTaskError } from '../../core/agents/agent-runner';
import { nutritionPlans, planSessions, scheduledSessions } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { ExerciseCatalogProvider } from '../catalog/exercises/exercise-catalog-provider.service';
import { rankEquivalents } from '../catalog/exercises/exercise-equivalence';
import { DecisionExecutor } from '../coaching/decision/decision-executor.service';
import {
  DecisionPipeline,
  type DecisionOutcome,
} from '../coaching/decision/decision-pipeline.service';
import { FaqService } from '../../core/attendance-rules/faq.service';
import {
  ForbiddenTopicsService,
  ForbiddenTopicsUnavailableError,
} from '../../core/attendance-rules/forbidden-topics.service';
import { L1GuardrailService } from '../../core/attendance-rules/l1-guardrail.service';
import { PublishedPolicies } from '../coaching/policy/published-policies';
import { SafetyService } from '../coaching/safety/safety.service';
import { signalOf } from '../coaching/safety/sentinel-rules';
import { OutboxRelay } from '../domain-events/outbox-relay';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { FoodCandidatesService } from '../nutrition/food-candidates.service';
import { FoodLogService } from '../nutrition/food-log.service';
import { mealSuggestionTask } from '../nutrition/meal-suggestion-task';
import { buildOption, mealTarget, quantityLabel, tokensOf } from '../planning/calc/menu';
import { addDays, mondayOf } from '../planning/calc/week-planner';
import { todayIn } from '../planning/plan-generation.service';
import { catalogProfileOf, contraindicationsOf, exercisePreference } from '../planning/inputs';
import { fold } from '../planning/tasks/common';
import { parseStateView } from '../planning/state-view';
import { StudentStateReader } from '../student-state/student-state.reader';
import { ScheduleService } from '../training/schedule.service';
import { shortenFactor } from '../training/session-adjustment';
import { TrainingLinkService } from '../training/training-link.service';
import { windowsFor, DomainCommands } from './domain-commands.service';
import * as msg from './messages';
import { textSignals } from './safety-text-rules';
import { declinesSwap, swapScopeOf, type SwapScope } from './swap-scope';
import { KnowledgeRetrievalService } from '../../core/knowledge/knowledge-retrieval.service';
import { answerTask, classifyTask, riskTask, substituteTask, type ClassifyOutput } from './tasks';

const PROCESSED_TTL_SECONDS = 86_400;

/** Refeição que faz sentido pela hora local, entre as do plano do aluno. */
export function mealByClock(
  slots: readonly MealSlot[],
  now: Date,
  timezone: string | null,
): MealSlot | null {
  let hour: number;
  try {
    hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        hourCycle: 'h23',
        timeZone: timezone ?? 'America/Sao_Paulo',
      }).format(now),
    );
  } catch {
    return null;
  }
  const wanted: MealSlot =
    hour >= 5 && hour < 10
      ? 'BREAKFAST'
      : hour < 12
        ? 'MORNING_SNACK'
        : hour < 15
          ? 'LUNCH'
          : hour < 18
            ? 'AFTERNOON_SNACK'
            : hour < 22
              ? 'DINNER'
              : 'SUPPER';
  return slots.includes(wanted) ? wanted : null;
}
/** Uma troca "só hoje ou no protocolo?" nasce de uma situação do momento: passadas horas, caduca. */
const PENDING_SWAP_TTL_SECONDS = 3 * 3600;

/** Troca já escolhida pelo agente, à espera de o aluno dizer o alcance. */
interface PendingSwap {
  planSessionKey: string;
  fromExerciseId: string;
  fromName: string;
  toExerciseId: string;
  toName: string;
  reason: 'EQUIPMENT' | 'DISCOMFORT' | 'PREFERENCE' | 'DIFFICULTY' | 'OTHER';
  why: string;
}
const WEEKDAYS: readonly Weekday[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const ALL_SLICES: readonly StateSlice[] = [
  'identity',
  'goals',
  'availability',
  'restrictions',
  'preferences',
  'training',
  'safety',
];

export interface HandleInput {
  userId: string;
  text: string;
  messageIds: readonly string[];
  correlationId: string;
  now?: Date;
}

export interface HandleResult {
  status: 'DUPLICATE' | 'EMERGENCY' | 'EXECUTED' | 'ASKED' | 'ESCALATED' | 'ANSWERED' | 'INFORMED';
  /** Texto a enviar ao aluno (`null` = nada a enviar). */
  reply: string | null;
  intent?: string;
}

function proposalOf(
  action: CoachingProposal['action'],
  rationale: string,
  expectedOutcome: string,
  uncertainty: CoachingProposal['uncertainty'] = 'LOW',
): CoachingProposal {
  return {
    action,
    rationale: [rationale],
    evidence: [],
    assumptions: [],
    uncertainty,
    expectedOutcome,
  };
}

@Injectable()
export class ConversationOrchestrator {
  constructor(
    private readonly db: TenantDatabase,
    private readonly runner: AgentRunner,
    private readonly state: StudentStateReader,
    private readonly methodology: PublishedMethodologyReader,
    private readonly pipeline: DecisionPipeline,
    private readonly executor: DecisionExecutor,
    private readonly safety: SafetyService,
    private readonly policies: PublishedPolicies,
    private readonly schedule: ScheduleService,
    private readonly commands: DomainCommands,
    private readonly catalog: ExerciseCatalogProvider,
    private readonly foods: FoodLogService,
    private readonly foodCandidates: FoodCandidatesService,
    private readonly links: TrainingLinkService,
    private readonly outbox: OutboxRelay,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly faq: FaqService,
    private readonly forbiddenTopics: ForbiddenTopicsService,
    private readonly guardrails: L1GuardrailService,
    private readonly logger: PinoLogger,
    /** Busca nos artigos (RAG). Opcional: sem ela, ou com `RAG_ENABLED=false`, a resposta é a de antes. */
    @Optional() private readonly retrieval: KnowledgeRetrievalService | null = null,
  ) {
    this.logger.setContext(ConversationOrchestrator.name);
  }

  async handle(input: HandleInput): Promise<HandleResult> {
    const { userId, text } = input;
    const now = input.now ?? new Date();

    // Idempotência: mensagem já tratada (reentrega do webhook, retry do job) não decide de novo.
    const fresh: string[] = [];
    for (const id of input.messageIds) {
      const key = this.keys.forUser(userId, 'conversation', 'processed', id);
      if ((await this.redis.set(key, '1', 'EX', PROCESSED_TTL_SECONDS, 'NX')) !== null)
        fresh.push(id);
    }
    if (input.messageIds.length > 0 && fresh.length === 0)
      return { status: 'DUPLICATE', reply: null };

    const sources = this.sources(userId, now);
    const stateRead = await this.state.read(userId, ALL_SLICES, now);
    const view = parseStateView(stateRead.slices as Record<string, unknown>);
    const identity = stateRead.slices.identity as
      { timezone?: string | null; biologicalSex?: string | null } | undefined;
    const timezone = identity?.timezone;
    const persona = personaOf(identity?.biologicalSex);
    const today = todayIn(timezone ?? null, now);
    const weekday = WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()] ?? 'MON';

    // 1. Sentinela: regras sempre; o detector de texto só acrescenta.
    const signals = await this.detectSignals(userId, text, sources);
    const raised = signals.length > 0 ? await this.raiseSignals(userId, signals) : [];
    if (raised.some((s) => s.severity === 'EMERGENCY')) {
      return { status: 'EMERGENCY', reply: msg.EMERGENCY_MESSAGE };
    }

    // 1b. Governança dos profissionais: tema proibido encerra; FAQ publicado responde sem modelo.
    const governed = await this.governance(userId, text);
    if (governed) return governed;

    // 1c. Resposta à pergunta de alcance de uma troca de exercício (só hoje ou no protocolo).
    const answered = await this.swapScopeAnswer(userId, text, today);
    if (answered) return answered;

    // 2. Classificação.
    const classified = await this.runner.run(
      classifyTask,
      { message: text, todayWeekday: weekday },
      { userId, sources },
    );
    const intent = classified.output;
    this.logger.info(
      { userId, intent: intent.intent, event: 'conversation_classified' },
      'mensagem classificada',
    );

    // Dor e lesão não travam a conversa: o alerta já foi aberto para o profissional e a troca de
    // exercício segue (o catálogo seguro já exclui o que é contraindicado para o aluno).
    const painDoesNotBlockSwap =
      intent.intent === 'EXERCISE_SWAP' &&
      raised.every((s) => NON_BLOCKING_SIGNAL_KINDS.includes(s.kind));
    if (!painDoesNotBlockSwap && (raised.length > 0 || intent.intent === 'PAIN_OR_SYMPTOM')) {
      return { status: 'ESCALATED', reply: msg.PAIN_MESSAGE, intent: intent.intent };
    }

    // 3. Fluxo da intenção.
    switch (intent.intent) {
      case 'PAIN_OR_SYMPTOM':
        return { status: 'ESCALATED', reply: msg.PAIN_MESSAGE, intent: intent.intent };
      case 'UNAVAILABILITY':
        return this.unavailability(userId, intent, view, today, now);
      case 'SHORT_ON_TIME':
        return this.shortOnTime(userId, intent, today);
      case 'EXERCISE_SWAP':
        return this.exerciseSwap(userId, text, intent, view, today, now);
      case 'MEAL_SUGGESTION':
        return this.mealSuggestion(
          userId,
          text,
          intent,
          view,
          stateRead.slices.identity,
          sources,
          now,
          timezone ?? null,
        );
      case 'FOOD_LOG': {
        const draft = await this.foods.draftFromText(userId, { text }, now);
        if (draft.items.length === 0) {
          return {
            status: 'ASKED',
            reply: draft.needsClarification ?? msg.FOOD_CLARIFICATION_FALLBACK,
            intent: intent.intent,
          };
        }
        const link = await this.links.shortUrl(userId, { next: '/alimentacao' });
        return {
          status: 'INFORMED',
          reply: msg.foodDraftMessage(draft.items, link),
          intent: intent.intent,
        };
      }
      case 'WORKOUT_REPORT':
        return {
          status: 'INFORMED',
          reply: msg.workoutReportMessage(await this.links.shortUrl(userId)),
          intent: intent.intent,
        };
      case 'LINK_REQUEST':
        return {
          status: 'INFORMED',
          reply: msg.linkMessage(await this.links.shortUrl(userId)),
          intent: intent.intent,
        };
      case 'HUMAN_REVIEW':
        await this.openCase(
          userId,
          'STUDENT_REVIEW_REQUEST',
          'GENERAL',
          'O aluno pediu revisão humana pelo WhatsApp.',
          'HIGH',
        );
        return { status: 'ESCALATED', reply: msg.HUMAN_REVIEW_MESSAGE, intent: intent.intent };
      case 'GREETING':
        return {
          status: 'INFORMED',
          reply: msg.greetingMessage(PERSONAS[persona]),
          intent: intent.intent,
        };
      case 'OUT_OF_SCOPE':
        return { status: 'INFORMED', reply: msg.OUT_OF_SCOPE_MESSAGE, intent: intent.intent };
      case 'TRAINING_QUESTION':
      case 'NUTRITION_QUESTION':
      case 'FOOD_DIFFICULTY':
      case 'MOTIVATION':
        return this.answer(userId, text, intent, sources, persona);
    }
  }

  // --- Fluxos ---------------------------------------------------------------------------

  private async unavailability(
    userId: string,
    intent: ClassifyOutput,
    view: ReturnType<typeof parseStateView>,
    today: string,
    now: Date,
  ): Promise<HandleResult> {
    if (!intent.availableWeekdays || intent.availableWeekdays.length === 0) {
      return { status: 'ASKED', reply: msg.ASK_AVAILABLE_DAYS_MESSAGE, intent: intent.intent };
    }
    const weekStart = mondayOf(today);
    const windows = windowsFor(intent.availableWeekdays, view.availability?.windows ?? []);

    // 1) registra a exceção da semana (estado, AUTO)…
    const recorded = await this.executor.decideAndRun(
      userId,
      'conversation.unavailability',
      proposalOf(
        {
          type: 'RECORD_CONSTRAINT',
          constraint: { kind: 'AVAILABILITY_OVERRIDE', weekStart, windows },
        },
        `O aluno informou que nesta semana só pode treinar ${msg.weekdayList(intent.availableWeekdays)}.`,
        'A agenda da semana respeita os dias informados.',
      ),
      (tx) =>
        this.commands.recordConstraint(
          tx,
          userId,
          {
            type: 'RECORD_CONSTRAINT',
            constraint: { kind: 'AVAILABILITY_OVERRIDE', weekStart, windows },
          },
          today,
        ),
    );
    if (recorded.verdict !== 'EXECUTE') return this.notExecuted(recorded, intent.intent);

    // 2) …e reorganiza o que resta da semana com a exceção valendo.
    const action = await this.schedule.proposeWeek(userId, now);
    if (!action)
      return { status: 'EXECUTED', reply: msg.NOTHING_TO_MOVE_MESSAGE, intent: intent.intent };
    const moved = await this.executor.decideAndRun(
      userId,
      'conversation.reschedule_week',
      proposalOf(
        action,
        'Reorganizar a semana nos dias disponíveis, sem empilhar o que foi perdido.',
        'Sessões-chave mantidas na semana.',
      ),
      (tx, decisionId) => this.commands.rescheduleWeek(tx, userId, action, decisionId),
    );
    if (moved.verdict !== 'EXECUTE') return this.notExecuted(moved, intent.intent);

    const titles = await this.titlesOf(
      userId,
      action.assignments.map((a) => a.planSessionKey),
    );
    return {
      status: 'EXECUTED',
      reply: msg.rescheduledMessage(
        action.assignments.map((a) => ({
          title: titles.get(a.planSessionKey) ?? a.planSessionKey,
          date: a.date,
        })),
        action.dropped.map((key) => titles.get(key) ?? key),
      ),
      intent: intent.intent,
    };
  }

  private async shortOnTime(
    userId: string,
    intent: ClassifyOutput,
    today: string,
  ): Promise<HandleResult> {
    const minutes = intent.minutesAvailable ?? 30;
    const [session] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({
          id: scheduledSessions.id,
          title: planSessions.title,
          minutes: planSessions.estimatedMinutes,
        })
        .from(scheduledSessions)
        .innerJoin(planSessions, eq(planSessions.id, scheduledSessions.planSessionId))
        .where(
          and(
            eq(scheduledSessions.userId, userId),
            eq(scheduledSessions.scheduledOn, today),
            eq(scheduledSessions.status, 'PLANNED'),
          ),
        )
        .orderBy(asc(scheduledSessions.createdAt))
        .limit(1),
    );
    if (!session)
      return { status: 'INFORMED', reply: msg.NO_SESSION_TODAY_MESSAGE, intent: intent.intent };
    if (shortenFactor(session.minutes, minutes) >= 0.95)
      return { status: 'INFORMED', reply: msg.ALREADY_FITS_MESSAGE, intent: intent.intent };

    // O motor de políticas limita a redução automática; pedir mais que isso viraria escalonamento
    // à toa, então a proposta já vem no máximo que a política permite.
    const limit = (await this.policies.autonomy())?.byAction.SHORTEN_SESSION?.limit ?? 0;
    const action = {
      type: 'SHORTEN_SESSION' as const,
      scheduledSessionId: session.id,
      targetMinutes: Math.max(10, minutes, Math.ceil(session.minutes * (1 - limit / 100))),
    };
    const factor = shortenFactor(session.minutes, action.targetMinutes);
    const outcome = await this.executor.decideAndRun(
      userId,
      'conversation.shorten_session',
      proposalOf(
        action,
        `O aluno só tem ${minutes} min hoje.`,
        'Sessão de hoje cabe no tempo, mantendo o essencial.',
      ),
      (tx, decisionId) => this.commands.shortenSession(tx, userId, action, factor, decisionId),
      { sessionPlannedMinutes: session.minutes },
    );
    if (outcome.verdict !== 'EXECUTE') return this.notExecuted(outcome, intent.intent);
    return {
      status: 'EXECUTED',
      reply: msg.shortenedMessage(
        session.title,
        action.targetMinutes,
        await this.links.shortUrl(userId),
        minutes,
      ),
      intent: intent.intent,
    };
  }

  private async exerciseSwap(
    userId: string,
    text: string,
    intent: ClassifyOutput,
    view: ReturnType<typeof parseStateView>,
    today: string,
    now: Date,
  ): Promise<HandleResult> {
    const sessions = await this.upcomingStrength(userId, today);
    const mention = fold(intent.exerciseMention ?? '');
    const tokens = mention.split(/\s+/).filter((t) => t.length >= 3);
    const hit = sessions.find((s) => {
      const name = fold(s.name);
      return tokens.length > 0 && tokens.every((t) => name.includes(t));
    });
    if (!hit) return { status: 'ASKED', reply: msg.SWAP_NOT_FOUND_MESSAGE, intent: intent.intent };

    const target = this.catalog.getById(hit.exerciseId);
    if (!target)
      return { status: 'ASKED', reply: msg.SWAP_NOT_FOUND_MESSAGE, intent: intent.intent };
    const profile = catalogProfileOf(view);
    const lacking = fold(text);
    const candidates = rankEquivalents(
      target,
      {
        level: profile.level,
        location: profile.location,
        equipment: [],
        injuryTags: [...contraindicationsOf(view)],
      },
      this.catalog.getAll(),
      { disliked: exercisePreference(view, 'DISLIKES'), liked: exercisePreference(view, 'LIKES') },
    )
      // "não tenho barra": tira o que usa o equipamento citado.
      .filter(
        (c) =>
          !(
            intent.swapReason === 'EQUIPMENT' && c.equipment.some((e) => lacking.includes(fold(e)))
          ),
      )
      .slice(0, 8);

    const reason = intent.swapReason ?? 'OTHER';
    if (candidates.length === 0) {
      // Sem equivalente seguro no catálogo: caso obrigatório na Fila do Profissional, onde a
      // equipe escolhe um exercício ou adiciona um novo ao catálogo e libera a troca.
      await this.openCase(
        userId,
        'PROTOCOL_REVIEW',
        'TRAINING',
        `Sem equivalente seguro no catálogo para ${target.name} (${reason}). Escolha um exercício ou adicione um novo ao catálogo.`,
        'HIGH',
        {
          source: 'SWAP_GAP',
          planSessionKey: hit.planSessionKey,
          fromExerciseId: target.id,
          reason,
        },
        true,
      );
      return { status: 'ESCALATED', reply: msg.SWAP_NO_EQUIVALENT_MESSAGE, intent: intent.intent };
    }
    const chosen = await this.runner.run(
      substituteTask,
      {
        fromExerciseId: target.id,
        fromName: target.name,
        reason,
        candidates: candidates.map((c) => ({ id: c.id, name: c.name, equipment: c.equipment })),
      },
      { userId, sources: this.sources(userId, now) },
    );
    const to = this.catalog.getById(chosen.output.toExerciseId);
    if (!to) return { status: 'ASKED', reply: msg.SWAP_NOT_FOUND_MESSAGE, intent: intent.intent };

    const pending: PendingSwap = {
      planSessionKey: hit.planSessionKey,
      fromExerciseId: target.id,
      fromName: target.name,
      toExerciseId: to.id,
      toName: to.name,
      reason,
      why: chosen.output.why,
    };
    // O aluno já disse o alcance ("só hoje", "no protocolo")? Senão pergunta, como sempre.
    const stated = swapScopeOf(text);
    if (stated) return this.applySwap(userId, pending, stated, intent.intent, today);
    await this.redis.set(
      this.pendingSwapKey(userId),
      JSON.stringify(pending),
      'EX',
      PENDING_SWAP_TTL_SECONDS,
    );
    return {
      status: 'ASKED',
      reply: msg.swapScopeQuestion(target.name, to.name),
      intent: intent.intent,
    };
  }

  private pendingSwapKey(userId: string): string {
    return this.keys.forUser(userId, 'conversation', 'swap-pending');
  }

  /** A mensagem responde à pergunta de alcance? Então aplica; se não, segue o fluxo normal. */
  private async swapScopeAnswer(
    userId: string,
    text: string,
    today: string,
  ): Promise<HandleResult | null> {
    const raw = await this.redis.get(this.pendingSwapKey(userId));
    if (!raw) return null;
    const pending = JSON.parse(raw) as PendingSwap;
    if (declinesSwap(text)) {
      await this.redis.del(this.pendingSwapKey(userId));
      return { status: 'INFORMED', reply: msg.SWAP_DECLINED_MESSAGE, intent: 'EXERCISE_SWAP' };
    }
    const scope = swapScopeOf(text, true);
    if (!scope) return null;
    await this.redis.del(this.pendingSwapKey(userId));
    return this.applySwap(userId, pending, scope, 'EXERCISE_SWAP', today);
  }

  /**
   * Troca só de hoje (pouco tempo, aparelho cheio ou em manutenção): nada muda no protocolo, o
   * aluno só é orientado a fazer a troca na sessão. Troca no protocolo: passa pela Fila do
   * Profissional (revisão opcional liberada em minutos; obrigatória para PAR-Q de risco) e o
   * protocolo atualizado vai ao aluno quando a troca é liberada.
   */
  private async applySwap(
    userId: string,
    pending: PendingSwap,
    scope: SwapScope,
    intent: string,
    today: string,
  ): Promise<HandleResult> {
    if (scope === 'NEXT_SESSION') {
      return {
        status: 'INFORMED',
        reply: msg.swapTodayMessage(pending.fromName, pending.toName, pending.why),
        intent,
      };
    }
    const action = {
      type: 'SUBSTITUTE_EXERCISE' as const,
      planSessionKey: pending.planSessionKey,
      fromExerciseId: pending.fromExerciseId,
      toExerciseId: pending.toExerciseId,
      reason: pending.reason,
      scope: 'PLAN' as const,
    };
    const outcome = await this.executor.decideAndRun(
      userId,
      'strength.choose_substitute',
      proposalOf(
        action,
        pending.why,
        'O aluno executa a sessão sem o exercício que não pode fazer.',
      ),
      (tx, decisionId) => this.commands.substituteExercise(tx, userId, action, decisionId, today),
    );
    if (outcome.verdict === 'EXECUTE') {
      return {
        status: 'EXECUTED',
        reply: msg.swappedMessage(pending.fromName, pending.toName, 'PLAN', pending.why),
        intent,
      };
    }
    if (outcome.verdict === 'BLOCK') return this.notExecuted(outcome, intent);
    return {
      status: 'ESCALATED',
      reply:
        outcome.verdict === 'ASK'
          ? msg.swapQueuedMessage(pending.fromName, pending.toName)
          : msg.swapPendingReviewMessage(pending.fromName, pending.toName),
      intent,
    };
  }

  /**
   * Sugestão de refeição dentro do planejamento: o aluno pede uma opção que o cardápio não
   * trouxe. O agente escolhe alimentos da lista permitida; o código ajusta as porções à meta da
   * refeição, calcula os nutrientes e o custo. É só orientação: o plano não muda.
   */
  private async mealSuggestion(
    userId: string,
    text: string,
    intent: ClassifyOutput,
    view: ReturnType<typeof parseStateView>,
    identity: unknown,
    sources: AgentContextSources,
    now: Date,
    timezone: string | null,
  ): Promise<HandleResult> {
    const [plan] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({ structure: nutritionPlans.structure })
        .from(nutritionPlans)
        .where(and(eq(nutritionPlans.userId, userId), eq(nutritionPlans.status, 'ACTIVE'))),
    );
    if (!plan) {
      return { status: 'INFORMED', reply: msg.NO_NUTRITION_PLAN_MESSAGE, intent: intent.intent };
    }
    const structure = plan.structure;
    // Sem refeição na mensagem, vale a que está na hora (café, almoço, lanche, jantar).
    const slot =
      intent.mealSlot ??
      mealByClock(
        structure.meals.map((m) => m.slot),
        now,
        timezone,
      );
    const meal = structure.meals.find((m) => m.slot === slot);
    if (!meal) {
      return {
        status: 'ASKED',
        reply: msg.askMealMessage(structure.meals.map((m) => MEAL_SLOT_LABELS[m.slot])),
        intent: intent.intent,
      };
    }
    // O alimento que o aluno não tem ou não quer hoje sai da lista antes de o agente escolher.
    const avoid = tokensOf(intent.mealAvoid);
    const allowed = (await this.foodCandidates.forStudent(userId, view.dietaryRestrictions)).filter(
      (food) => !avoid.some((token) => fold(food.name).includes(token)),
    );
    if (allowed.length === 0) {
      return {
        status: 'INFORMED',
        reply: msg.MEAL_SUGGESTION_FAILED_MESSAGE,
        intent: intent.intent,
      };
    }
    const target = mealTarget(meal, structure);
    const budget = (
      identity as { lifeContext?: { foodBudgetMonthlyBrl?: number | null } } | undefined
    )?.lifeContext?.foodBudgetMonthlyBrl;
    const input = {
      message: text,
      meal: {
        slot: meal.slot,
        targetKcal: Math.round(target.energyKcal),
        targetProteinG: meal.proteinG,
        maxCostBrl:
          typeof budget === 'number'
            ? Math.round((budget / 30) * meal.energyShare * 100) / 100
            : null,
      },
      plannedOptions: (meal.options ?? []).map((o) => o.title),
      dietaryRestrictions: view.dietaryRestrictions,
      foods: allowed,
      count: 1,
    };
    try {
      const run = await this.runner.run(mealSuggestionTask, input, { userId, sources });
      const foods = new Map(allowed.map((food) => [food.id, food]));
      const options = run.output.suggestions.map((suggestion, index) => {
        const built = buildOption(
          suggestion,
          { energyKcal: input.meal.targetKcal, proteinG: input.meal.targetProteinG },
          foods,
          `suggestions.${index}`,
        ).option;
        return {
          title: built.title,
          items: built.items.map((item) => `${quantityLabel(item)} de ${item.name}`),
          totals: built.totals,
          costBrl: built.estimatedCostBrl,
        };
      });
      return {
        status: 'ANSWERED',
        reply: msg.mealSuggestionMessage(MEAL_SLOT_LABELS[meal.slot], options),
        intent: intent.intent,
      };
    } catch (error) {
      if (!(error instanceof AgentTaskError)) throw error;
      this.logger.warn({ userId, taskId: error.taskId }, 'sugestão de refeição sem saída válida');
      return {
        status: 'INFORMED',
        reply: msg.MEAL_SUGGESTION_FAILED_MESSAGE,
        intent: intent.intent,
      };
    }
  }

  private async answer(
    userId: string,
    text: string,
    intent: ClassifyOutput,
    sources: AgentContextSources,
    persona: PersonaKey,
  ): Promise<HandleResult> {
    const topic: 'TRAINING' | 'NUTRITION' | 'MOTIVATION' =
      intent.intent === 'TRAINING_QUESTION'
        ? 'TRAINING'
        : intent.intent === 'NUTRITION_QUESTION' || intent.intent === 'FOOD_DIFFICULTY'
          ? 'NUTRITION'
          : 'MOTIVATION';
    // Guardrail L1 de entrada: pergunta que cai numa regra dos profissionais nem chega ao modelo.
    const inputFlags = await this.guardrails.evaluate(text, '');
    // Evidência dos artigos curados (RAG) para dúvida de treino, de nutrição e também de motivação
    // e constância (hábitos, retomada de rotina). Pergunta retida pelos guardrails nem chega a
    // gastar a busca, e conversa sem assunto (cumprimento) não passa por aqui.
    // Em motivação a mensagem é coloquial ("parei de treinar, tô sem vontade") e não usa as palavras
    // dos artigos de hábitos: um contexto fixo de assunto, só no vetor, traz a evidência certa.
    const evidence =
      inputFlags.length > 0
        ? []
        : ((await this.retrieval?.evidenceFor(
            text,
            topic === 'MOTIVATION' ? { hint: 'MOTIVATION' } : {},
          )) ?? []);
    const run = inputFlags.length
      ? null
      : await this.runner.run(
          answerTask,
          { message: text, topic, ...(evidence.length > 0 ? { evidence } : {}) },
          { userId, sources, persona },
        );
    const outputFlags = run ? await this.guardrails.evaluate('', run.output.reply) : [];
    if (!run || outputFlags.length > 0) {
      await this.openCase(
        userId,
        'NO_APPLICABLE_POLICY',
        topic === 'NUTRITION' ? 'NUTRITION' : 'TRAINING',
        `Resposta retida por regra de segurança dos profissionais (${[...inputFlags, ...outputFlags].map((f) => f.label).join(', ')}).`,
        'NORMAL',
      );
      return { status: 'ESCALATED', reply: msg.ESCALATED_MESSAGE, intent: intent.intent };
    }
    if (run.output.needsProfessional) {
      await this.openCase(
        userId,
        'NO_APPLICABLE_POLICY',
        topic === 'NUTRITION' ? 'NUTRITION' : 'TRAINING',
        'Pergunta que exige profissional (medicamento, diagnóstico ou condição clínica).',
        'NORMAL',
      );
      return { status: 'ESCALATED', reply: run.output.reply, intent: intent.intent };
    }
    return { status: 'ANSWERED', reply: run.output.reply, intent: intent.intent };
  }

  /** Tema proibido e FAQ: regras determinísticas que os profissionais publicam no painel. */
  private async governance(userId: string, text: string): Promise<HandleResult | null> {
    try {
      const hit = await this.forbiddenTopics.evaluate(text);
      if (hit) {
        await this.openCase(
          userId,
          'NO_APPLICABLE_POLICY',
          'GENERAL',
          `Mensagem sobre tema marcado como fora do atendimento automático (${hit.label}).`,
          'NORMAL',
        );
        return { status: 'ESCALATED', reply: msg.FORBIDDEN_TOPIC_MESSAGE };
      }
    } catch (err: unknown) {
      if (!(err instanceof ForbiddenTopicsUnavailableError)) throw err;
      // Sem a lista de temas não dá para garantir o limite: resposta segura, sem gerar nada.
      return { status: 'ESCALATED', reply: msg.FALLBACK_MESSAGE };
    }
    const faq = await this.faq.match(text);
    return faq ? { status: 'ANSWERED', reply: faq.answer, intent: 'FAQ' } : null;
  }

  // --- Apoio ------------------------------------------------------------------------------

  private sources(userId: string, now: Date): AgentContextSources {
    return {
      methodology: (domains) => this.methodology.render(domains),
      state: (slices) => this.state.read(userId, slices, now),
    };
  }

  /** Regras sempre; o detector de texto só acrescenta (e a falha dele nunca derruba o fluxo). */
  private async detectSignals(
    userId: string,
    text: string,
    sources: AgentContextSources,
  ): Promise<{ kind: SafetySignalKind; evidence: string; source: 'RULE' | 'DETECTOR' }[]> {
    const found = new Map<
      SafetySignalKind,
      { kind: SafetySignalKind; evidence: string; source: 'RULE' | 'DETECTOR' }
    >();
    for (const s of textSignals(text)) found.set(s.kind, { ...s, source: 'RULE' });
    try {
      const run = await this.runner.run(riskTask, { message: text }, { userId, sources });
      for (const s of run.output.signals) {
        if (!found.has(s.kind)) found.set(s.kind, { ...s, source: 'DETECTOR' });
      }
    } catch (err: unknown) {
      this.logger.warn(
        { userId, err, event: 'risk_detector_failed' },
        'detector de risco indisponível; seguem as regras',
      );
    }
    return [...found.values()];
  }

  private async raiseSignals(
    userId: string,
    signals: { kind: SafetySignalKind; evidence: string; source: 'RULE' | 'DETECTOR' }[],
  ): Promise<SafetySignal[]> {
    const params = await this.policies.sentinel();
    const built = signals.map((s) => signalOf(s.kind, s.evidence, params));
    for (const source of ['RULE', 'DETECTOR'] as const) {
      const subset = signals
        .map((s, i) => ({ s, signal: built[i] as SafetySignal }))
        .filter((x) => x.s.source === source);
      if (subset.length > 0) {
        await this.safety.raise(
          userId,
          subset.map((x) => x.signal),
          source,
        );
      }
    }
    return built;
  }

  private notExecuted(outcome: DecisionOutcome, intent: string): HandleResult {
    if (outcome.verdict === 'BLOCK')
      return { status: 'ESCALATED', reply: msg.EMERGENCY_MESSAGE, intent };
    return { status: 'ESCALATED', reply: msg.ESCALATED_MESSAGE, intent };
  }

  private async openCase(
    userId: string,
    kind: 'STUDENT_REVIEW_REQUEST' | 'NO_APPLICABLE_POLICY' | 'PROTOCOL_REVIEW',
    domain: 'TRAINING' | 'NUTRITION' | 'GENERAL',
    summary: string,
    priority: 'NORMAL' | 'HIGH',
    subject: Record<string, string> = { source: 'WHATSAPP' },
    mandatoryReview = false,
  ): Promise<void> {
    await this.db.runAsSystem((tx) =>
      this.pipeline.openCase(tx, {
        userId,
        kind,
        domain,
        summary,
        subject,
        priority,
        mandatoryReview,
      }),
    );
    await this.outbox.flushSoon();
  }

  private async titlesOf(userId: string, keys: string[]): Promise<Map<string, string>> {
    if (keys.length === 0) return new Map();
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .selectDistinct({ key: planSessions.key, title: planSessions.title })
        .from(planSessions)
        .where(and(eq(planSessions.userId, userId), inArray(planSessions.key, keys))),
    );
    return new Map(rows.map((r) => [r.key, r.title]));
  }

  /** Exercícios de força das próximas ocorrências planejadas (semana corrente em diante). */
  private async upcomingStrength(userId: string, today: string) {
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({
          key: planSessions.key,
          content: planSessions.content,
          on: scheduledSessions.scheduledOn,
        })
        .from(scheduledSessions)
        .innerJoin(planSessions, eq(planSessions.id, scheduledSessions.planSessionId))
        .where(
          and(
            eq(scheduledSessions.userId, userId),
            eq(scheduledSessions.status, 'PLANNED'),
            gte(scheduledSessions.scheduledOn, today),
            gte(scheduledSessions.weekStart, addDays(mondayOf(today), 0)),
          ),
        )
        .orderBy(asc(scheduledSessions.scheduledOn)),
    );
    return rows.flatMap((row) =>
      row.content.modality === 'STRENGTH'
        ? row.content.exercises.map((e) => ({
            planSessionKey: row.key,
            exerciseId: e.exerciseId,
            name: e.name,
          }))
        : [],
    );
  }
}
