/**
 * Registro alimentar pelo WhatsApp: o aluno escreve, manda áudio (já transcrito) ou foto; a MOVIVO
 * interpreta, conta (totais pela base de alimentos; o que a base não tem entra por estimativa
 * declarada) e responde com a lista, os números da refeição e do dia e a leitura curta do
 * nutricionista. Qualquer coisa que ele coma conta, esteja ou não no plano.
 *
 * O registro conta na hora: a foto e a estimativa podem errar, então a resposta sempre mostra o
 * que foi anotado e aceita correção de qualquer refeição ("no café foram 3 ovos") ou apagar o
 * registro. Perguntar "quantas calorias tem isso?" é consulta: responde e NÃO registra.
 */
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import {
  MEAL_SLOT_LABELS,
  mealSlotSchema,
  personaOf,
  type FoodDraftItem,
  type FoodLogItem,
  type MealSlot,
  type NutritionPlanStructure,
} from '@movivo/shared';

import type { AgentContextSources } from '../../core/agents/agent-context';
import { AgentRunner, AgentTaskError } from '../../core/agents/agent-runner';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { foodLogAckTask, type FoodLogAckInput } from '../nutrition/food-chat-tasks';
import {
  foodLogMessage,
  foodLogRemovedMessage,
  foodQueryMessage,
  waterMessage,
} from '../nutrition/food-chat';
import { FoodLogService, type FoodReading, type PhotoInput } from '../nutrition/food-log.service';
import { targetKcal, trackedSlots } from '../nutrition/meal-routine';
import { addDays } from '../planning/calc/week-planner';
import { StudentStateReader } from '../student-state/student-state.reader';
import { addWaterToDay } from '../training/daily-check-in';
import * as msg from './messages';

/** O aluno costuma responder ao lembrete em até 3 horas; depois disso a dica deixa de valer. */
export const PENDING_MEAL_TTL_SECONDS = 3 * 3_600;
const LAST_LOG_TTL_SECONDS = 2 * 3_600;
/** "Comi" depois de uma consulta só vale enquanto a consulta ainda é o assunto. */
const QUERY_TTL_SECONDS = 30 * 60;

/** Refeição guardada no Redis (texto) como `MealSlot`, ou `null` se não for uma. */
export function asMealSlot(raw: string | null): MealSlot | null {
  return (mealSlotSchema.options as readonly string[]).includes(raw ?? '')
    ? (raw as MealSlot)
    : null;
}

export interface FoodChatReply {
  /** LOGGED = o diário mudou; ANSWERED = só consulta; ASKED = faltou informação. */
  status: 'LOGGED' | 'ASKED' | 'ANSWERED';
  messages: string[];
}

/** Qual registro o aluno quer corrigir: a refeição que ele citou e se é de ontem. */
export interface CorrectionTarget {
  meal?: MealSlot | null;
  yesterday?: boolean;
}

const planForPrompt = (plan: NutritionPlanStructure | null) =>
  plan
    ? plan.meals
        .filter((meal) => (meal.options?.length ?? 0) > 0)
        .map((meal) => ({
          slot: meal.slot,
          options: (meal.options ?? []).map((option) => ({
            title: option.title,
            items: option.items.map((item) => ({ label: item.name, grams: item.grams })),
          })),
        }))
    : null;

const asLogItems = (items: readonly FoodDraftItem[]): FoodLogItem[] =>
  items.map(({ matchedName: _matched, ...rest }) => rest);

/**
 * Itens que não vieram da TACO: os de composição estimada pelo agente (mesmo os que ele acabou de
 * incluir na base) e os que ficaram sem número nenhum.
 */
export function outsideTable(items: readonly FoodLogItem[]): {
  estimatedLabels: string[];
  unmatchedLabels: string[];
} {
  return {
    estimatedLabels: items.filter((item) => item.estimatedPer100g).map((item) => item.label),
    unmatchedLabels: items
      .filter((item) => item.foodItemId === null && !item.estimatedPer100g)
      .map((item) => item.label),
  };
}

