/**
 * Revisão semanal do progresso: o código mede, o modelo interpreta como hipótese, o motor de
 * políticas decide o que vira ação.
 *
 *   semanas fechadas → sinais (sem modelo) → [sem sinais: ON_TRACK, sem custo]
 *                    → modelo explica (hipóteses) e propõe ≤ 2 ações autorizadas pelos sinais
 *                    → cada ação: proposta → política → execução na mesma transação.
 */
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import type {
  CoachingProposal,
  DeclaredGoalKind,
  ReviewSignal,
  WeeklyReviewRecord,
} from '@movivo/shared';

import type { AgentContextSources } from '../../core/agents/agent-context';
import { AgentRunner } from '../../core/agents/agent-runner';
import { nutritionPlans, weeklyReviews } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { DecisionExecutor } from '../coaching/decision/decision-executor.service';
import { ConversationStore } from '../conversation/conversation-store';
import { DomainCommands } from '../conversation/domain-commands.service';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { addDays, mondayOf } from '../planning/calc/week-planner';
import { todayIn } from '../planning/plan-generation.service';
import { PublishedPolicies } from '../coaching/policy/published-policies';
import { StudentStateReader } from '../student-state/student-state.reader';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import type { WhatsappOutboundJob } from '../jobs/whatsapp-outbound.contract';
import { collectWeeks } from './review-data';
import {
  allowedActions,
  computeSignals,
  energyDeltaBounds,
  type GoalDirection,
  MIN_VOLUME_STEP,
} from './review-signals';
import { reviewTask, type ReviewOutput } from './tasks';

const HISTORY_WEEKS = 6;

export type ReviewResult =
  | { status: 'SKIPPED'; reason: 'ALREADY_REVIEWED' | 'NO_ACTIVITY' }
  | {
      status: 'REVIEWED';
      weekStart: string;
      reviewStatus: WeeklyReviewRecord['status'];
      signals: number;
      modelUsed: boolean;
      proposals: number;
      executed: number;
    };

const GOAL_DIRECTION: Partial<Record<DeclaredGoalKind, GoalDirection>> = {
  FAT_LOSS: 'LOSE',
  BODY_DEFINITION: 'LOSE',
  HYPERTROPHY: 'GAIN',
};

