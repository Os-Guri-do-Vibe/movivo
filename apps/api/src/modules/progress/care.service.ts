/**
 * Cuidado diário do acompanhamento premium, três rotinas por aluno no relógio local dele:
 *
 *  · 11:00 `daily`: a escada de silêncio (se o aluno some, a MOVIVO sobe um degrau por vez) e,
 *    se ele está ativo, o lembrete do meio da semana do passo combinado;
 *  · 21:00 `nightly`: o estudo da noite, em que os especialistas leem o dia inteiro dele (check-in,
 *    relatos do chat, treino, comida, peso);
 *  · 23:50 `closeDigest`: fecha o estudo do dia, só código.
 *
 * No máximo um contato proativo por dia (porteiro compartilhado com os demais fluxos).
 */
import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, max } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { personaOf } from '@movivo/shared';

import type { AgentContextSources } from '../../core/agents/agent-context';
import { AgentRunner, AgentTaskError } from '../../core/agents/agent-runner';
import {
  bodyMeasurements,
  checkIns,
  conversations,
  dailyCheckIns,
  foodLogs,
  sessionExecutions,
  studentReports,
  trainingPlans,
} from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import { DecisionPipeline } from '../coaching/decision/decision-pipeline.service';
import { ConversationStore } from '../conversation/conversation-store';
import { OutboxRelay } from '../domain-events/outbox-relay';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { addDays } from '../planning/calc/week-planner';
import { todayIn } from '../planning/plan-generation.service';
import { CommitmentService } from '../student-state/commitment.service';
import { OutreachService } from '../student-state/outreach.service';
import { StudentStateReader } from '../student-state/student-state.reader';
import { AgentMessenger } from './agent-messenger';
import { DayDigestService } from './day-digest.service';
import {
  commitmentNudgeTask,
  reengagementMessageTask,
  reengagementPlanTask,
  type ReengagementPlanInput,
} from './reengagement-tasks';
import {
  daysBetween,
  levelToSend,
  stepOf,
  TEAM_ALERT_FROM_LEVEL,
  type SilenceStep,
} from './silence';
import { SpecialistDailyService } from './specialist-daily.service';

type SignalKind = NonNullable<ReengagementPlanInput['lastSignal']>;

export type CareResult =
  | { status: 'SKIPPED'; reason: string }
  | { status: 'SILENCE_SENT'; level: SilenceStep['level']; strategy: string }
  | { status: 'NUDGE_SENT' }
  | { status: 'NOTHING_TO_DO' };

