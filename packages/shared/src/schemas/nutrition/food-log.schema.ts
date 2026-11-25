import { z } from 'zod';

import {
  dailyTargetsSchema,
  foodLogItemSchema,
  mealSlotSchema,
  nutrientTotalsSchema,
} from './nutrition.schema';

/** Rascunho de uma refeição interpretada de texto ou foto: nada conta até o aluno confirmar. */
export const foodDraftItemSchema = foodLogItemSchema.extend({
  /** Nome do alimento da base casado com o que foi dito/visto (para o aluno conferir). */
  matchedName: z.string().nullable(),
});
export type FoodDraftItem = z.infer<typeof foodDraftItemSchema>;

export const foodLogDraftSchema = z.object({
  logId: z.uuid(),
  meal: mealSlotSchema,
  items: z.array(foodDraftItemSchema).max(20),
  totals: nutrientTotalsSchema,
  /** Pergunta curta quando faltou informação para interpretar (ex.: "qual foi a porção?"). */
  needsClarification: z.string().nullable(),
});
export type FoodLogDraft = z.infer<typeof foodLogDraftSchema>;

export const interpretFoodTextRequestSchema = z.object({
  text: z.string().trim().min(2).max(500),
  meal: mealSlotSchema.optional(),
});
export type InterpretFoodTextRequest = z.infer<typeof interpretFoodTextRequestSchema>;

export const confirmFoodLogRequestSchema = z.object({
  meal: mealSlotSchema,
  items: z.array(foodLogItemSchema).min(1).max(20),
  /** Fome/saciedade relatada (1 = sem fome, 5 = muita fome). */
  hunger: z.number().int().min(1).max(5).optional(),
});
export type ConfirmFoodLogRequest = z.infer<typeof confirmFoodLogRequestSchema>;

export const manualFoodLogRequestSchema = confirmFoodLogRequestSchema.extend({
  loggedOn: z.iso.date().optional(),
});
export type ManualFoodLogRequest = z.infer<typeof manualFoodLogRequestSchema>;

export const foodSearchResultSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  category: z.string(),
});
export type FoodSearchResult = z.infer<typeof foodSearchResultSchema>;

/** Totais do dia mostrados ao aluno (só o que importa para o acompanhamento). */
export const dayTotalsSchema = z.object({
  energyKcal: z.number(),
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number(),
  fiberG: z.number(),
});
export type DayTotals = z.infer<typeof dayTotalsSchema>;

export const foodDaySchema = z.object({
  firstName: z.string().nullable(),
  today: z.iso.date(),
  date: z.iso.date(),
  /** Dia de treino (há sessão agendada ou feita) ou de descanso: define a meta mostrada. */
  dayType: z.enum(['TRAINING', 'REST']),
  targets: dailyTargetsSchema.nullable(),
  logs: z.array(
    z.object({
      id: z.uuid(),
      meal: mealSlotSchema,
      items: z.array(foodLogItemSchema),
      totals: nutrientTotalsSchema,
      confirmed: z.boolean(),
    }),
  ),
  totals: dayTotalsSchema,
  /** Há plano de nutrição ativo. */
  hasPlan: z.boolean(),
});
export type FoodDay = z.infer<typeof foodDaySchema>;
