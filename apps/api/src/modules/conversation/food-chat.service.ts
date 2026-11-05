/**
 * Registro alimentar pelo WhatsApp: o aluno escreve, manda áudio (já transcrito) ou foto; a MOVIVO
 * interpreta, conta (totais pela base de alimentos, nunca pelo modelo) e responde com a lista, os
 * números do dia e a leitura curta do nutricionista. Corrigir também é conversa.
 *
 * O registro conta na hora: a foto e a estimativa podem errar, então a resposta sempre mostra o
 * que foi anotado e aceita correção ("na verdade foram 3 ovos").
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
import { foodLogMessage, waterMessage } from '../nutrition/food-chat';
import { FoodLogService, type PhotoInput } from '../nutrition/food-log.service';
import { targetKcal, trackedSlots } from '../nutrition/meal-routine';
import { StudentStateReader } from '../student-state/student-state.reader';
import { addWaterToDay } from '../training/daily-check-in';
import * as msg from './messages';

/** O aluno costuma responder ao lembrete em até 3 horas; depois disso a dica deixa de valer. */
export const PENDING_MEAL_TTL_SECONDS = 3 * 3_600;
const LAST_LOG_TTL_SECONDS = 2 * 3_600;

/** Refeição guardada no Redis (texto) como `MealSlot`, ou `null` se não for uma. */
export function asMealSlot(raw: string | null): MealSlot | null {
  return (mealSlotSchema.options as readonly string[]).includes(raw ?? '')
    ? (raw as MealSlot)
    : null;
}

export interface FoodChatReply {
  status: 'LOGGED' | 'ASKED';
  messages: string[];
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
    const [pendingMeal, plan] = await Promise.all([
      this.pendingMeal(userId),
      this.foods.activePlan(userId),
    ]);
    const draft = await this.foods.draftFromText(userId, { text }, now, {
      ...(pendingMeal ? { pendingMeal } : {}),
      plan: planForPrompt(plan),
    });
    if (draft.items.length === 0) {
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
      return { status: 'ASKED', messages: [msg.FOOD_CLARIFICATION_FALLBACK] };
    }
    return this.finish(userId, draft.logId, draft.meal, asLogItems(draft.items), 'PHOTO', now);
  }

  /** Correção do último registro feito pelo chat ("na verdade foram 3 ovos"). */
  async correctLast(
    userId: string,
    text: string,
    now: Date = new Date(),
  ): Promise<FoodChatReply | null> {
    const lastId = await this.redis.get(this.lastKey(userId));
    const previous = lastId ? await this.foods.find(userId, lastId) : null;
    if (!lastId || !previous) return null;
    const draft = await this.foods.draftFromText(userId, { text }, now, {
      previous: {
        meal: previous.meal,
        items: previous.items.map((i) => ({ label: i.label, grams: i.grams })),
      },
    });
    // O rascunho de correção só serviu para interpretar: o registro original é que muda.
    await this.foods.remove(userId, draft.logId);
    if (draft.items.length === 0) {
      return {
        status: 'ASKED',
        messages: [draft.needsClarification ?? msg.FOOD_CLARIFICATION_FALLBACK],
      };
    }
    const items = asLogItems(draft.items);
    await this.foods.replaceItems(userId, lastId, draft.meal, items);
    return this.reply(userId, lastId, draft.meal, items, 'TEXT', now, true);
  }

  async addWater(userId: string, ml: number, now: Date = new Date()): Promise<FoodChatReply> {
    const day = await this.foods.day(userId, undefined, now);
    const total = await this.db.runAsUser(userId, 'USER', (tx) =>
      addWaterToDay(tx, userId, day.today, ml),
    );
    return { status: 'LOGGED', messages: [waterMessage(ml, total, day.targets?.waterMl ?? null)] };
  }

  // --- Internos ---------------------------------------------------------------------------

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
    await this.redis.del(this.pendingKey(userId));
    return this.reply(userId, logId, meal, items, source, now, false);
  }

  private async reply(
    userId: string,
    logId: string,
    meal: MealSlot,
    items: FoodLogItem[],
    source: 'TEXT' | 'PHOTO',
    now: Date,
    corrected: boolean,
  ): Promise<FoodChatReply> {
    const [day, plan] = await Promise.all([
      this.foods.day(userId, undefined, now),
      this.foods.activePlan(userId),
    ]);
    const confirmed = day.logs.filter((log) => log.confirmed);
    const own = confirmed.find((log) => log.id === logId);
    const mealTotals = own?.totals ?? { energyKcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
    const mid = day.targets ? targetKcal(day.targets) : null;
    const plannedMeal = plan?.meals.find((m) => m.slot === meal);
    const loggedSlots = new Set(confirmed.map((log) => log.meal));
    const remaining = plan ? trackedSlots(plan).filter((slot) => !loggedSlots.has(slot)) : [];
    const unmatched = own?.totals.unmatchedItems ?? 0;

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
      unmatchedItems: unmatched,
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
      estimated: source === 'PHOTO' || unmatched > 0,
    });
    return {
      status: 'LOGGED',
      messages: [corrected ? `Corrigido! ${text}` : text],
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

  private pendingKey(userId: string) {
    return this.keys.forUser(userId, 'meal-log', 'pending');
  }

  private lastKey(userId: string) {
    return this.keys.forUser(userId, 'meal-log', 'last');
  }
}
