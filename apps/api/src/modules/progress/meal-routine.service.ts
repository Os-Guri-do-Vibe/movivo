/**
 * Rotina alimentar proativa, no relógio local de cada aluno:
 *
 *   hora da refeição → lembrete no WhatsApp com a primeira opção do cardápio (a persona abre e
 *   fecha; a lista vem do plano) → o aluno registra por texto, áudio ou foto → no fim do dia
 *   (tudo registrado, ou 23:30) o resumo com calorias, macros e água, com a leitura do
 *   nutricionista → sem registro, a especialista de hábitos entende por quê e a persona conversa.
 *
 * A varredura só enfileira o que está na hora; cada trabalho confere o plano e o estado do aluno,
 * é idempotente por marca no Redis. A MOVIVO atende 24/7: não há janela de horário.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import {
  MEAL_SLOT_LABELS,
  personaOf,
  type DeclaredGoalKind,
  type DailyTargets,
  type MealSlot,
  type NutritionPlanStructure,
} from '@movivo/shared';

import type { AgentContextSources } from '../../core/agents/agent-context';
import { AgentRunner, AgentTaskError } from '../../core/agents/agent-runner';
import {
  bodyMeasurements,
  conversations,
  dailyCheckIns,
  foodLogs,
  nutritionPlans,
  scheduledSessions,
  sessionExecutions,
} from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { DecisionPipeline } from '../coaching/decision/decision-pipeline.service';
import { ConversationStore } from '../conversation/conversation-store';
import { FoodChatService } from '../conversation/food-chat.service';
import { OutboxRelay } from '../domain-events/outbox-relay';
import type { FollowUpJob } from '../jobs/follow-up.contract';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import {
  dayIsClosable,
  dayTotals,
  daySummaryBlock,
  MEAL_CLOCK,
  missingSlots,
  optionLines,
  SUMMARY_DEADLINE,
  SUMMARY_EARLIEST,
  toMinutes,
  trackedSlots,
  type LoggedMeal,
} from '../nutrition/meal-routine';
import { addDays } from '../planning/calc/week-planner';
import { todayIn } from '../planning/plan-generation.service';
import { OutreachService } from '../student-state/outreach.service';
import { StudentStateReader } from '../student-state/student-state.reader';
import { loadEligibleStudents, localParts } from '../training/eligibility';
import { AgentMessenger } from './agent-messenger';
import { trackingGapTask } from './reengagement-tasks';
import { daysBetween } from './silence';
import { GOAL_DIRECTION } from './weekly-review.service';
import {
  dayReviewTask,
  ESCALATE_MIN_DAYS,
  loggingGapMessageTask,
  loggingGapPlanTask,
  mealReminderTask,
  type LoggingGapInput,
} from './meal-routine-tasks';

/** Reminders param de sair depois de tantos dias sem registro: a busca ativa assume. */
const REMINDER_PAUSE_AFTER_GAP_DAYS = 3;
/** A conversa de falha de registro começa depois de tantos dias seguidos sem registro. */
const GAP_OUTREACH_AFTER_DAYS = 2;
const GAP_RUN_TIME = '14:00';
const DAY_TTL_SECONDS = 36 * 3_600;
const GAP_MARKER_TTL_SECONDS = 3 * 86_400;
const GAP_COUNT_TTL_SECONDS = 14 * 86_400;
/** O peso é semanal (check-in de domingo): duas semanas sem pesar é falha de pesagem. */
const WEIGH_GAP_DAYS = 15;
const WEIGH_MARKER_TTL_SECONDS = 7 * 86_400;
const HISTORY_DAYS = 14;

export type MealRoutineResult =
  | { status: 'SENT'; kind: 'REMINDER' | 'DAY_SUMMARY' | 'LOGGING_GAP' }
  | { status: 'SKIPPED'; reason: string };

interface DayData {
  structure: NutritionPlanStructure;
  planStartsOn: string;
  /** Registros confirmados dos últimos dias (inclui hoje). */
  logs: Array<LoggedMeal & { loggedOn: string }>;
  dayType: 'TRAINING' | 'REST';
  waterMl: number | null;
}

const SLOT_PERIOD: Record<string, 'MORNING' | 'AFTERNOON' | 'EVENING'> = {
  BREAKFAST: 'MORNING',
  MORNING_SNACK: 'MORNING',
  LUNCH: 'AFTERNOON',
  AFTERNOON_SNACK: 'AFTERNOON',
  DINNER: 'EVENING',
  SUPPER: 'EVENING',
};