@Injectable()
export class WeeklyReviewService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly runner: AgentRunner,
    private readonly state: StudentStateReader,
    private readonly methodology: PublishedMethodologyReader,
    private readonly executor: DecisionExecutor,
    private readonly policies: PublishedPolicies,
    private readonly commands: DomainCommands,
    private readonly store: ConversationStore,
    private readonly queues: QueueManager,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WeeklyReviewService.name);
  }

  /** Revisa a semana que acabou de fechar (ou `options.weekStart`). Idempotente por semana. */
  async review(
    userId: string,
    options: { now?: Date; weekStart?: string } = {},
  ): Promise<ReviewResult> {
    const now = options.now ?? new Date();
    const stateRead = await this.state.read(userId, ['identity', 'goals'], now);
    const timezone = (stateRead.slices.identity as { timezone?: string | null } | null)?.timezone;
    const today = todayIn(timezone ?? null, now);
    const weekStart = options.weekStart ?? addDays(mondayOf(today), -7);

    const { weeks, hasNutritionPlan, already } = await this.db.runAsUser(
      userId,
      'USER',
      async (tx) => {
        const [existing] = await tx
          .select({ id: weeklyReviews.id })
          .from(weeklyReviews)
          .where(and(eq(weeklyReviews.userId, userId), eq(weeklyReviews.weekStart, weekStart)));
        const [plan] = await tx
          .select({ id: nutritionPlans.id })
          .from(nutritionPlans)
          .where(and(eq(nutritionPlans.userId, userId), eq(nutritionPlans.status, 'ACTIVE')));
        return {
          already: existing !== undefined,
          hasNutritionPlan: plan !== undefined,
          weeks: await collectWeeks(tx, userId, weekStart, HISTORY_WEEKS),
        };
      },
    );
    if (already) return { status: 'SKIPPED', reason: 'ALREADY_REVIEWED' };
    if (weeks.slice(-2).every((w) => w.planned === 0 && w.load === 0)) {
      return { status: 'SKIPPED', reason: 'NO_ACTIVITY' };
    }

    const declared = (
      stateRead.slices.goals as { declared?: { primary?: DeclaredGoalKind } } | null
    )?.declared;
    const goal = (declared?.primary && GOAL_DIRECTION[declared.primary]) || 'NONE';
    const signals = computeSignals(weeks, { goal, hasNutritionPlan });

    let output: ReviewOutput;
    let modelRunId: string | null = null;
    if (signals.length === 0) {
      output = {
        status: 'ON_TRACK',
        summary: 'Semana dentro do esperado: nenhum sinal de atenção nos números.',
        hypotheses: [],
        interventions: [],
      };
    } else {
      const run = await this.runner.run(
        reviewTask,
        {
          weekStart,
          goal: { direction: goal, primary: declared?.primary ?? null },
          modalities: await this.modalitiesOf(userId, now),
          weeks,
          signals,
          allowed: allowedActions(signals),
          energyBounds: energyDeltaBounds(goal),
          volumeBounds: { min: -(await this.volumeLimit()), max: MIN_VOLUME_STEP },
        },
        { userId, sources: this.sources(userId, now) },
      );
      output = run.output;
      modelRunId = run.modelRunIds[0] ?? null;
    }

    const record: WeeklyReviewRecord = {
      status: output.status,
      summary: output.summary,
      // Hipótese entra como hipótese e assim fica: só confirmação humana muda isso.
      hypotheses: output.hypotheses.map((h) => ({ ...h, status: 'HYPOTHESIS' as const })),
      interventions: output.interventions.map((item) => ({
        actionType: item.action.type,
        rationale: item.rationale,
      })),
    };
    const [saved] = await this.db.runAsSystem((tx) =>
      tx
        .insert(weeklyReviews)
        .values({
          userId,
          weekStart,
          status: record.status,
          metrics: weeks,
          signals,
          record,
          modelRunId,
        })
        .onConflictDoNothing()
        .returning({ id: weeklyReviews.id }),
    );
    // Outra execução ganhou a corrida: a revisão e as ações já são dela.
    if (!saved) return { status: 'SKIPPED', reason: 'ALREADY_REVIEWED' };

    const outcome = await this.applyInterventions(userId, output, signals, today, modelRunId);
    await this.db.runAsSystem((tx) =>
      tx
        .update(weeklyReviews)
        .set({ proposalIds: outcome.proposalIds })
        .where(eq(weeklyReviews.id, saved.id)),
    );
    this.logger.info(
      {
        event: 'weekly_review_done',
        userId,
        weekStart,
        status: record.status,
        signals: signals.length,
      },
      'revisão semanal registrada',
    );
    return {
      status: 'REVIEWED',
      weekStart,
      reviewStatus: record.status,
      signals: signals.length,
      modelUsed: signals.length > 0,
      proposals: outcome.proposalIds.length,
      executed: outcome.executed,
    };
  }

  private async applyInterventions(
    userId: string,
    output: ReviewOutput,
    signals: readonly ReviewSignal[],
    today: string,
    modelRunId: string | null,
  ): Promise<{ proposalIds: string[]; executed: number }> {
    const proposalIds: string[] = [];
    let executed = 0;
    for (const item of output.interventions) {
      const { action } = item;
      const hypotheses = output.hypotheses
        .filter((h) => h.basedOn.some((key) => item.basedOn.includes(key)))
        .map((h) => h.text.slice(0, 200));
      const proposal: CoachingProposal = {
        action,
        rationale: [item.rationale],
        evidence: item.basedOn.filter((key) => signals.some((s) => s.key === key)),
        assumptions: hypotheses.slice(0, 5),
        uncertainty: item.uncertainty,
        expectedOutcome: item.expectedOutcome,
      };
      const outcome = await this.executor.decideAndRun(
        userId,
        reviewTask.id,
        proposal,
        async (tx, decisionId) => {
          switch (action.type) {
            case 'ADJUST_WEEKLY_VOLUME':
              return this.commands.adjustWeeklyVolume(tx, userId, action, decisionId, today);
            case 'ADJUST_ENERGY_TARGET':
              return this.commands.adjustEnergyTarget(tx, userId, action);
            case 'ASK_STUDENT':
              return {
                command: 'communication.ask_student',
                result: { text: questionText(action.question, action.options) },
              };
            case 'SEND_MESSAGE':
              return { command: 'communication.send_message', result: { text: action.text } };
          }
        },
        { modelRunId },
      );
      proposalIds.push(outcome.proposalId);
      if (outcome.verdict !== 'EXECUTE' || !outcome.execution) continue;
      executed += 1;
      const text = outcome.execution.result.text;
      if (typeof text === 'string') await this.sendToStudent(userId, text, outcome.decisionId);
    }
    return { proposalIds, executed };
  }

  private async sendToStudent(userId: string, text: string, decisionId: string): Promise<void> {
    await this.store.persistTurn({
      userId,
      direction: 'OUTBOUND',
      content: text,
      validationPassed: true,
    });
    const job: WhatsappOutboundJob = {
      userId,
      type: 'COACH_MESSAGE',
      text,
      dedupeId: `review_${decisionId}`,
    };
    await this.queues.enqueue(QUEUE.whatsappOutbound, 'coach-message', job, {
      jobId: `coach-message_review_${decisionId}`,
    });
  }

  /** Maior redução de volume que a política publicada deixa o sistema fazer sozinho (%). */
  private async volumeLimit(): Promise<number> {
    const policy = await this.policies.autonomy();
    return Math.max(MIN_VOLUME_STEP * -1, policy?.byAction.ADJUST_WEEKLY_VOLUME?.limit ?? 15);
  }

  private async modalitiesOf(userId: string, now: Date) {
    const read = await this.state.read(userId, ['training'], now);
    const training = read.slices.training as { modalities?: { modality: string }[] } | null;
    const known = new Set(['STRENGTH', 'RUNNING', 'HYROX']);
    return (training?.modalities ?? [])
      .map((m) => m.modality)
      .filter((m): m is 'STRENGTH' | 'RUNNING' | 'HYROX' => known.has(m));
  }

  private sources(userId: string, now: Date): AgentContextSources {
    return {
      methodology: (domains) => this.methodology.render(domains),
      state: (slices) => this.state.read(userId, slices, now),
    };
  }
}

function questionText(question: string, options?: readonly string[]): string {
  return options && options.length > 0 ? `${question} (${options.join(' / ')})` : question;
}