@Injectable()
export class FoodChatService {
  constructor(
    private readonly foods: FoodLogService,
    private readonly runner: AgentRunner,
    private readonly state: StudentStateReader,
    private readonly methodology: PublishedMethodologyReader,
    private readonly db: TenantDatabase,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(FoodChatService.name);
  }

  /** O lembrete de refeição marca qual refeição o aluno provavelmente vai registrar. */
  async markPending(userId: string, slot: MealSlot): Promise<void> {
    await this.redis.set(this.pendingKey(userId), slot, 'EX', PENDING_MEAL_TTL_SECONDS);
  }

  async logText(userId: string, text: string, now: Date = new Date()): Promise<FoodChatReply> {
    const [pendingMeal, plan, queried] = await Promise.all([
      this.pendingMeal(userId),
      this.foods.activePlan(userId),
      this.queried(userId),
    ]);
    const draft = await this.foods.draftFromText(userId, { text }, now, {
      ...(pendingMeal ? { pendingMeal } : {}),
      ...(queried ? { queried } : {}),
      plan: planForPrompt(plan),
    });
    if (draft.items.length === 0) {
      // O rascunho vazio não serve para nada: não fica pendurado no dia do aluno.
      await this.foods.remove(userId, draft.logId);
      return {
        status: 'ASKED',
        messages: [draft.needsClarification ?? msg.FOOD_CLARIFICATION_FALLBACK],
      };
    }
    return this.finish(userId, draft.logId, draft.meal, asLogItems(draft.items), 'TEXT', now);
  }

  async logPhoto(
    userId: string,
    photo: PhotoInput,
    caption: string | null,
    now: Date = new Date(),
  ): Promise<FoodChatReply> {
    const pendingMeal = await this.pendingMeal(userId);
    const draft = await this.foods.draftFromPhoto(
      userId,
      photo,
      { ...(pendingMeal ? { meal: pendingMeal } : {}), ...(caption ? { caption } : {}) },
      now,
    );
    if (draft.items.length === 0) {
      await this.foods.remove(userId, draft.logId);
      return { status: 'ASKED', messages: [msg.FOOD_CLARIFICATION_FALLBACK] };
    }
    return this.finish(userId, draft.logId, draft.meal, asLogItems(draft.items), 'PHOTO', now);
  }

  /**
   * Consulta por texto ou áudio ("quantas calorias tem uma manga?"): responde os números e NÃO
   * registra. O que foi consultado fica guardado por alguns minutos: se ele disser "comi", vira
   * registro sem precisar repetir.
   */
  async queryText(userId: string, text: string, now: Date = new Date()): Promise<FoodChatReply> {
    const plan = await this.foods.activePlan(userId);
    const reading = await this.foods.readText(userId, { text }, now, { plan: planForPrompt(plan) });
    if (reading.items.length === 0) {
      return {
        status: 'ASKED',
        messages: [reading.needsClarification ?? msg.FOOD_QUERY_CLARIFICATION],
      };
    }
    return this.answerQuery(userId, reading, false);
  }

  /** Consulta por foto com legenda de pergunta ("quantas calorias tem isso?"): não registra. */
  async queryPhoto(
    userId: string,
    photo: PhotoInput,
    caption: string | null,
    now: Date = new Date(),
  ): Promise<FoodChatReply> {
    const reading = await this.foods.readPhoto(userId, photo, caption ? { caption } : {}, now);
    if (!reading || reading.items.length === 0) {
      return { status: 'ASKED', messages: [msg.FOOD_QUERY_CLARIFICATION] };
    }
    return this.answerQuery(userId, reading, true);
  }