@Injectable()
export class CareService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly runner: AgentRunner,
    private readonly state: StudentStateReader,
    private readonly methodology: PublishedMethodologyReader,
    private readonly store: ConversationStore,
    private readonly messenger: AgentMessenger,
    private readonly pipeline: DecisionPipeline,
    private readonly outbox: OutboxRelay,
    private readonly outreach: OutreachService,
    private readonly commitments: CommitmentService,
    private readonly digests: DayDigestService,
    private readonly specialistDaily: SpecialistDailyService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(CareService.name);
  }

  // --- 11:00: silêncio e lembrete do combinado -------------------------------------------------

  async daily(userId: string, now: Date = new Date()): Promise<CareResult> {
    const { firstName, timezone } = await this.store.loadUser(userId);
    const today = todayIn(timezone, now);
    const facts = await this.db.runAsUser(userId, 'USER', (tx) =>
      this.silenceFacts(tx, userId, today, timezone),
    );
    if (!facts) return { status: 'SKIPPED', reason: 'NO_PLAN' };

    const recent = await this.outreach.recent(userId, 12);
    const level = levelToSend({
      daysSilent: facts.daysSilent,
      lastSignalAt: facts.reference,
      outreaches: recent
        .filter((o) => o.kind === 'SILENCE')
        .map((o) => ({ level: o.level, sentAt: new Date(o.sentAt) })),
      now,
    });
    if (level !== null) {
      return this.sendSilence(userId, firstName, today, level, facts, recent, now);
    }
    // Aluno ativo: o combinado da semana ganha um lembrete no meio do caminho.
    if (facts.daysSilent < stepOf(1).minDays) {
      return this.nudge(userId, firstName, today, now);
    }
    return { status: 'NOTHING_TO_DO' };
  }

  private async sendSilence(
    userId: string,
    firstName: string | null,
    today: string,
    level: SilenceStep['level'],
    facts: NonNullable<Awaited<ReturnType<CareService['silenceFacts']>>>,
    recent: Awaited<ReturnType<OutreachService['recent']>>,
    now: Date,
  ): Promise<CareResult> {
    if (!(await this.outreach.tryAcquireToday(userId, today))) {
      return { status: 'SKIPPED', reason: 'OTHER_CONTACT_TODAY' };
    }
    try {
      const sources = this.sources(userId, now);
      const step = stepOf(level);
      const read = await this.state.read(userId, ['identity'], now);
      const sex = (read.slices.identity as { biologicalSex?: string | null } | undefined)
        ?.biologicalSex;

      let plan;
      try {
        plan = (
          await this.runner.run(
            reengagementPlanTask,
            {
              level,
              daysSilent: Math.max(1, Math.min(365, facts.daysSilent)),
              allowedStrategies: [...step.strategies],
              lastSignal: facts.lastSignalKind,
              trainedLast14: facts.trainedLast14,
              plannedPerWeek: facts.plannedPerWeek,
              hasNutritionPlan: facts.hasNutritionPlan,
              daysWithoutMealLog: facts.daysWithoutMealLog,
              daysSinceWeight: facts.daysSinceWeight,
              previousOutreach: recent
                .filter((o) => o.kind === 'SILENCE')
                .slice(0, 5)
                .map((o) => ({
                  level: o.level,
                  strategy: o.strategy,
                  respondedAfterHours: o.respondedAfterHours,
                })),
            },
            { userId, sources },
          )
        ).output;
      } catch (error) {
        if (!(error instanceof AgentTaskError)) throw error;
        await this.outreach.release(userId, today);
        return { status: 'SKIPPED', reason: 'NO_VALID_PLAN' };
      }

      let messages: string[];
      try {
        messages = (
          await this.runner.run(
            reengagementMessageTask,
            { firstName, level, daysSilent: facts.daysSilent, plan },
            { userId, sources, persona: personaOf(sex) },
          )
        ).output.messages;
      } catch (error) {
        if (!(error instanceof AgentTaskError)) throw error;
        await this.outreach.release(userId, today);
        return { status: 'SKIPPED', reason: 'NO_VALID_MESSAGE' };
      }

      await this.messenger.send(userId, messages, `silence_${level}_${today}`);
      await this.outreach.record(userId, 'SILENCE', { level, strategy: plan.strategy });
      if (plan.strategy === 'MINIMUM_VERSION' && plan.minimumWeek) {
        const { sessionsPerWeek, minutesPerSession } = plan.minimumWeek;
        await this.commitments.record(
          userId,
          'HABITS',
          `Semana mínima combinada: ${sessionsPerWeek} treino(s) de ${minutesPerSession} min nesta semana para recomeçar.`,
          today,
        );
      }
      if (level >= TEAM_ALERT_FROM_LEVEL) {
        // Auditoria humana: a equipe vê, os agentes continuam conduzindo.
        await this.db.runAsSystem((tx) =>
          this.pipeline.openCase(tx, {
            userId,
            kind: 'NO_APPLICABLE_POLICY',
            domain: 'GENERAL',
            summary: `Aluno sem nenhum sinal há ${facts.daysSilent} dias (degrau ${level} da escada de silêncio). Abordagem dos agentes: ${plan.strategy}. ${plan.rationale}`,
            subject: { source: 'SILENCE_LADDER', date: today, level: String(level) },
            priority: level >= 4 ? 'HIGH' : 'NORMAL',
          }),
        );
        await this.outbox.flushSoon();
      }
      await this.digests
        .appendAction(userId, today, {
          by: 'HABITS',
          type: 'SILENCE_OUTREACH',
          detail: `degrau ${level}, ${plan.strategy}`,
        })
        .catch(() => undefined);
      this.logger.info(
        { event: 'silence_outreach', userId, level, strategy: plan.strategy },
        'escada de silêncio: contato enviado',
      );
      return { status: 'SILENCE_SENT', level, strategy: plan.strategy };
    } catch (error) {
      await this.outreach.release(userId, today);
      throw error;
    }
  }

  private async nudge(
    userId: string,
    firstName: string | null,
    today: string,
    now: Date,
  ): Promise<CareResult> {
    const [due] = await this.commitments.dueForNudge(userId, today);
    if (!due) return { status: 'NOTHING_TO_DO' };
    if (!(await this.outreach.tryAcquireToday(userId, today))) {
      return { status: 'SKIPPED', reason: 'OTHER_CONTACT_TODAY' };
    }
    try {
      const progress = await this.db.runAsUser(userId, 'USER', (tx) =>
        this.progressSince(tx, userId, due.createdOn),
      );
      const read = await this.state.read(userId, ['identity'], now);
      const sex = (read.slices.identity as { biologicalSex?: string | null } | undefined)
        ?.biologicalSex;
      let messages: string[];
      try {
        messages = (
          await this.runner.run(
            commitmentNudgeTask,
            {
              firstName,
              commitment: {
                source: due.source,
                text: due.text,
                daysOpen: daysBetween(due.createdOn, today),
                daysLeft: daysBetween(today, due.dueOn),
              },
              progress,
            },
            { userId, sources: this.sources(userId, now), persona: personaOf(sex) },
          )
        ).output.messages;
      } catch (error) {
        if (!(error instanceof AgentTaskError)) throw error;
        await this.outreach.release(userId, today);
        return { status: 'SKIPPED', reason: 'NO_VALID_MESSAGE' };
      }
      await this.messenger.send(userId, messages, `nudge_${due.id}`);
      await this.commitments.markNudged(userId, due.id);
      await this.outreach.record(userId, 'COMMITMENT_NUDGE', { strategy: due.source });
      return { status: 'NUDGE_SENT' };
    } catch (error) {
      await this.outreach.release(userId, today);
      throw error;
    }
  }

  // --- 21:00 e 23:50: o estudo do dia ----------------------------------------------------------

  /** Os especialistas leem o dia inteiro do aluno; silêncio é o padrão quando nada pede conversa. */
  async nightly(userId: string, now: Date = new Date()) {
    return this.specialistDaily.handle(userId, { source: 'NIGHTLY' }, now);
  }

  async closeDigest(userId: string, now: Date = new Date()) {
    const { timezone } = await this.store.loadUser(userId);
    return this.digests.build(userId, todayIn(timezone, now), { isToday: true, now });
  }

  // --- Dados -----------------------------------------------------------------------------------

  /** Dias sem nenhum sinal, o último sinal e o retrato do aluno para o especialista de hábitos. */
  private async silenceFacts(
    tx: TenantTransaction,
    userId: string,
    today: string,
    timezone: string,
  ) {
    const [plan] = await tx
      .select({ startsOn: trainingPlans.startsOn, structure: trainingPlans.structure })
      .from(trainingPlans)
      .where(and(eq(trainingPlans.userId, userId), eq(trainingPlans.status, 'ACTIVE')));
    if (!plan) return null;

    const stamps: Array<{ kind: SignalKind; at: Date | null }> = [];
    const latest = async (kind: SignalKind, query: Promise<Array<{ at: Date | null }>>) => {
      stamps.push({ kind, at: (await query)[0]?.at ?? null });
    };
    await latest(
      'MESSAGE',
      tx
        .select({ at: max(conversations.createdAt) })
        .from(conversations)
        .where(and(eq(conversations.userId, userId), eq(conversations.direction, 'INBOUND'))),
    );
    await latest(
      'CHECK_IN',
      tx
        .select({ at: max(dailyCheckIns.updatedAt) })
        .from(dailyCheckIns)
        .where(eq(dailyCheckIns.userId, userId)),
    );
    await latest(
      'CHECK_IN',
      tx
        .select({ at: max(checkIns.answeredAt) })
        .from(checkIns)
        .where(and(eq(checkIns.userId, userId), eq(checkIns.status, 'ANSWERED'))),
    );
    await latest(
      'MEAL',
      tx
        .select({ at: max(foodLogs.createdAt) })
        .from(foodLogs)
        .where(and(eq(foodLogs.userId, userId), eq(foodLogs.confirmed, true))),
    );
    await latest(
      'WORKOUT',
      tx
        .select({ at: max(sessionExecutions.createdAt) })
        .from(sessionExecutions)
        .where(eq(sessionExecutions.userId, userId)),
    );
    await latest(
      'WEIGHT',
      tx
        .select({ at: max(bodyMeasurements.createdAt) })
        .from(bodyMeasurements)
        .where(and(eq(bodyMeasurements.userId, userId), eq(bodyMeasurements.kind, 'WEIGHT'))),
    );
    await latest(
      'MESSAGE',
      tx
        .select({ at: max(studentReports.recordedAt) })
        .from(studentReports)
        .where(eq(studentReports.userId, userId)),
    );
    const last = stamps
      .filter((s): s is { kind: SignalKind; at: Date } => s.at !== null)
      .sort((a, b) => b.at.getTime() - a.at.getTime())[0];

    // O plano que acabou de começar também marca o início: quem nunca engrenou entra na escada.
    const planStart = new Date(`${plan.startsOn}T12:00:00Z`);
    const reference = last && last.at > planStart ? last.at : planStart;
    const referenceDay = todayIn(timezone, reference);

    const since = addDays(today, -14);
    const trained = await tx
      .select({ id: sessionExecutions.id })
      .from(sessionExecutions)
      .where(
        and(
          eq(sessionExecutions.userId, userId),
          gte(sessionExecutions.performedOn, since),
          eq(sessionExecutions.status, 'COMPLETED'),
        ),
      );
    const [lastMeal] = await tx
      .select({ day: foodLogs.loggedOn })
      .from(foodLogs)
      .where(and(eq(foodLogs.userId, userId), eq(foodLogs.confirmed, true)))
      .orderBy(desc(foodLogs.loggedOn))
      .limit(1);
    const [lastWeight] = await tx
      .select({ day: bodyMeasurements.measuredOn })
      .from(bodyMeasurements)
      .where(and(eq(bodyMeasurements.userId, userId), eq(bodyMeasurements.kind, 'WEIGHT')))
      .orderBy(desc(bodyMeasurements.measuredOn))
      .limit(1);
    const nutritionDays = await tx
      .select({ id: foodLogs.id })
      .from(foodLogs)
      .where(eq(foodLogs.userId, userId))
      .limit(1);

    return {
      daysSilent: daysBetween(referenceDay, today),
      reference,
      lastSignalKind: last?.kind ?? null,
      trainedLast14: Math.min(30, trained.length),
      plannedPerWeek: Math.min(
        14,
        plan.structure.sessions.reduce((total, s) => total + s.weeklyFrequency, 0),
      ),
      hasNutritionPlan: nutritionDays.length > 0 || lastMeal !== undefined,
      daysWithoutMealLog: lastMeal ? daysBetween(lastMeal.day, today) : null,
      daysSinceWeight: lastWeight ? daysBetween(lastWeight.day, today) : null,
    };
  }

  /** O que o aluno já fez desde que o passo foi combinado (só fatos, sem interpretação). */
  private async progressSince(tx: TenantTransaction, userId: string, since: string) {
    const sessions = await tx
      .select({ id: sessionExecutions.id })
      .from(sessionExecutions)
      .where(and(eq(sessionExecutions.userId, userId), gte(sessionExecutions.performedOn, since)));
    const meals = await tx
      .select({ day: foodLogs.loggedOn })
      .from(foodLogs)
      .where(
        and(
          eq(foodLogs.userId, userId),
          eq(foodLogs.confirmed, true),
          gte(foodLogs.loggedOn, since),
        ),
      );
    const messages = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.userId, userId),
          eq(conversations.direction, 'INBOUND'),
          gte(conversations.createdAt, new Date(`${since}T00:00:00Z`)),
        ),
      );
    return {
      sessionsDone: Math.min(14, sessions.length),
      mealDaysLogged: Math.min(14, new Set(meals.map((m) => m.day)).size),
      studentMessages: Math.min(200, messages.length),
    };
  }

  private sources(userId: string, now: Date): AgentContextSources {
    return {
      methodology: (domains) => this.methodology.render(domains),
      state: (slices) => this.state.read(userId, slices, now),
    };
  }
}
