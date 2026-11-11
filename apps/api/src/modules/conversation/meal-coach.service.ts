/**
 * Orientação alimentar no momento: o aluno avisa que não pode seguir a refeição do plano e o
 * nutricionista conversa com ele (pergunta o que há em casa, monta a refeição possível com
 * preparo e diz como equilibrar o resto do dia). Os números da refeição saem da base de
 * alimentos; se a refeição montada fugir da meta, o agente refaz uma vez.
 */
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { MEAL_SLOT_LABELS, personaOf, type MealSlot } from '@movivo/shared';

import type { AgentContextSources } from '../../core/agents/agent-context';
import { AgentRunner, AgentTaskError } from '../../core/agents/agent-runner';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { PublishedMethodologyReader } from '../methodology/published-methodology.reader';
import { WHATSAPP_BUBBLE_SEPARATOR } from '../jobs/whatsapp-outbound.contract';
import { mealTarget } from '../planning/calc/menu';
import { FoodLogService } from '../nutrition/food-log.service';
import {
  ADAPT_ENERGY_TOLERANCE,
  mealAdaptTask,
  type MealAdaptInput,
  type MealAdaptOutput,
} from '../nutrition/meal-adapt-task';
import { trackedSlots } from '../nutrition/meal-routine';
import { StudentStateReader } from '../student-state/student-state.reader';
import { asMealSlot } from './food-chat.service';
import { mealByClock } from './meal-clock';
import * as msg from './messages';

export interface MealCoachRequest {
  userId: string;
  text: string;
  slot: MealSlot | null;
  avoid: string | null;
  pantry: string | null;
  dietaryRestrictions: string[];
  timezone: string | null;
  now: Date;
}

export interface MealCoachReply {
  status: 'ASKED' | 'ANSWERED' | 'INFORMED';
  reply: string;
}

const num = (n: number) => Math.round(n).toLocaleString('pt-BR');

@Injectable()
export class MealCoachService {
  constructor(
    private readonly foods: FoodLogService,
    private readonly runner: AgentRunner,
    private readonly state: StudentStateReader,
    private readonly methodology: PublishedMethodologyReader,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(MealCoachService.name);
  }

  async handle(request: MealCoachRequest): Promise<MealCoachReply> {
    const { userId, now } = request;
    const plan = await this.foods.activePlan(userId);
    if (!plan) return { status: 'INFORMED', reply: msg.NO_NUTRITION_PLAN_MESSAGE };

    const pending = asMealSlot(
      await this.redis.get(this.keys.forUser(userId, 'meal-log', 'pending')),
    );
    const slot =
      request.slot ??
      pending ??
      mealByClock(
        plan.meals.map((m) => m.slot),
        now,
        request.timezone,
      );
    const meal = plan.meals.find((m) => m.slot === slot);
    if (!meal) {
      return {
        status: 'ASKED',
        reply: msg.askMealMessage(plan.meals.map((m) => MEAL_SLOT_LABELS[m.slot])),
      };
    }

    const day = await this.foods.day(userId, undefined, now);
    const target = mealTarget(meal, plan);
    const loggedSlots = new Set(day.logs.filter((l) => l.confirmed).map((l) => l.meal));
    const order = trackedSlots(plan);
    const laterMeals = order
      .slice(order.indexOf(meal.slot) + 1)
      .filter((s) => !loggedSlots.has(s))
      .map((s) => MEAL_SLOT_LABELS[s]);
    const targets = day.targets;
    const input: MealAdaptInput = {
      message: request.text,
      meal: {
        slot: meal.slot,
        label: MEAL_SLOT_LABELS[meal.slot],
        targetKcal: Math.round(target.energyKcal),
        targetProteinG: meal.proteinG,
        options: (meal.options ?? []).map((option) => ({
          title: option.title,
          items: option.items.map((item) => ({
            name: item.name,
            grams: item.grams,
            swaps: item.swaps.map((swap) => swap.name),
          })),
        })),
      },
      day: {
        dayType: day.dayType,
        strategy: plan.strategy,
        targetEnergyMinKcal: targets?.energyKcal.min ?? 0,
        targetEnergyMaxKcal: targets?.energyKcal.max ?? 0,
        targetProteinG: targets?.proteinG ?? 0,
        consumedKcal: day.totals.energyKcal,
        consumedProteinG: day.totals.proteinG,
        laterMeals,
      },
      pantry: request.pantry,
      avoid: request.avoid,
      dietaryRestrictions: request.dietaryRestrictions,
      previousIssue: null,
    };

    const sources = this.sources(userId, now);
    const persona = await this.persona(userId, now);
    let issue: string | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let output: MealAdaptOutput;
      try {
        output = (
          await this.runner.run(
            mealAdaptTask,
            { ...input, previousIssue: issue },
            { userId, sources, persona },
          )
        ).output;
      } catch (error) {
        if (!(error instanceof AgentTaskError)) throw error;
        this.logger.warn(
          { userId, taskId: error.taskId },
          'orientação de refeição sem saída válida',
        );
        return { status: 'INFORMED', reply: msg.MEAL_SUGGESTION_FAILED_MESSAGE };
      }
      if (output.action === 'ASK_PANTRY' || !output.meal) {
        return { status: 'ASKED', reply: output.reply };
      }
      const estimate = await this.foods.estimate(output.meal.items);
      const kcal = estimate.totals.energyKcal;
      const off = Math.abs(kcal - input.meal.targetKcal) / input.meal.targetKcal;
      if (estimate.totals.unmatchedItems > 0) {
        issue = `${estimate.totals.unmatchedItems} item(ns) que a tabela de alimentos não reconheceu: use nomes de tabela (ex.: "pão francês", "queijo minas frescal")`;
      } else if (off > ADAPT_ENERGY_TOLERANCE && attempt === 0) {
        issue = `a refeição montada tem ${num(kcal)} kcal e a meta é ${num(input.meal.targetKcal)} kcal: ajuste as quantidades`;
      } else {
        const list = estimate.items.map((item) => `- ${item.grams} g de ${item.label}`).join('\n');
        const totals = `≈ ${num(kcal)} kcal · ${num(estimate.totals.proteinG)} g de proteína · ${num(estimate.totals.carbsG)} g de carboidrato · ${num(estimate.totals.fatG)} g de gordura`;
        return {
          status: 'ANSWERED',
          reply: [output.reply, `${list}\n${totals}`].join(WHATSAPP_BUBBLE_SEPARATOR),
        };
      }
    }
    return { status: 'INFORMED', reply: msg.MEAL_SUGGESTION_FAILED_MESSAGE };
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