  /**
   * Correção de um registro pelo chat. O alvo é a refeição que o aluno citou ("no café da manhã
   * foram 3 ovos", inclusive de ontem); sem citar, o último registro feito pelo chat e, na falta
   * dele, o mais recente de hoje. Também apaga o registro inteiro ("não comi isso, apaga").
   * `null` = não há registro para corrigir (quem chama trata como registro novo).
   */
  async correct(
    userId: string,
    text: string,
    target: CorrectionTarget = {},
    now: Date = new Date(),
  ): Promise<FoodChatReply | null> {
    const today = (await this.foods.day(userId, undefined, now)).today;
    const date = target.yesterday ? addDays(today, -1) : today;
    const lastId = await this.redis.get(this.lastKey(userId));
    const previous =
      target.meal || target.yesterday
        ? await this.foods.latestLog(userId, date, target.meal ?? undefined)
        : ((lastId ? await this.foods.find(userId, lastId) : null) ??
          (await this.foods.latestLog(userId, today)));
    if (!previous) return null;

    const reading = await this.foods.readText(userId, { text }, now, {
      previous: {
        meal: previous.meal,
        items: previous.items.map((i) => ({ label: i.label, grams: i.grams })),
      },
    });
    if (reading.discard) {
      await this.foods.remove(userId, previous.id);
      if (lastId === previous.id) await this.redis.del(this.lastKey(userId));
      const day = await this.foods.day(userId, undefined, now);
      return {
        status: 'LOGGED',
        messages: [
          foodLogRemovedMessage({
            meal: previous.meal,
            day: {
              totals: day.totals,
              targetKcal: day.targets ? targetKcal(day.targets) : null,
              targetProteinG: day.targets?.proteinG ?? null,
            },
            otherDay: previous.loggedOn !== today,
          }),
        ],
      };
    }
    if (reading.items.length === 0) {
      return {
        status: 'ASKED',
        messages: [reading.needsClarification ?? msg.FOOD_CLARIFICATION_FALLBACK],
      };
    }
    const items = asLogItems(reading.items);
    await this.foods.replaceItems(userId, previous.id, reading.meal, items);
    await this.redis.set(this.lastKey(userId), previous.id, 'EX', LAST_LOG_TTL_SECONDS);
    // O dia mostrado é o do registro corrigido (o último do chat pode ser de antes da meia-noite).
    return this.reply(userId, previous.id, reading.meal, items, 'TEXT', now, {
      corrected: true,
      date: previous.loggedOn,
    });
  }

  async addWater(userId: string, ml: number, now: Date = new Date()): Promise<FoodChatReply> {
    const day = await this.foods.day(userId, undefined, now);
    const total = await this.db.runAsUser(userId, 'USER', (tx) =>
      addWaterToDay(tx, userId, day.today, ml),
    );
    return { status: 'LOGGED', messages: [waterMessage(ml, total, day.targets?.waterMl ?? null)] };
  }

  // --- Internos ---------------------------------------------------------------------------

  private async answerQuery(
    userId: string,
    reading: FoodReading,
    fromPhoto: boolean,
  ): Promise<FoodChatReply> {
    const items = asLogItems(reading.items);
    await this.redis.set(
      this.queryKey(userId),
      JSON.stringify(items.map((item) => ({ label: item.label, grams: item.grams }))),
      'EX',
      QUERY_TTL_SECONDS,
    );
    return {
      status: 'ANSWERED',
      messages: [
        foodQueryMessage({
          items,
          totals: reading.totals,
          portionsEstimated: fromPhoto,
          ...outsideTable(items),
        }),
      ],
    };
  }

  private async finish(
    userId: string,
    logId: string,
    meal: MealSlot,
    items: FoodLogItem[],
    source: 'TEXT' | 'PHOTO',
    now: Date,
  ): Promise<FoodChatReply> {
    await this.foods.confirm(userId, logId, { meal, items });
    await this.redis.set(this.lastKey(userId), logId, 'EX', LAST_LOG_TTL_SECONDS);
    await this.redis.del(this.pendingKey(userId), this.queryKey(userId));
    return this.reply(userId, logId, meal, items, source, now, { corrected: false });
  }

