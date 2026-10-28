/**
 * Registro alimentar: interpretação de texto/foto em rascunho, confirmação pelo aluno e leitura
 * do dia. Os totais sempre vêm da base de alimentos (servidor); a foto só ajuda a identificar
 * itens e é descartada logo depois da análise.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';

import type {
  ConfirmFoodLogRequest,
  FoodDay,
  FoodDraftItem,
  FoodLogDraft,
  FoodLogItem,
  InterpretFoodTextRequest,
  ManualFoodLogRequest,
  MealSlot,
} from '@movivo/shared';

import { AgentRunner } from '../../core/agents/agent-runner';
import {
  foodLogs,
  nutritionPlans,
  scheduledSessions,
  sessionExecutions,
  users,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { FoodCatalogService } from '../catalog/foods/food-catalog.service';
import { DomainEventRecorder } from '../domain-events/domain-event-recorder';
import { OutboxRelay } from '../domain-events/outbox-relay';
import { localParts } from '../training/eligibility';
import { todayIn } from '../planning/plan-generation.service';
import { foodLogTask } from './food-log-task';
import { mealPhotoTask } from '../vision/vision-tasks';

const NO_CONTEXT = {
  methodology: async () => ({ text: '', versions: {} }),
  state: async () => ({ slices: {}, version: 0 }),
};

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
  ) {}

  /** Texto livre → rascunho (não confirmado). */
  async draftFromText(
    userId: string,
    request: InterpretFoodTextRequest,
    now: Date = new Date(),
  ): Promise<FoodLogDraft> {
    const { today, localTime } = await this.clock(userId, now);
    const run = await this.runner.run(
      foodLogTask,
      { text: request.text, mealHint: request.meal ?? null, localTime },
      { userId, sources: NO_CONTEXT },
    );
    const items = run.output.items.map((item) => ({
      label: item.label,
      grams: item.grams,
      portionSource: item.portionSource,
    }));
    return this.saveDraft(
      userId,
      run.output.meal,
      items,
      'TEXT',
      today,
      run.output.needsClarification,
    );
  }

  /** Foto → rascunho (não confirmado). A imagem não é guardada. */
  async draftFromPhoto(
    userId: string,
    photo: PhotoInput,
    options: { meal?: MealSlot; caption?: string } = {},
    now: Date = new Date(),
  ): Promise<FoodLogDraft> {
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
    if (run.output.notFood) {
      throw new BadRequestException(
        'Não identificamos comida nesta foto. Tente outra ou descreva a refeição.',
      );
    }
    const meal = options.meal ?? run.output.mealSlotGuess ?? mealByTime(localTime);
    const items = run.output.items.map((item) => ({
      label: item.label,
      grams: Math.round(item.estimatedGrams),
      portionSource: 'ESTIMATED' as const,
    }));
    return this.saveDraft(userId, meal, items, 'PHOTO', today, null);
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

  /** Casa cada item com a base de alimentos e grava o rascunho. */
  private async saveDraft(
    userId: string,
    meal: MealSlot,
    items: { label: string; grams: number; portionSource: FoodLogItem['portionSource'] }[],
    source: 'TEXT' | 'PHOTO',
    loggedOn: string,
    needsClarification: string | null,
  ): Promise<FoodLogDraft> {
    const matched: FoodDraftItem[] = [];
    for (const item of items) {
      const [best] = await this.foods.search(item.label, 1);
      matched.push({
        foodItemId: best?.id ?? null,
        label: item.label,
        grams: item.grams,
        portionSource: item.portionSource,
        matchedName: best?.name ?? null,
      });
    }
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
