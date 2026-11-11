/**
 * Registro alimentar: interpretação de texto/foto em rascunho, confirmação pelo aluno e leitura
 * do dia. Os totais sempre vêm da base de alimentos (servidor); a foto só ajuda a identificar
 * itens e é descartada logo depois da análise.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import {
  FOOD_AI_CATEGORY,
  type ConfirmFoodLogRequest,
  type EstimatedNutrients,
  type FoodDay,
  type FoodDraftItem,
  type FoodLogDraft,
  type FoodLogItem,
  type InterpretFoodTextRequest,
  type ManualFoodLogRequest,
  type MealSlot,
  type NutrientTotals,
  type NutritionPlanStructure,
} from '@movivo/shared';

import { AgentRunner, AgentTaskError } from '../../core/agents/agent-runner';
import {
  foodLogs,
  nutritionPlans,
  scheduledSessions,
  sessionExecutions,
  users,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { FoodCatalogService, type FoodMatch } from '../catalog/foods/food-catalog.service';
import { DomainEventRecorder } from '../domain-events/domain-event-recorder';
import { OutboxRelay } from '../domain-events/outbox-relay';
import { localParts } from '../training/eligibility';
import { todayIn } from '../planning/plan-generation.service';
import { foodLogTask, type FoodLogInput, type FoodLogOutput } from './food-log-task';
import { foodResolveTask } from './food-resolve-task';
import { mealPhotoTask } from '../vision/vision-tasks';

const NO_CONTEXT = {
  methodology: async () => ({ text: '', versions: {} }),
  state: async () => ({ slices: {}, version: 0 }),
};

/**
 * Contexto extra da conversa: refeição do último lembrete, cardápio do plano, registro a corrigir
 * e o que o aluno acabou de consultar (sem registrar).
 */
export type FoodTextContext = Partial<
  Pick<FoodLogInput, 'pendingMeal' | 'plan' | 'previous' | 'queried'>
>;

/** Item interpretado (texto ou foto), antes de casar com a base de alimentos. */
export type InterpretedItem = Pick<FoodLogItem, 'label' | 'grams' | 'portionSource'>;

/** O que o aluno disse ou mostrou, já casado com a base, sem nada gravado. */
export interface FoodReading {
  meal: MealSlot;
  items: FoodDraftItem[];
  totals: NutrientTotals;
  needsClarification: string | null;
  /** O aluno pediu para apagar o registro inteiro (só em correção). */
  discard: boolean;
}

export interface PhotoInput {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
}