  private async reply(
    userId: string,
    logId: string,
    meal: MealSlot,
    items: FoodLogItem[],
    source: 'TEXT' | 'PHOTO',
    now: Date,
    options: { corrected: boolean; date?: string },
  ): Promise<FoodChatReply> {
    const [day, plan] = await Promise.all([
      this.foods.day(userId, options.date, now),
      this.foods.activePlan(userId),
    ]);
    const otherDay = day.date !== day.today;
    const confirmed = day.logs.filter((log) => log.confirmed);
    const own = confirmed.find((log) => log.id === logId);
    const mealTotals = own?.totals ?? { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
    const mid = day.targets ? targetKcal(day.targets) : null;
    const plannedMeal = plan?.meals.find((m) => m.slot === meal);
    const loggedSlots = new Set(confirmed.map((log) => log.meal));
    const remaining =
      plan && !otherDay ? trackedSlots(plan).filter((slot) => !loggedSlots.has(slot)) : [];
    const outside = outsideTable(items);

    const comment = await this.comment(userId, now, {
      firstName: day.firstName,
      mealLabel: MEAL_SLOT_LABELS[meal],
      items: items.map((i) => ({ label: i.label, grams: i.grams })),
      meal: {
        energyKcal: Math.round(mealTotals.energyKcal),
        proteinG: Math.round(mealTotals.proteinG),
        carbsG: Math.round(mealTotals.carbsG),
        fatG: Math.round(mealTotals.fatG),
      },
      planned:
        plannedMeal && mid
          ? {
              energyKcal: Math.round(plannedMeal.energyShare * mid),
              proteinG: plannedMeal.proteinG,
            }
          : null,
      dayTotals: day.totals,
      dayTargets: day.targets
        ? {
            energyMinKcal: day.targets.energyKcal.min,
            energyMaxKcal: day.targets.energyKcal.max,
            proteinG: day.targets.proteinG,
          }
        : null,
      remainingMeals: remaining.map((slot) => MEAL_SLOT_LABELS[slot]),
      unmatchedItems: outside.unmatchedLabels.length,
      source,
    });
    const text = foodLogMessage({
      meal,
      items,
      mealTotals: {
        energyKcal: mealTotals.energyKcal,
        proteinG: mealTotals.proteinG,
        carbsG: mealTotals.carbsG,
        fatG: mealTotals.fatG,
      },
      day: {
        totals: day.totals,
        targetKcal: mid,
        targetProteinG: day.targets?.proteinG ?? null,
      },
      comment,
      portionsEstimated: source === 'PHOTO',
      ...outside,
      otherDay,
    });
    return {
      status: 'LOGGED',
      messages: [options.corrected ? `Corrigido! ${text}` : text],
    };
  }

  /** Observação do nutricionista; se o agente falhar, a mensagem segue só com os números. */
  private async comment(userId: string, now: Date, input: FoodLogAckInput): Promise<string | null> {
    try {
      const run = await this.runner.run(foodLogAckTask, input, {
        userId,
        sources: this.sources(userId, now),
        persona: await this.personaFor(userId, now),
      });
      return run.output.comment;
    } catch (error) {
      if (!(error instanceof AgentTaskError)) throw error;
      this.logger.warn(
        { userId, taskId: error.taskId },
        'registro sem comentário do nutricionista',
      );
      return null;
    }
  }

  private async personaFor(userId: string, now: Date) {
    const read = await this.state.read(userId, ['identity'], now);
    const sex = (read.slices.identity as { biologicalSex?: string | null } | undefined)
      ?.biologicalSex;
    return personaOf(sex);
  }

  private sources(userId: string, now: Date): AgentContextSources {
    return {
      methodology: (domains) => this.methodology.render(domains),
      state: (slices) => this.state.read(userId, slices, now),
    };
  }

  private async pendingMeal(userId: string): Promise<MealSlot | null> {
    const raw = await this.redis.get(this.pendingKey(userId));
    return asMealSlot(raw);
  }

  /** Itens da última consulta sem registro, se ainda for recente. */
  private async queried(userId: string): Promise<{ label: string; grams: number }[] | null> {
    const raw = await this.redis.get(this.queryKey(userId));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { label: string; grams: number }[];
      return Array.isArray(parsed) && parsed.length > 0 ? parsed.slice(0, 20) : null;
    } catch {
      return null;
    }
  }

  private pendingKey(userId: string) {
    return this.keys.forUser(userId, 'meal-log', 'pending');
  }

  private lastKey(userId: string) {
    return this.keys.forUser(userId, 'meal-log', 'last');
  }

  private queryKey(userId: string) {
    return this.keys.forUser(userId, 'meal-log', 'query');
  }
}
