/**
 * Treino perdido: busca ativa sem cobrança.
 *
 *   sessão perdida → o especialista de hábitos lê o padrão e escolhe
 *   a abordagem (perguntar, remarcar, versão curta, normalizar ou acolher e avisar a equipe) →
 *   a persona conversa com uma pergunta simples. O que muda na agenda acontece quando o aluno
 *   responde, pelo fluxo de conversa de sempre.
 *
 * No máximo uma busca a cada dois dias. A MOVIVO é uma consultoria 24/7: não há janela de horário.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { personaOf } from '@movivo/shared';

import type { AgentContextSources } from '../../core/agents/agent-context';
import { AgentRunner, AgentTaskError } from '../../core/agents/agent-runner';
import {
  dailyCheckIns,
  planSessions,
  scheduledSessions,
  sessionExecutions,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { DecisionPipeline } from '../coaching/decision/decision-pipeline.service';
import { ConversationStore } from '../conversation/conversation-store';
import { OutboxRelay } from '../domain-events/outbox-relay';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { addDays } from '../planning/calc/week-planner';
import { todayIn } from '../planning/plan-generation.service';
import { StudentStateReader } from '../student-state/student-state.reader';
import { AgentMessenger } from './agent-messenger';
import { loadMetricsView } from './load-metrics';
import { collectLoadMetrics } from './load-metrics-data';
import {
  missedSessionMessageTask,
  missedSessionPlanTask,
  type MissedSessionInput,
  type MissedSessionPlan,
} from './missed-session-tasks';

const MARKER_TTL_SECONDS = 2 * 86_400;
const LOOKBACK_DAYS = 3;
const PATTERN_DAYS = 14;
const AHEAD_DAYS = 4;

export type MissedSessionResult =
  | {
      status: 'SKIPPED';
      reason:
        | 'ALREADY_REACHED'
        | 'NOTHING_MISSED'
        | 'TRAINED_TODAY'
        | 'NO_VALID_PLAN'
        | 'NO_VALID_MESSAGE';
    }
  | { status: 'SENT'; strategy: MissedSessionPlan['strategy'] };

const weekdayOf = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`).getUTCDay();
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

@Injectable()
export class MissedSessionService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly runner: AgentRunner,
    private readonly state: StudentStateReader,
    private readonly methodology: PublishedMethodologyReader,
    private readonly store: ConversationStore,
    private readonly messenger: AgentMessenger,
    private readonly pipeline: DecisionPipeline,
    private readonly outbox: OutboxRelay,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MissedSessionService.name);
  }

  async handle(userId: string, now: Date = new Date()): Promise<MissedSessionResult> {
    const stateRead = await this.state.read(userId, ['identity'], now);
    const identity = stateRead.slices.identity as
      { timezone?: string | null; biologicalSex?: string | null } | undefined;
    const timezone = identity?.timezone ?? null;

    const marker = this.keys.forUser(userId, 'missed-outreach', 'recent');
    if ((await this.redis.set(marker, '1', 'EX', MARKER_TTL_SECONDS, 'NX')) === null) {
      return { status: 'SKIPPED', reason: 'ALREADY_REACHED' };
    }
    try {
      const result = await this.run(userId, todayIn(timezone, now), identity, now);
      // Só quem recebeu a mensagem ocupa a janela de dois dias.
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
    identity: { biologicalSex?: string | null } | undefined,
    now: Date,
  ): Promise<MissedSessionResult> {
    const input = await this.db.runAsUser(userId, 'USER', (tx) =>
      this.buildInput(tx, userId, today),
    );
    if (input === 'TRAINED_TODAY') return { status: 'SKIPPED', reason: 'TRAINED_TODAY' };
    if (input === null) return { status: 'SKIPPED', reason: 'NOTHING_MISSED' };

    const sources = this.sources(userId, now);
    let plan: MissedSessionPlan;
    try {
      plan = (await this.runner.run(missedSessionPlanTask, input, { userId, sources })).output;
    } catch (error) {
      if (!(error instanceof AgentTaskError)) throw error;
      this.logger.warn({ userId, taskId: error.taskId }, 'treino perdido sem plano válido');
      return { status: 'SKIPPED', reason: 'NO_VALID_PLAN' };
    }

    const { firstName } = await this.store.loadUser(userId);
    let messages: string[];
    try {
      messages = (
        await this.runner.run(
          missedSessionMessageTask,
          { firstName, missedTitles: input.missed.map((m) => m.title), plan },
          { userId, sources, persona: personaOf(identity?.biologicalSex) },
        )
      ).output.messages;
    } catch (error) {
      if (!(error instanceof AgentTaskError)) throw error;
      this.logger.warn({ userId, taskId: error.taskId }, 'treino perdido sem texto válido');
      return { status: 'SKIPPED', reason: 'NO_VALID_MESSAGE' };
    }
    await this.messenger.send(userId, messages, `missed_${today}`);

    if (plan.strategy === 'ESCALATE') {
      await this.db.runAsSystem((tx) =>
        this.pipeline.openCase(tx, {
          userId,
          kind: 'NO_APPLICABLE_POLICY',
          domain: 'GENERAL',
          summary: `O agente de hábitos acolheu o aluno após ${input.last14Days.missed} sessões perdidas em 14 dias (${plan.rationale})`,
          subject: { source: 'MISSED_SESSIONS', date: today },
          priority: 'NORMAL',
        }),
      );
      await this.outbox.flushSoon();
    }
    this.logger.info(
      { event: 'missed_session_outreach', userId, strategy: plan.strategy },
      'busca ativa de treino perdido enviada',
    );
    return { status: 'SENT', strategy: plan.strategy };
  }

  private async buildInput(
    tx: Parameters<Parameters<TenantDatabase['runAsUser']>[2]>[0],
    userId: string,
    today: string,
  ): Promise<MissedSessionInput | 'TRAINED_TODAY' | null> {
    const finished = ['COMPLETED', 'PARTIAL'];
    const [trainedToday] = await tx
      .select({ id: sessionExecutions.id })
      .from(sessionExecutions)
      .where(
        and(
          eq(sessionExecutions.userId, userId),
          eq(sessionExecutions.performedOn, today),
          inArray(sessionExecutions.status, finished),
        ),
      );
    if (trainedToday) return 'TRAINED_TODAY';

    const window = await tx
      .select({
        date: scheduledSessions.scheduledOn,
        status: scheduledSessions.status,
        title: planSessions.title,
        priority: planSessions.priority,
        modality: planSessions.modality,
        minutes: planSessions.estimatedMinutes,
      })
      .from(scheduledSessions)
      .innerJoin(planSessions, eq(planSessions.id, scheduledSessions.planSessionId))
      .where(
        and(
          eq(scheduledSessions.userId, userId),
          gte(scheduledSessions.scheduledOn, addDays(today, -(PATTERN_DAYS - 1))),
          lte(scheduledSessions.scheduledOn, addDays(today, AHEAD_DAYS - 1)),
        ),
      )
      .orderBy(asc(scheduledSessions.scheduledOn));

    const past = window.filter((s) => s.date < today);
    const missedAll = past.filter((s) => s.status === 'MISSED');
    const missed = missedAll.filter((s) => s.date >= addDays(today, -LOOKBACK_DAYS));
    if (missed.length === 0) return null;

    const weekdayCounts = new Map<number, number>();
    for (const s of missedAll) {
      weekdayCounts.set(weekdayOf(s.date), (weekdayCounts.get(weekdayOf(s.date)) ?? 0) + 1);
    }
    const upcoming = window.filter((s) => s.date >= today && s.status === 'PLANNED');
    const busy = new Set(upcoming.map((s) => s.date));
    const freeDays = Array.from({ length: AHEAD_DAYS }, (_, i) => addDays(today, i)).filter(
      (day) => !busy.has(day),
    );

    const [lastTraining] = await tx
      .select({ date: sessionExecutions.performedOn })
      .from(sessionExecutions)
      .where(
        and(
          eq(sessionExecutions.userId, userId),
          inArray(sessionExecutions.status, finished),
          lte(sessionExecutions.performedOn, today),
        ),
      )
      .orderBy(desc(sessionExecutions.performedOn))
      .limit(1);

    const [checkIn] = await tx
      .select()
      .from(dailyCheckIns)
      .where(and(eq(dailyCheckIns.userId, userId), gte(dailyCheckIns.onDate, addDays(today, -2))))
      .orderBy(desc(dailyCheckIns.onDate))
      .limit(1);

    return {
      missed: missed.map((s) => ({
        date: s.date,
        title: s.title,
        priority: s.priority,
        modality: s.modality,
        estimatedMinutes: s.minutes,
      })),
      last14Days: {
        planned: past.filter((s) => s.status !== 'SKIPPED' && s.status !== 'MOVED').length,
        done: past.filter((s) => s.status === 'DONE' || s.status === 'PARTIAL').length,
        missed: missedAll.length,
        missedWeekdays: [...weekdayCounts].filter(([, count]) => count >= 2).map(([day]) => day),
      },
      freeDays,
      upcoming: upcoming.map((s) => ({ date: s.date, title: s.title })).slice(0, 6),
      daysSinceLastTraining: lastTraining ? daysBetween(lastTraining.date, today) : null,
      checkIn: checkIn
        ? {
            energy: checkIn.energy,
            sleep: checkIn.sleep,
            mood: checkIn.mood,
            stress: checkIn.stress,
          }
        : null,
      loadMetrics: loadMetricsView(await collectLoadMetrics(tx, userId, today)),
    };
  }

  private sources(userId: string, now: Date): AgentContextSources {
    return {
      methodology: (domains) => this.methodology.render(domains),
      state: (slices) => this.state.read(userId, slices, now),
    };
  }
}