@Injectable()
export class FoodLogService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly runner: AgentRunner,
    private readonly foods: FoodCatalogService,
    private readonly events: DomainEventRecorder,
    private readonly outbox: OutboxRelay,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(FoodLogService.name);
  }

  /** Texto livre → rascunho (não confirmado). */
  async draftFromText(
    userId: string,
    request: InterpretFoodTextRequest,
    now: Date = new Date(),
    context: FoodTextContext = {},
  ): Promise<FoodLogDraft> {
    const { today, output } = await this.interpretText(userId, request, now, context);
    return this.saveDraft(
      userId,
      output.meal,
      output.items,
      'TEXT',
      today,
      output.needsClarification,
    );
  }

  /**
   * Texto livre → leitura com totais, SEM gravar nada: é o que responde "quantas calorias tem
   * isso?" e o que interpreta uma correção antes de mexer no registro.
   */
  async readText(
    userId: string,
    request: InterpretFoodTextRequest,
    now: Date = new Date(),
    context: FoodTextContext = {},
  ): Promise<FoodReading> {
    const { output } = await this.interpretText(userId, request, now, context);
    const items = await this.match(userId, output.items);
    return {
      meal: output.meal,
      items,
      totals: await this.foods.totals(items),
      needsClarification: output.needsClarification,
      discard: output.discard === true,
    };
  }

  /** Foto → leitura com totais, SEM gravar nada (consulta). `null` = a foto não mostra comida. */
  async readPhoto(
    userId: string,
    photo: PhotoInput,
    options: { meal?: MealSlot; caption?: string } = {},
    now: Date = new Date(),
  ): Promise<FoodReading | null> {
    const seen = await this.interpretPhoto(userId, photo, options, now);
    if (!seen) return null;
    const items = await this.match(userId, seen.items);
    return {
      meal: seen.meal,
      items,
      totals: await this.foods.totals(items),
      needsClarification: null,
      discard: false,
    };
  }

  private async interpretText(
    userId: string,
    request: InterpretFoodTextRequest,
    now: Date,
    context: FoodTextContext,
  ): Promise<{ today: string; output: FoodLogOutput }> {
    const { today, localTime } = await this.clock(userId, now);
    const run = await this.runner.run(
      foodLogTask,
      {
        text: request.text,
        mealHint: request.meal ?? null,
        localTime,
        ...(context.pendingMeal ? { pendingMeal: context.pendingMeal } : {}),
        ...(context.plan ? { plan: context.plan } : {}),
        ...(context.previous ? { previous: context.previous } : {}),
        ...(context.queried ? { queried: context.queried } : {}),
      },
      { userId, sources: NO_CONTEXT },
    );
    return { today, output: run.output };
  }

  /** Foto → rascunho (não confirmado). A imagem não é guardada. */
  async draftFromPhoto(
    userId: string,
    photo: PhotoInput,
    options: { meal?: MealSlot; caption?: string } = {},
    now: Date = new Date(),
  ): Promise<FoodLogDraft> {
    const seen = await this.interpretPhoto(userId, photo, options, now);
    if (!seen) {
      throw new BadRequestException(
        'Não identificamos comida nesta foto. Tente outra ou descreva a refeição.',
      );
    }
    return this.saveDraft(userId, seen.meal, seen.items, 'PHOTO', seen.today, null);
  }

  /** Itens e refeição que a foto mostra; `null` se não há comida. */
  private async interpretPhoto(
    userId: string,
    photo: PhotoInput,
    options: { meal?: MealSlot; caption?: string },
    now: Date,
  ): Promise<{ today: string; meal: MealSlot; items: InterpretedItem[] } | null> {
    const { today, localTime } = await this.clock(userId, now);
    const run = await this.runner.run(
      mealPhotoTask,
      { mealHint: options.meal ?? null, caption: options.caption ?? null },
      {
        userId,
        sources: NO_CONTEXT,
        images: [{ type: 'image', mediaType: photo.mediaType, base64: photo.base64 }],
      },
    );
    if (run.output.notFood) return null;
    const meal = options.meal ?? run.output.mealSlotGuess ?? mealByTime(localTime);
    const items = run.output.items.map((item) => ({
      label: item.label,
      grams: Math.round(item.estimatedGrams),
      portionSource: 'ESTIMATED' as const,
    }));
    return { today, meal, items };
  }

  /** O aluno confirma (e pode ter corrigido) o rascunho: os totais são recalculados na base. */
  async confirm(userId: string, logId: string, request: ConfirmFoodLogRequest): Promise<void> {
    const totals = await this.foods.totals(request.items);
    await this.db.runAsUser(userId, 'USER', async (tx) => {
      const [row] = await tx
        .update(foodLogs)
        .set({
          meal: request.meal,
          items: request.items,
          totals,
          confirmed: true,
          hunger: request.hunger ?? null,
        })
        .where(and(eq(foodLogs.id, logId), eq(foodLogs.userId, userId)))
        .returning({ id: foodLogs.id, loggedOn: foodLogs.loggedOn });
      if (!row) throw new NotFoundException();
      await this.events.record(tx, {
        userId,
        type: 'FoodLogged',
        payload: { foodLogId: row.id, loggedOn: row.loggedOn, meal: request.meal },
      });
    });
    await this.outbox.flushSoon();
  }

  /** Registro direto (sem interpretação), já confirmado. */
  async addManual(userId: string, request: ManualFoodLogRequest, now: Date = new Date()) {
    const { today } = await this.clock(userId, now);
    const loggedOn = request.loggedOn ?? today;
    if (loggedOn > today)
      throw new BadRequestException('Não dá para registrar refeição em data futura.');
    const totals = await this.foods.totals(request.items);
    const id = await this.db.runAsUser(userId, 'USER', async (tx) => {
      const [row] = await tx
        .insert(foodLogs)
        .values({
          userId,
          loggedOn,
          meal: request.meal,
          items: request.items,
          totals,
          source: 'MANUAL',
          confirmed: true,
          hunger: request.hunger ?? null,
        })
        .returning({ id: foodLogs.id });
      if (!row) throw new Error('falha ao registrar a refeição');
      await this.events.record(tx, {
        userId,
        type: 'FoodLogged',
        payload: { foodLogId: row.id, loggedOn, meal: request.meal },
      });
      return row.id;
    });
    await this.outbox.flushSoon();
    return { id };
  }

  /** Corrige um registro já confirmado (itens e refeição): os totais são recalculados na base. */
  async replaceItems(
    userId: string,
    logId: string,
    meal: MealSlot,
    items: FoodLogItem[],
  ): Promise<NutrientTotals> {
    const totals = await this.foods.totals(items);
    const updated = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .update(foodLogs)
        .set({ meal, items, totals })
        .where(and(eq(foodLogs.id, logId), eq(foodLogs.userId, userId)))
        .returning({ id: foodLogs.id }),
    );
    if (updated.length === 0) throw new NotFoundException();
    return totals;
  }

  /** Casa itens em texto livre com a base de alimentos e calcula os totais (sem gravar nada). */
  async estimate(
    items: readonly { label: string; grams: number }[],
  ): Promise<{ items: FoodLogItem[]; totals: NutrientTotals }> {
    const matched: FoodLogItem[] = [];
    for (const item of items) {
      const [best] = await this.foods.search(item.label, 1);
      matched.push({
        foodItemId: best?.id ?? null,
        label: item.label,
        grams: item.grams,
        portionSource: 'ESTIMATED',
      });
    }
    return { items: matched, totals: await this.foods.totals(matched) };
  }

  /**
   * Casa cada item com a base de alimentos. O que a busca direta não acha vai ao nutricionista
   * de IA com os parecidos da tabela: ele aponta o mesmo alimento com outro nome ou, se a tabela
   * não tem, devolve a composição estimada por 100 g, que passa a contar nos totais (e é dita ao
   * aluno como estimativa). Se o agente falhar, o item segue sem correspondência.
   */
  async match(userId: string, items: readonly InterpretedItem[]): Promise<FoodDraftItem[]> {
    const matched: FoodDraftItem[] = [];
    const pending: { position: number; label: string; candidates: FoodMatch[] }[] = [];
    for (const [position, item] of items.entries()) {
      const [best] = await this.foods.search(item.label, 1);
      matched.push({
        foodItemId: best?.id ?? null,
        label: item.label,
        grams: item.grams,
        portionSource: item.portionSource,
        matchedName: best?.name ?? null,
        // Alimento que o agente incluiu antes: o valor continua sendo estimativa e o aluno é avisado.
        ...(best?.category === FOOD_AI_CATEGORY
          ? {
              estimatedPer100g: {
                energyKcal: best.per100g.energyKcal,
                proteinG: best.per100g.proteinG,
                carbsG: best.per100g.carbsG,
                fatG: best.per100g.fatG,
                fiberG: best.per100g.fiberG ?? 0,
              },
            }
          : {}),
      });
      if (!best) {
        pending.push({
          position,
          label: item.label,
          candidates: await this.foods.candidates(item.label, 10),
        });
      }
    }
    if (pending.length === 0) return matched;
    try {
      const run = await this.runner.run(
        foodResolveTask,
        {
          items: pending.map((p, index) => ({
            index,
            label: p.label,
            candidates: p.candidates.map((c) => ({
              id: c.id,
              name: c.name,
              energyKcalPer100g: Math.round(c.per100g.energyKcal),
            })),
          })),
        },
        { userId, sources: NO_CONTEXT },
      );
      for (const answer of run.output.items) {
        const target = pending[answer.index];
        const current = target ? matched[target.position] : undefined;
        if (!target || !current) continue;
        const chosen = target.candidates.find((c) => c.id === answer.foodItemId);
        if (chosen) {
          matched[target.position] = {
            ...current,
            foodItemId: chosen.id,
            matchedName: chosen.name,
          };
        } else if (answer.estimate) {
          // A TACO não tem o alimento: a estimativa entra na base e vale para os próximos
          // registros de todos. Se a inclusão falhar, o registro de agora segue com a estimativa.
          const added = await this.addToTable(current.label, answer.estimate);
          matched[target.position] = {
            ...current,
            ...(added ? { foodItemId: added.id, matchedName: added.name } : {}),
            estimatedPer100g: answer.estimate,
          };
        }
      }
    } catch (error) {
      if (!(error instanceof AgentTaskError)) throw error;
      this.logger.warn(
        { userId, taskId: error.taskId, items: pending.length },
        'alimentos fora da tabela sem resolução: seguem sem correspondência',
      );
    }
    return matched;
  }

  /** Estrutura do plano alimentar ativo, se houver. */
  async activePlan(userId: string): Promise<NutritionPlanStructure | null> {
    const [plan] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({ structure: nutritionPlans.structure })
        .from(nutritionPlans)
        .where(and(eq(nutritionPlans.userId, userId), eq(nutritionPlans.status, 'ACTIVE'))),
    );
    return plan?.structure ?? null;
  }

  /**
   * O registro confirmado mais recente do dia (de uma refeição, se `meal` vier): é o alvo de uma
   * correção pelo chat quando o aluno cita a refeição ("no café foram 3 ovos").
   */
  async latestLog(userId: string, date: string, meal?: MealSlot) {
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({
          id: foodLogs.id,
          meal: foodLogs.meal,
          items: foodLogs.items,
          loggedOn: foodLogs.loggedOn,
        })
        .from(foodLogs)
        .where(
          and(
            eq(foodLogs.userId, userId),
            eq(foodLogs.loggedOn, date),
            eq(foodLogs.confirmed, true),
            ...(meal ? [eq(foodLogs.meal, meal)] : []),
          ),
        )
        .orderBy(asc(foodLogs.createdAt)),
    );
    const row = rows.at(-1);
    return row
      ? { id: row.id, meal: row.meal as MealSlot, items: row.items, loggedOn: row.loggedOn }
      : null;
  }

  /** Um registro do aluno (para corrigir pelo chat). */
  async find(userId: string, logId: string) {
    const [row] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({
          id: foodLogs.id,
          meal: foodLogs.meal,
          items: foodLogs.items,
          loggedOn: foodLogs.loggedOn,
        })
        .from(foodLogs)
        .where(and(eq(foodLogs.id, logId), eq(foodLogs.userId, userId))),
    );
    return row
      ? { id: row.id, meal: row.meal as MealSlot, items: row.items, loggedOn: row.loggedOn }
      : null;
  }

  async remove(userId: string, logId: string): Promise<void> {
    // DELETE em tabela do titular só existe em contexto de sistema (RLS): a posse é checada
    // pelo `user_id` do aluno autenticado na própria cláusula.
    const removed = await this.db.runAsSystem((tx) =>
      tx
        .delete(foodLogs)
        .where(and(eq(foodLogs.id, logId), eq(foodLogs.userId, userId)))
        .returning({ id: foodLogs.id }),
    );
    if (removed.length === 0) throw new NotFoundException();
  }

  async search(query: string) {
    const matches = await this.foods.search(query, 8);
    return matches.map((m) => ({ id: m.id, name: m.name, category: m.category }));
  }

  /** O dia: meta (treino ou descanso), refeições e totais confirmados. */
  async day(userId: string, requested?: string, now: Date = new Date()): Promise<FoodDay> {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const [user] = await tx
        .select({ name: users.name, timezone: users.timezone })
        .from(users)
        .where(eq(users.id, userId));
      const today = todayIn(user?.timezone ?? null, now);
      const date = requested ?? today;
      const [plan] = await tx
        .select({ structure: nutritionPlans.structure })
        .from(nutritionPlans)
        .where(and(eq(nutritionPlans.userId, userId), eq(nutritionPlans.status, 'ACTIVE')));
      const training = await tx
        .select({ id: scheduledSessions.id })
        .from(scheduledSessions)
        .where(
          and(
            eq(scheduledSessions.userId, userId),
            eq(scheduledSessions.scheduledOn, date),
            inArray(scheduledSessions.status, ['PLANNED', 'DONE', 'PARTIAL', 'MISSED']),
          ),
        )
        .limit(1);
      const executed = await tx
        .select({ id: sessionExecutions.id })
        .from(sessionExecutions)
        .where(and(eq(sessionExecutions.userId, userId), eq(sessionExecutions.performedOn, date)))
        .limit(1);
      const dayType = training.length > 0 || executed.length > 0 ? 'TRAINING' : 'REST';
      const logs = await tx
        .select()
        .from(foodLogs)
        .where(
          and(
            eq(foodLogs.userId, userId),
            gte(foodLogs.loggedOn, date),
            lte(foodLogs.loggedOn, date),
          ),
        )
        .orderBy(asc(foodLogs.createdAt));
      const confirmed = logs.filter((l) => l.confirmed);
      const sum = (pick: (t: (typeof logs)[number]['totals']) => number) =>
        Math.round(confirmed.reduce((s, l) => s + pick(l.totals), 0));
      return {
        firstName: user?.name?.trim().split(/\s+/)[0] ?? null,
        today,
        date,
        dayType,
        targets: plan
          ? dayType === 'TRAINING'
            ? plan.structure.trainingDay
            : plan.structure.restDay
          : null,
        logs: logs.map((l) => ({
          id: l.id,
          meal: l.meal as MealSlot,
          items: l.items,
          totals: l.totals,
          confirmed: l.confirmed,
        })),
        totals: {
          energyKcal: sum((t) => t.energyKcal),
          proteinG: sum((t) => t.proteinG),
          carbsG: sum((t) => t.carbsG),
          fatG: sum((t) => t.fatG),
          fiberG: sum((t) => t.fiberG),
        },
        hasPlan: Boolean(plan),
      };
    });
  }

  // --- Internos ---------------------------------------------------------------------------

  private async clock(userId: string, now: Date) {
    const [user] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId)),
    );
    const tz = user?.timezone ?? 'America/Sao_Paulo';
    return {
      today: todayIn(tz, now),
      localTime: localParts(now, tz)?.time ?? '12:00',
    };
  }

  private async addToTable(label: string, estimate: EstimatedNutrients) {
    try {
      const added = await this.foods.addEstimated(label, estimate);
      if (added) {
        // Só o nome do alimento (nunca dado do aluno): a equipe revisa o que o agente incluiu.
        this.logger.info(
          { event: 'food_added_by_agent', food: added.name },
          'alimento fora da TACO incluído na base com composição estimada',
        );
      }
      return added;
    } catch (error) {
      this.logger.warn(
        { err: error instanceof Error ? error.message : 'erro' },
        'alimento estimado não entrou na base',
      );
      return null;
    }
  }

  /** Casa cada item com a base de alimentos e grava o rascunho. */
  private async saveDraft(
    userId: string,
    meal: MealSlot,
    items: readonly InterpretedItem[],
    source: 'TEXT' | 'PHOTO',
    loggedOn: string,
    needsClarification: string | null,
  ): Promise<FoodLogDraft> {
    const matched = await this.match(userId, items);
    const logItems: FoodLogItem[] = matched.map(({ matchedName: _name, ...rest }) => rest);
    const totals = await this.foods.totals(logItems);
    const [row] = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .insert(foodLogs)
        .values({ userId, loggedOn, meal, items: logItems, totals, source, confirmed: false })
        .returning({ id: foodLogs.id }),
    );
    if (!row) throw new Error('falha ao gravar o rascunho');
    return { logId: row.id, meal, items: matched, totals, needsClarification };
  }
}

/** Refeição provável pelo horário local (HH:mm). */
export function mealByTime(localTime: string): MealSlot {
  const hour = Number(localTime.slice(0, 2));
  if (hour < 10) return 'BREAKFAST';
  if (hour < 12) return 'MORNING_SNACK';
  if (hour < 15) return 'LUNCH';
  if (hour < 18) return 'AFTERNOON_SNACK';
  if (hour < 22) return 'DINNER';
  return 'SUPPER';
}
