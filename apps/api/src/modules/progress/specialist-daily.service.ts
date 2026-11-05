/**
 * Especialistas em tempo real. O check-in do dia chega e, no mesmo dia, o treinador e o
 * especialista em saúde e bem-estar leem os números dentro da área de cada um:
 *
 *   sinais do dia (código, sem modelo) → [nada de relevante: silêncio] → o especialista lê →
 *   memória do aluno · ajuste da sessão de hoje (treinador, dentro das políticas) · alerta para
 *   a equipe (bem-estar) → conversa curta pela persona, na hora (a MOVIVO atende 24/7).
 *
 * Os dados do dia vêm de duas fontes que se somam: o check-in e o que o aluno CONTA no chat
 * (relatos viram observações). Quando ele avisa antes do treino ("dormi mal"), o treinador dá a
 * recomendação explícita para a sessão de hoje e esse contexto fica salvo como dado do aluno.
 *
 * No máximo uma conversa iniciada por esses especialistas por dia (exceto quando o aluno só
 * relatou o dia: aí a resposta é sempre devida); o que não vira conversa vira memória, que os
 * demais agentes leem.
 */
import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { personaOf, type CoachingProposal } from '@movivo/shared';

import type { AgentContextSources } from '../../core/agents/agent-context';
import { AgentRunner, AgentTaskError } from '../../core/agents/agent-runner';
import { dailyCheckIns, planSessions, scheduledSessions } from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { DecisionExecutor } from '../coaching/decision/decision-executor.service';
import { DecisionPipeline } from '../coaching/decision/decision-pipeline.service';
import { PublishedPolicies } from '../coaching/policy/published-policies';
import { ConversationStore } from '../conversation/conversation-store';
import { DomainCommands } from '../conversation/domain-commands.service';
import { OutboxRelay } from '../domain-events/outbox-relay';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { addDays } from '../planning/calc/week-planner';
import { todayIn } from '../planning/plan-generation.service';
import { ObservationService } from '../student-state/observation.service';
import { mergeObservationScales, type ObservationView } from '../student-state/observations';
import { OutreachService } from '../student-state/outreach.service';
import { StudentMemoryService } from '../student-state/student-memory.service';
import { StudentStateReader } from '../student-state/student-state.reader';
import { shortenFactor } from '../training/session-adjustment';
import { AgentMessenger } from './agent-messenger';
import { DayDigestService } from './day-digest.service';
import { trainingSignal, wellbeingSignal, type CheckInDay } from './daily-signals';
import {
  specialistTalkTask,
  trainingDailyTask,
  wellbeingDailyTask,
  type DailyReadingInput,
} from './daily-specialists-tasks';
import { loadMetricsView } from './load-metrics';
import { collectLoadMetrics } from './load-metrics-data';

const DAY_TTL_SECONDS = 36 * 3_600;
const OUTREACH_WINDOW_DAYS = 3;
const HISTORY_DAYS = 7;

export interface SpecialistDailyOptions {
  source?: 'CHECK_IN' | 'CHAT' | 'NIGHTLY';
  /** O aluno só relatou o dia: ele recebe resposta mesmo que os números não peçam nada. */
  replyAlways?: boolean;
}

export type SpecialistDailyResult =
  | { status: 'QUIET' }
  | { status: 'SKIPPED'; reason: 'ALREADY_READ' | 'NO_CHECK_IN' }
  | {
      status: 'READ';
      training: 'NOT_NEEDED' | 'OBSERVED' | 'ACTED';
      wellbeing: 'NOT_NEEDED' | 'OBSERVED' | 'ESCALATED';
      reachedOut: boolean;
    };

/** Check-ins e relatos do chat viram uma linha por dia, com o pior valor quando os dois falam da mesma coisa. */
function mergeDays(
  checkIns: readonly CheckInDay[],
  reports: readonly ObservationView[],
): CheckInDay[] {
  const dates = new Set([...checkIns.map((d) => d.date), ...reports.map((r) => r.date)]);
  return [...dates].sort().map((date) => {
    const base = checkIns.find((d) => d.date === date) ?? {
      date,
      energy: null,
      sleep: null,
      soreness: null,
      mood: null,
      stress: null,
    };
    return {
      date,
      ...mergeObservationScales(
        base,
        reports.filter((r) => r.date === date),
      ),
    };
  });
}

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