/** Dias seguidos sem registro, de ontem para trás (hoje ainda pode acontecer). */
export function gapDaysOf(
  logged: ReadonlySet<string>,
  today: string,
  planStartsOn: string,
): number {
  let days = 0;
  for (let day = addDays(today, -1); day >= planStartsOn && days < 60; day = addDays(day, -1)) {
    if (logged.has(day)) break;
    days += 1;
  }
  return days;
}

/** Dias seguidos COM registro, de ontem para trás. */
export function streakDaysOf(logged: ReadonlySet<string>, today: string): number {
  let days = 0;
  for (let day = addDays(today, -1); days < 60 && logged.has(day); day = addDays(day, -1))
    days += 1;
  return days;
}

@Injectable()
export class MealRoutineService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly queues: QueueManager,
    private readonly runner: AgentRunner,
    private readonly state: StudentStateReader,
    private readonly methodology: PublishedMethodologyReader,
    private readonly store: ConversationStore,
    private readonly messenger: AgentMessenger,
    private readonly foodChat: FoodChatService,
    private readonly pipeline: DecisionPipeline,
    private readonly outbox: OutboxRelay,
    private readonly outreach: OutreachService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MealRoutineService.name);
  }

  // --- Varredura -----------------------------------------------------------------------------

  /** Por minuto: enfileira o que está na hora, no relógio de cada aluno. */
  async scan(now: Date = new Date()) {
    const eligible = await loadEligibleStudents(this.db);
    let queued = 0;
    for (const student of eligible) {
      const local = localParts(now, student.timezone);
      if (!local) continue;
      const jobs: Array<{ job: FollowUpJob; id: string }> = [];
      const slot = (Object.keys(MEAL_CLOCK) as MealSlot[]).find(
        (s) => MEAL_CLOCK[s] === local.time,
      );
      if (slot) {
        jobs.push({
          job: { kind: 'MEAL_REMINDER', userId: student.userId, slot },
          id: `meal-reminder_${student.userId}_${local.date}_${slot}`,
        });
      }
      const minutes = toMinutes(local.time);
      if (
        minutes >= toMinutes(SUMMARY_EARLIEST) &&
        minutes <= toMinutes(SUMMARY_DEADLINE) &&
        minutes % 15 === 0
      ) {
        jobs.push({
          job: { kind: 'DAY_SUMMARY', userId: student.userId },
          id: `day-summary_${student.userId}_${local.date}_${local.time.replace(':', '')}`,
        });
      }
      if (local.time === GAP_RUN_TIME) {
        jobs.push({
          job: { kind: 'LOGGING_GAP', userId: student.userId },
          id: `logging-gap_${student.userId}_${local.date}`,
        });
      }
      for (const { job, id } of jobs) {
        try {
          await this.queues.enqueue(
            QUEUE.studentFollowUp,
            job.kind.toLowerCase().replaceAll('_', '-'),
            job,
            {
              jobId: id,
            },
          );
          queued += 1;
        } catch (err: unknown) {
          this.logger.warn(
            { event: 'meal_routine_enqueue_failed', kind: job.kind, userId: student.userId, err },
            'falha ao enfileirar a rotina alimentar; segue com os demais',
          );
        }
      }
    }
    return { status: 'SCANNED', eligible: eligible.length, queued };
  }

  // --- Lembrete da refeição ------------------------------------------------------------------

  async reminder(
    userId: string,
    slot: MealSlot,
    now: Date = new Date(),
  ): Promise<MealRoutineResult> {
    const { firstName, timezone } = await this.store.loadUser(userId);
    const today = todayIn(timezone, now);
    const data = await this.db.runAsUser(userId, 'USER', (tx) => this.dayData(tx, userId, today));
    if (!data) return { status: 'SKIPPED', reason: 'NO_PLAN' };

    const meal = data.structure.meals.find((m) => m.slot === slot);
    const option = meal?.options?.[0];
    if (!meal || !option) return { status: 'SKIPPED', reason: 'NO_MENU_FOR_SLOT' };

    const loggedDates = new Set(data.logs.map((l) => l.loggedOn));
    const todays = data.logs.filter((l) => l.loggedOn === today);
    if (todays.some((l) => l.slot === slot)) return { status: 'SKIPPED', reason: 'ALREADY_LOGGED' };
    const gapDays = gapDaysOf(loggedDates, today, data.planStartsOn);
    if (gapDays >= REMINDER_PAUSE_AFTER_GAP_DAYS) {
      return { status: 'SKIPPED', reason: 'PAUSED_BY_LOGGING_GAP' };
    }

    const marker = this.keys.forUser(userId, 'meal-reminder', today, slot);
    if ((await this.redis.set(marker, '1', 'EX', DAY_TTL_SECONDS, 'NX')) === null) {
      return { status: 'SKIPPED', reason: 'ALREADY_SENT' };
    }
    try {
      const label = MEAL_SLOT_LABELS[slot].toLowerCase();
      const sources = this.sources(userId, now);
      const persona = await this.persona(userId, now);
      let opening = `Oi${firstName ? `, ${firstName}` : ''}! Lembre-se de registrar seu ${label}:`;
      let closing =
        'Me envie uma foto, um áudio ou descreva o que você comeu para eu registrar. Se quiser outras opções para essa refeição, é só abrir o seu plano alimentar em PDF ou me perguntar.';
      try {
        const run = await this.runner.run(
          mealReminderTask,
          {
            firstName,
            mealLabel: label,
            period: SLOT_PERIOD[slot] ?? 'MORNING',
            loggedToday: todays.length,
            streakDays: streakDaysOf(loggedDates, today),
            trainingToday: data.dayType === 'TRAINING',
          },
          { userId, sources, persona },
        );
        opening = run.output.opening;
        closing = run.output.closing;
      } catch (error) {
        if (!(error instanceof AgentTaskError)) throw error;
        this.logger.warn({ userId, taskId: error.taskId }, 'lembrete com texto padrão');
      }
      const text = [opening, ...optionLines(option), '', closing].join('\n');
      await this.messenger.send(userId, [text], `meal-reminder_${today}_${slot}`);
      await this.foodChat.markPending(userId, slot);
      return { status: 'SENT', kind: 'REMINDER' };
    } catch (error) {
      await this.redis.del(marker);
      throw error;
    }
  }

  // --- Resumo do dia -------------------------------------------------------------------------

  async daySummary(userId: string, now: Date = new Date()): Promise<MealRoutineResult> {
    const { firstName, timezone } = await this.store.loadUser(userId);
    const local = localParts(now, timezone);
    if (!local) return { status: 'SKIPPED', reason: 'INVALID_TIMEZONE' };
    const today = local.date;
    const data = await this.db.runAsUser(userId, 'USER', (tx) => this.dayData(tx, userId, today));
    if (!data) return { status: 'SKIPPED', reason: 'NO_PLAN' };

    const todays = data.logs.filter((l) => l.loggedOn === today);
    if (todays.length === 0) return { status: 'SKIPPED', reason: 'NO_LOGS' };
    const planned = trackedSlots(data.structure);
    if (!dayIsClosable({ planned, logged: todays, localTime: local.time, now })) {
      return { status: 'SKIPPED', reason: 'DAY_NOT_CLOSED' };
    }

    const marker = this.keys.forUser(userId, 'day-summary', today);
    if ((await this.redis.set(marker, '1', 'EX', DAY_TTL_SECONDS, 'NX')) === null) {
      return { status: 'SKIPPED', reason: 'ALREADY_SENT' };
    }
    try {
      const totals = dayTotals(todays);
      const targets: DailyTargets =
        data.dayType === 'TRAINING' ? data.structure.trainingDay : data.structure.restDay;
      const missing = missingSlots(planned, todays);
      const previous = data.logs.filter((l) => l.loggedOn !== today);
      const byDay = new Map<string, LoggedMeal[]>();
      for (const log of previous)
        byDay.set(log.loggedOn, [...(byDay.get(log.loggedOn) ?? []), log]);
      const days = [...byDay.values()].slice(-7).map(dayTotals);
      const blocks = [daySummaryBlock({ firstName, totals, waterMl: data.waterMl })];

      let note: string | null = null;
      try {
        const run = await this.runner.run(
          dayReviewTask,
          {
            firstName,
            dayType: data.dayType,
            strategy: data.structure.strategy,
            targets: {
              energyMinKcal: targets.energyKcal.min,
              energyMaxKcal: targets.energyKcal.max,
              proteinG: targets.proteinG,
              waterMl: targets.waterMl,
            },
            consumed: totals,
            waterMl: data.waterMl,
            meals: todays.map((l) => ({
              label: MEAL_SLOT_LABELS[l.slot],
              energyKcal: Math.round(l.energyKcal),
              proteinG: Math.round(l.proteinG),
            })),
            missingMeals: missing.map((s) => MEAL_SLOT_LABELS[s]),
            closedBecause: missing.length === 0 ? 'ALL_LOGGED' : 'END_OF_DAY',
            last7DaysAverage:
              days.length >= 2
                ? {
                    days: days.length,
                    energyKcal: Math.round(
                      days.reduce((s, d) => s + d.energyKcal, 0) / days.length,
                    ),
                    proteinG: Math.round(days.reduce((s, d) => s + d.proteinG, 0) / days.length),
                  }
                : null,
          },
          {
            userId,
            sources: this.sources(userId, now),
            persona: await this.persona(userId, now),
          },
        );
        note = run.output.note;
      } catch (error) {
        if (!(error instanceof AgentTaskError)) throw error;
        this.logger.warn(
          { userId, taskId: error.taskId },
          'resumo do dia sem leitura do nutricionista',
        );
      }
      if (note) blocks.push(note);
      await this.messenger.send(userId, blocks, `day-summary_${today}`);
      return { status: 'SENT', kind: 'DAY_SUMMARY' };
    } catch (error) {
      await this.redis.del(marker);
      throw error;
    }
  }

  // --- Falha de registro ---------------------------------------------------------------------

  /**
   * Falha de registro e de pesagem. Quem não registra as refeições, ou deixa de se pesar no
   * check-in de domingo, recebe um contato proativo definido em equipe: a nutricionista diz o que
   * precisa e o jeito mais leve de conseguir, o especialista de hábitos escolhe a abordagem e a
   * persona conversa. No máximo um contato proativo por dia, qualquer que seja o fluxo.
   */
  async loggingGap(userId: string, now: Date = new Date()): Promise<MealRoutineResult> {
    const { firstName, timezone } = await this.store.loadUser(userId);
    const today = todayIn(timezone, now);
    const data = await this.db.runAsUser(userId, 'USER', (tx) => this.dayData(tx, userId, today));
    if (!data) return { status: 'SKIPPED', reason: 'NO_PLAN' };

    const loggedDates = new Set(data.logs.map((l) => l.loggedOn));
    const gapDays = gapDaysOf(loggedDates, today, data.planStartsOn);
    const context = await this.db.runAsUser(userId, 'USER', (tx) =>
      this.gapContext(tx, userId, today),
    );
    const daysOnPlan = daysBetween(data.planStartsOn, today);
    const mealGap = !loggedDates.has(today) && gapDays >= GAP_OUTREACH_AFTER_DAYS;
    const weighGap =
      context.daysSinceWeight === null
        ? daysOnPlan >= WEIGH_GAP_DAYS
        : context.daysSinceWeight >= WEIGH_GAP_DAYS;
    if (!mealGap && !weighGap) {
      return { status: 'SKIPPED', reason: loggedDates.has(today) ? 'LOGGED_TODAY' : 'NO_GAP' };
    }

    // Só a pesagem faltando: um contato por semana basta (o peso é semanal).
    const markerKey = mealGap ? 'recent' : 'weigh-recent';
    const marker = this.keys.forUser(userId, 'logging-gap', markerKey);
    const markerTtl = mealGap ? GAP_MARKER_TTL_SECONDS : WEIGH_MARKER_TTL_SECONDS;
    if ((await this.redis.set(marker, '1', 'EX', markerTtl, 'NX')) === null) {
      return { status: 'SKIPPED', reason: 'ALREADY_REACHED' };
    }
    if (!(await this.outreach.tryAcquireToday(userId, today))) {
      await this.redis.del(marker);
      return { status: 'SKIPPED', reason: 'OTHER_CONTACT_TODAY' };
    }
    const giveUp = async (reason: string): Promise<MealRoutineResult> => {
      await this.redis.del(marker);
      await this.outreach.release(userId, today);
      return { status: 'SKIPPED', reason };
    };
    try {
      const countKey = this.keys.forUser(userId, 'logging-gap', 'count');
      const previousOutreach = Number((await this.redis.get(countKey)) ?? 0);
      const sources = this.sources(userId, now);
      const goalsRead = await this.state.read(userId, ['goals'], now);
      const declared = (
        goalsRead.slices.goals as { declared?: { primary?: DeclaredGoalKind } } | null
      )?.declared;
      const daysWithoutLog = mealGap ? gapDays + 1 : 0;

      // 1. A nutricionista diz o que precisa e o jeito mais leve de pedir.
      let nutritionist;
      try {
        nutritionist = (
          await this.runner.run(
            trackingGapTask,
            {
              goalDirection: (declared?.primary && GOAL_DIRECTION[declared.primary]) || 'MAINTAIN',
              daysWithoutMealLog: daysWithoutLog,
              loggedMealDaysLast14: loggedDates.size,
              daysSinceWeight: context.daysSinceWeight,
              weightPointsLast8Weeks: context.weightPoints,
              daysOnPlan: Math.min(3650, daysOnPlan),
            },
            { userId, sources },
          )
        ).output;
      } catch (error) {
        if (!(error instanceof AgentTaskError)) throw error;
        return giveUp('NO_VALID_NUTRITION_READING');
      }

      // 2. O especialista de hábitos escolhe a abordagem a partir do pedido da nutricionista.
      const input: LoggingGapInput = {
        daysWithoutLog: Math.max(1, daysWithoutLog),
        loggedDaysLast14: loggedDates.size,
        remindersLast3Days: await this.remindersSent(userId, today),
        previousOutreachLast14: previousOutreach,
        daysSinceWeight: context.daysSinceWeight,
        nutritionist,
        talkedRecently: context.talkedRecently,
        trainedLast7Days: context.trainedLast7Days,
        checkIn: context.checkIn,
      };
      let plan;
      try {
        plan = (await this.runner.run(loggingGapPlanTask, input, { userId, sources })).output;
      } catch (error) {
        if (!(error instanceof AgentTaskError)) throw error;
        return giveUp('NO_VALID_PLAN');
      }

      // 3. A persona conversa.
      let messages: string[];
      try {
        messages = (
          await this.runner.run(
            loggingGapMessageTask,
            {
              firstName,
              daysWithoutLog: input.daysWithoutLog,
              daysSinceWeight: context.daysSinceWeight,
              plan,
              nutritionist,
            },
            { userId, sources, persona: await this.persona(userId, now) },
          )
        ).output.messages;
      } catch (error) {
        if (!(error instanceof AgentTaskError)) throw error;
        return giveUp('NO_VALID_MESSAGE');
      }
      await this.messenger.send(userId, messages, `logging-gap_${today}`);
      await this.outreach.record(userId, 'LOGGING_GAP', { strategy: plan.strategy });
      await this.redis.incr(countKey);
      await this.redis.expire(countKey, GAP_COUNT_TTL_SECONDS);

      if (plan.strategy === 'ESCALATE' && mealGap && input.daysWithoutLog >= ESCALATE_MIN_DAYS) {
        await this.db.runAsSystem((tx) =>
          this.pipeline.openCase(tx, {
            userId,
            kind: 'NO_APPLICABLE_POLICY',
            domain: 'NUTRITION',
            summary: `O agente de hábitos acolheu o aluno após ${input.daysWithoutLog} dias sem registro alimentar (${plan.rationale})`,
            subject: { source: 'LOGGING_GAP', date: today },
            priority: 'NORMAL',
          }),
        );
        await this.outbox.flushSoon();
      }
      this.logger.info(
        { event: 'logging_gap_outreach', userId, strategy: plan.strategy, mealGap, weighGap },
        'busca ativa de registro e pesagem enviada',
      );
      return { status: 'SENT', kind: 'LOGGING_GAP' };
    } catch (error) {
      await this.redis.del(marker);
      await this.outreach.release(userId, today);
      throw error;
    }
  }

  // --- Dados ---------------------------------------------------------------------------------

  private async dayData(
    tx: TenantTransaction,
    userId: string,
    today: string,
  ): Promise<DayData | null> {
    const [plan] = await tx
      .select({ structure: nutritionPlans.structure, startsOn: nutritionPlans.startsOn })
      .from(nutritionPlans)
      .where(and(eq(nutritionPlans.userId, userId), eq(nutritionPlans.status, 'ACTIVE')));
    if (!plan) return null;
    const rows = await tx
      .select({
        loggedOn: foodLogs.loggedOn,
        meal: foodLogs.meal,
        totals: foodLogs.totals,
        createdAt: foodLogs.createdAt,
      })
      .from(foodLogs)
      .where(
        and(
          eq(foodLogs.userId, userId),
          eq(foodLogs.confirmed, true),
          gte(foodLogs.loggedOn, addDays(today, -(HISTORY_DAYS - 1))),
        ),
      );
    const [training] = await tx
      .select({ id: scheduledSessions.id })
      .from(scheduledSessions)
      .where(
        and(
          eq(scheduledSessions.userId, userId),
          eq(scheduledSessions.scheduledOn, today),
          inArray(scheduledSessions.status, ['PLANNED', 'DONE', 'PARTIAL', 'MISSED']),
        ),
      )
      .limit(1);
    const [check] = await tx
      .select({ waterMl: dailyCheckIns.waterMl })
      .from(dailyCheckIns)
      .where(and(eq(dailyCheckIns.userId, userId), eq(dailyCheckIns.onDate, today)));
    return {
      structure: plan.structure,
      planStartsOn: plan.startsOn,
      logs: rows.map((row) => ({
        loggedOn: row.loggedOn,
        slot: row.meal as MealSlot,
        energyKcal: row.totals.energyKcal,
        proteinG: row.totals.proteinG,
        carbsG: row.totals.carbsG,
        fatG: row.totals.fatG,
        createdAt: row.createdAt,
      })),
      dayType: training ? 'TRAINING' : 'REST',
      waterMl: check?.waterMl ?? null,
    };
  }

  private async gapContext(tx: TenantTransaction, userId: string, today: string) {
    const [talked] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.userId, userId),
          eq(conversations.direction, 'INBOUND'),
          eq(conversations.mirror, false),
          gte(conversations.createdAt, new Date(Date.parse(`${today}T00:00:00Z`) - 2 * 86_400_000)),
        ),
      )
      .limit(1);
    const trained = await tx
      .select({ id: sessionExecutions.id })
      .from(sessionExecutions)
      .where(
        and(
          eq(sessionExecutions.userId, userId),
          inArray(sessionExecutions.status, ['COMPLETED', 'PARTIAL']),
          gte(sessionExecutions.performedOn, addDays(today, -6)),
        ),
      );
    const [check] = await tx
      .select()
      .from(dailyCheckIns)
      .where(and(eq(dailyCheckIns.userId, userId), gte(dailyCheckIns.onDate, addDays(today, -3))))
      .orderBy(desc(dailyCheckIns.onDate))
      .limit(1);
    const weights = await tx
      .select({ date: bodyMeasurements.measuredOn })
      .from(bodyMeasurements)
      .where(
        and(
          eq(bodyMeasurements.userId, userId),
          eq(bodyMeasurements.kind, 'WEIGHT'),
          gte(bodyMeasurements.measuredOn, addDays(today, -56)),
        ),
      )
      .orderBy(desc(bodyMeasurements.measuredOn));
    const [lastWeight] = weights.length
      ? [weights[0]]
      : await tx
          .select({ date: bodyMeasurements.measuredOn })
          .from(bodyMeasurements)
          .where(and(eq(bodyMeasurements.userId, userId), eq(bodyMeasurements.kind, 'WEIGHT')))
          .orderBy(desc(bodyMeasurements.measuredOn))
          .limit(1);
    return {
      daysSinceWeight: lastWeight ? daysBetween(lastWeight.date, today) : null,
      weightPoints: Math.min(8, weights.length),
      talkedRecently: Boolean(talked),
      trainedLast7Days: Math.min(14, trained.length),
      checkIn: check
        ? { energy: check.energy, sleep: check.sleep, mood: check.mood, stress: check.stress }
        : null,
    };
  }

  /** Lembretes dos últimos 3 dias (marcas do Redis, uma por refeição e dia). */
  private async remindersSent(userId: string, today: string): Promise<number> {
    let total = 0;
    for (const offset of [0, 1, 2]) {
      for (const slot of Object.keys(MEAL_CLOCK)) {
        const exists = await this.redis.exists(
          this.keys.forUser(userId, 'meal-reminder', addDays(today, -offset), slot),
        );
        total += exists;
      }
    }
    return Math.min(30, total);
  }

  private async persona(userId: string, now: Date) {
    const read = await this.state.read(userId, ['identity'], now);
    return personaOf(
      (read.slices.identity as { biologicalSex?: string | null } | undefined)?.biologicalSex,
    );
  }

  private sources(userId: string, now: Date): AgentContextSources {
    return {
      methodology: (domains) => this.methodology.render(domains),
      state: (slices) => this.state.read(userId, slices, now),
    };
  }
}