@Injectable()
export class SpecialistDailyService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly runner: AgentRunner,
    private readonly state: StudentStateReader,
    private readonly methodology: PublishedMethodologyReader,
    private readonly store: ConversationStore,
    private readonly messenger: AgentMessenger,
    private readonly memory: StudentMemoryService,
    private readonly executor: DecisionExecutor,
    private readonly commands: DomainCommands,
    private readonly policies: PublishedPolicies,
    private readonly pipeline: DecisionPipeline,
    private readonly outbox: OutboxRelay,
    private readonly observations: ObservationService,
    private readonly digests: DayDigestService,
    private readonly outreach: OutreachService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SpecialistDailyService.name);
  }

  async handle(
    userId: string,
    options: SpecialistDailyOptions = {},
    now: Date = new Date(),
  ): Promise<SpecialistDailyResult> {
    const source = options.source ?? 'CHECK_IN';
    const replyAlways = options.replyAlways === true;
    const { firstName, timezone } = await this.store.loadUser(userId);
    const today = todayIn(timezone, now);

    // O estudo do dia se refaz a cada nova informação; falhar aqui nunca impede a leitura.
    await this.refreshDigest(userId, today, now);

    const data = await this.db.runAsUser(userId, 'USER', (tx) => this.collect(tx, userId, today));
    const reports = await this.observations.between(
      userId,
      addDays(today, -(HISTORY_DAYS - 1)),
      today,
    );
    const days = mergeDays(data.days, reports);
    const todayReports = reports.filter((r) => r.date === today);
    if (!days.some((d) => d.date === today) && !replyAlways) {
      return { status: 'SKIPPED', reason: 'NO_CHECK_IN' };
    }

    const readHash = createHash('sha1')
      .update(
        JSON.stringify({
          days,
          planned: data.plannedToday?.id ?? null,
          reports: todayReports.map((r) => [r.kind, r.score, r.valueNum, r.phase]),
        }),
      )
      .digest('hex')
      .slice(0, 12);
    const marker = this.keys.forUser(userId, 'specialist-daily', today, readHash);
    if ((await this.redis.set(marker, '1', 'EX', DAY_TTL_SECONDS, 'NX')) === null) {
      return { status: 'SKIPPED', reason: 'ALREADY_READ' };
    }
    try {
      const signalInput = {
        days,
        today,
        load: data.load,
        plannedToday: data.plannedToday !== null,
        reportsToday: todayReports,
      };
      const trainingReason = trainingSignal(signalInput);
      const wellbeingReason = wellbeingSignal(signalInput);
      if (!trainingReason && !wellbeingReason) {
        if (!replyAlways) return { status: 'QUIET' };
        const spoke = await this.acknowledge(userId, firstName, todayReports, today, now);
        return {
          status: 'READ',
          training: 'NOT_NEEDED',
          wellbeing: 'NOT_NEEDED',
          reachedOut: spoke,
        };
      }

      const recentOutreach = await this.recentOutreach(userId, today);
      const base = (trigger: string): DailyReadingInput => ({
        trigger,
        today,
        days,
        load: data.load,
        plannedToday: data.plannedToday
          ? {
              title: data.plannedToday.title,
              minutes: data.plannedToday.minutes,
              priority: data.plannedToday.priority,
            }
          : null,
        last7Days: data.last7Days,
        recentOutreach,
        source,
        reportsToday: todayReports.map((r) => ({
          kind: r.kind,
          score: r.score,
          value: r.valueNum,
          phase: r.phase,
          note: r.note,
        })),
      });
      const sources = this.sources(userId, now);

      const [training, wellbeing] = await Promise.all([
        trainingReason
          ? this.runSpecialist(() =>
              this.runner.run(trainingDailyTask, base(trainingReason), { userId, sources }),
            )
          : null,
        wellbeingReason
          ? this.runSpecialist(() =>
              this.runner.run(wellbeingDailyTask, base(wellbeingReason), { userId, sources }),
            )
          : null,
      ]);

      // Ajuste da sessão de hoje: o treinador age; a política limita o quanto. Uma vez por dia.
      let shortened: { title: string; minutes: number } | null = null;
      if (training?.shortenToday && data.plannedToday) {
        const shortenMarker = this.keys.forUser(userId, 'specialist-daily', 'shortened', today);
        if ((await this.redis.set(shortenMarker, '1', 'EX', DAY_TTL_SECONDS, 'NX')) !== null) {
          shortened = await this.shorten(userId, data.plannedToday, training.reading);
          if (!shortened) await this.redis.del(shortenMarker);
        }
      }
      if (shortened) {
        await this.recordAction(userId, today, {
          by: 'TRAINING',
          type: 'SHORTEN_SESSION',
          detail: `${shortened.title} encurtado para ${shortened.minutes} min: ${training?.reading ?? ''}`,
        });
      }
      if (training?.recommendation) {
        await this.recordAction(userId, today, {
          by: 'TRAINING',
          type: 'RECOMMENDATION',
          detail: training.recommendation,
        });
      }

      // Memória: o que é durável fica para os demais agentes.
      const notes = [
        training?.memoryNote
          ? { kind: 'ROUTINE' as const, text: training.memoryNote, importance: 2 as const }
          : null,
        wellbeing?.memoryNote
          ? { kind: 'HEALTH_CONTEXT' as const, text: wellbeing.memoryNote, importance: 2 as const }
          : null,
      ].filter((n): n is NonNullable<typeof n> => n !== null);
      if (notes.length > 0) {
        await this.memory.apply(
          userId,
          notes.map((n) => ({ ...n, origin: 'CHECK_IN' as const })),
        );
      }

      // Alerta para a equipe de saúde.
      if (wellbeing?.escalate) {
        await this.db.runAsSystem((tx) =>
          this.pipeline.openCase(tx, {
            userId,
            kind: 'NO_APPLICABLE_POLICY',
            domain: 'GENERAL',
            summary: `O especialista de bem-estar sinalizou: ${wellbeing.reading}`,
            subject: { source: 'DAILY_WELLBEING', date: today },
            priority: 'NORMAL',
          }),
        );
        await this.outbox.flushSoon();
        await this.recordAction(userId, today, {
          by: 'WELLBEING',
          type: 'ALERT_TEAM',
          detail: wellbeing.reading,
        });
      }

      // Conversa. Quem só relatou o dia sempre recebe resposta; fora isso, no máximo um contato
      // proativo por dia (o porteiro vale para todos os fluxos da MOVIVO).
      const trainingSpeaks =
        training !== null &&
        (training.reachOut || training.recommendation !== null) &&
        (replyAlways || shortened || training.level === 'ACT' || recentOutreach < 2);
      const wellbeingSpeaks =
        wellbeing !== null &&
        wellbeing.reachOut &&
        (replyAlways || wellbeing.level === 'ACT' || recentOutreach < 2);
      const speaker = trainingSpeaks
        ? {
            who: 'TRAINING' as const,
            reading: training?.reading ?? '',
            question: training?.question ?? null,
          }
        : wellbeingSpeaks
          ? {
              who: 'WELLBEING' as const,
              reading: wellbeing?.reading ?? '',
              question: wellbeing?.question ?? null,
            }
          : null;

      let reachedOut = false;
      if (speaker) {
        const allowed = replyAlways || (await this.outreach.tryAcquireToday(userId, today));
        if (allowed) {
          reachedOut = await this.talk(
            userId,
            firstName,
            speaker,
            { shortened, recommendation: training?.recommendation ?? null, acknowledgeOnly: false },
            today,
            now,
            replyAlways,
          );
          if (!reachedOut && !replyAlways) await this.outreach.release(userId, today);
        }
      } else if (replyAlways) {
        reachedOut = await this.acknowledge(userId, firstName, todayReports, today, now);
      }
      this.logger.info(
        {
          event: 'specialist_daily_read',
          userId,
          source,
          training: training?.level ?? null,
          wellbeing: wellbeing?.level ?? null,
          shortened: shortened !== null,
          reachedOut,
        },
        'análise em tempo real dos especialistas',
      );
      return {
        status: 'READ',
        training: !training ? 'NOT_NEEDED' : shortened ? 'ACTED' : 'OBSERVED',
        wellbeing: !wellbeing ? 'NOT_NEEDED' : wellbeing.escalate ? 'ESCALATED' : 'OBSERVED',
        reachedOut,
      };
    } catch (error) {
      await this.redis.del(marker);
      throw error;
    }
  }

  // --- Internos ------------------------------------------------------------------------------

  private async runSpecialist<T>(run: () => Promise<{ output: T }>): Promise<T | null> {
    try {
      return (await run()).output;
    } catch (error) {
      if (!(error instanceof AgentTaskError)) throw error;
      this.logger.warn({ taskId: error.taskId }, 'especialista sem leitura válida');
      return null;
    }
  }

  private async shorten(
    userId: string,
    session: { id: string; title: string; minutes: number },
    reading: string,
  ): Promise<{ title: string; minutes: number } | null> {
    // A política limita a redução automática: a proposta já vem no máximo permitido.
    const limit = (await this.policies.autonomy())?.byAction.SHORTEN_SESSION?.limit ?? 0;
    const targetMinutes = Math.max(10, Math.ceil(session.minutes * (1 - limit / 100)));
    if (limit <= 0 || targetMinutes >= session.minutes) return null;
    const action = {
      type: 'SHORTEN_SESSION' as const,
      scheduledSessionId: session.id,
      targetMinutes,
    };
    const outcome = await this.executor.decideAndRun(
      userId,
      trainingDailyTask.id,
      proposalOf(
        action,
        reading,
        'O treino de hoje cabe na recuperação do aluno, mantendo o essencial.',
      ),
      (tx, decisionId) =>
        this.commands.shortenSession(
          tx,
          userId,
          action,
          shortenFactor(session.minutes, targetMinutes),
          decisionId,
        ),
      { sessionPlannedMinutes: session.minutes },
    );
    return outcome.verdict === 'EXECUTE' ? { title: session.title, minutes: targetMinutes } : null;
  }

  /** O aluno só contou como está e nada nos dados pede mudança: anotado, e o treino segue. */
  private async acknowledge(
    userId: string,
    firstName: string | null,
    reports: readonly ObservationView[],
    today: string,
    now: Date,
  ): Promise<boolean> {
    const kinds = [...new Set(reports.map((r) => r.kind))].join(', ') || 'como está hoje';
    return this.talk(
      userId,
      firstName,
      {
        who: 'WELLBEING',
        reading: `O aluno contou ${kinds}. Os números dos últimos dias não mostram padrão que peça mudança.`,
        question: null,
      },
      { shortened: null, recommendation: null, acknowledgeOnly: true },
      today,
      now,
      true,
    );
  }

  private async talk(
    userId: string,
    firstName: string | null,
    speaker: { who: 'TRAINING' | 'WELLBEING'; reading: string; question: string | null },
    extras: {
      shortened: { title: string; minutes: number } | null;
      recommendation: string | null;
      acknowledgeOnly: boolean;
    },
    today: string,
    now: Date,
    studentInitiated: boolean,
  ): Promise<boolean> {
    try {
      const read = await this.state.read(userId, ['identity'], now);
      const sex = (read.slices.identity as { biologicalSex?: string | null } | undefined)
        ?.biologicalSex;
      const messages = (
        await this.runner.run(
          specialistTalkTask,
          {
            firstName,
            specialist: speaker.who,
            reading: speaker.reading,
            shortened: extras.shortened,
            recommendation: extras.recommendation,
            acknowledgeOnly: extras.acknowledgeOnly,
            question: speaker.question,
          },
          { userId, sources: this.sources(userId, now), persona: personaOf(sex) },
        )
      ).output.messages;
      await this.messenger.send(
        userId,
        messages,
        `specialist-daily_${speaker.who}_${today}_${Date.now().toString(36)}`,
      );
      await this.redis.incr(this.keys.forUser(userId, 'specialist-daily', 'count', today));
      await this.redis.expire(
        this.keys.forUser(userId, 'specialist-daily', 'count', today),
        OUTREACH_WINDOW_DAYS * 86_400,
      );
      if (!studentInitiated) {
        await this.outreach.record(userId, 'SPECIALIST_DAILY', { strategy: speaker.who });
      }
      await this.recordAction(userId, today, {
        by: speaker.who,
        type: 'TALK',
        detail: speaker.reading.slice(0, 200),
      });
      return true;
    } catch (error) {
      if (!(error instanceof AgentTaskError)) throw error;
      this.logger.warn(
        { userId, taskId: error.taskId },
        'conversa do especialista sem texto válido',
      );
      return false;
    }
  }

  private async refreshDigest(userId: string, today: string, now: Date): Promise<void> {
    try {
      await this.digests.build(userId, today, { isToday: true, now });
    } catch (error) {
      this.logger.warn({ userId, err: error, event: 'day_digest_failed' }, 'estudo do dia falhou');
    }
  }

  private async recordAction(
    userId: string,
    today: string,
    action: { by: string; type: string; detail: string },
  ): Promise<void> {
    try {
      await this.digests.appendAction(userId, today, action);
    } catch (error) {
      this.logger.warn({ userId, err: error, event: 'day_action_failed' }, 'ação não anotada');
    }
  }

  private async recentOutreach(userId: string, today: string): Promise<number> {
    let total = 0;
    for (let i = 0; i < OUTREACH_WINDOW_DAYS; i += 1) {
      total += Number(
        (await this.redis.get(
          this.keys.forUser(userId, 'specialist-daily', 'count', addDays(today, -i)),
        )) ?? 0,
      );
    }
    return Math.min(10, total);
  }

  private async collect(tx: TenantTransaction, userId: string, today: string) {
    const rows = await tx
      .select()
      .from(dailyCheckIns)
      .where(
        and(
          eq(dailyCheckIns.userId, userId),
          gte(dailyCheckIns.onDate, addDays(today, -(HISTORY_DAYS - 1))),
          lte(dailyCheckIns.onDate, today),
        ),
      )
      .orderBy(asc(dailyCheckIns.onDate));
    const days: CheckInDay[] = rows.map((r) => ({
      date: r.onDate,
      energy: r.energy,
      sleep: r.sleep,
      soreness: r.soreness,
      mood: r.mood,
      stress: r.stress,
    }));
    const [planned] = await tx
      .select({
        id: scheduledSessions.id,
        title: planSessions.title,
        minutes: planSessions.estimatedMinutes,
        priority: planSessions.priority,
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
      .orderBy(desc(scheduledSessions.createdAt))
      .limit(1);
    const week = await tx
      .select({ status: scheduledSessions.status })
      .from(scheduledSessions)
      .where(
        and(
          eq(scheduledSessions.userId, userId),
          gte(scheduledSessions.scheduledOn, addDays(today, -6)),
          lte(scheduledSessions.scheduledOn, addDays(today, -1)),
        ),
      );
    return {
      days,
      plannedToday: planned ?? null,
      last7Days: {
        planned: week.filter((s) => s.status !== 'SKIPPED' && s.status !== 'MOVED').length,
        done: week.filter((s) => s.status === 'DONE' || s.status === 'PARTIAL').length,
      },
      load: loadMetricsView(await collectLoadMetrics(tx, userId, today)),
    };
  }

  private sources(userId: string, now: Date): AgentContextSources {
    return {
      methodology: (domains) => this.methodology.render(domains),
      state: (slices) => this.state.read(userId, slices, now),
    };
  }
}
