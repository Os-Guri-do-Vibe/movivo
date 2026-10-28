import { z } from 'zod';

import { energyStrategySchema } from '../student/goal.schema';

export const mealSlotSchema = z.enum([
  'BREAKFAST',
  'MORNING_SNACK',
  'LUNCH',
  'AFTERNOON_SNACK',
  'DINNER',
  'SUPPER',
  'PRE_WORKOUT',
  'POST_WORKOUT',
]);
export type MealSlot = z.infer<typeof mealSlotSchema>;

export const MEAL_SLOT_LABELS: Readonly<Record<MealSlot, string>> = {
  BREAKFAST: 'Café da manhã',
  MORNING_SNACK: 'Lanche da manhã',
  LUNCH: 'Almoço',
  AFTERNOON_SNACK: 'Lanche da tarde',
  DINNER: 'Jantar',
  SUPPER: 'Ceia',
  PRE_WORKOUT: 'Pré-treino',
  POST_WORKOUT: 'Pós-treino',
};

/** Faixa de energia (kcal/dia). Faixa, não número exato: a estimativa tem erro. */
export const energyRangeSchema = z
  .object({ min: z.number().int().min(800).max(6_000), max: z.number().int().min(800).max(6_000) })
  .refine((r) => r.min <= r.max, { message: 'O mínimo não pode ser maior que o máximo.' });

/** Metas diárias de um tipo de dia (treino ou descanso). */
export const dailyTargetsSchema = z.object({
  energyKcal: energyRangeSchema,
  proteinG: z.number().int().min(30).max(400),
  carbsG: z.number().int().min(20).max(1_000),
  fatG: z.number().int().min(20).max(300),
  fiberG: z.number().int().min(10).max(80),
  waterMl: z.number().int().min(1_000).max(8_000),
});
export type DailyTargets = z.infer<typeof dailyTargetsSchema>;

/** Uma refeição planejada: estrutura e exemplos práticos, não cardápio rígido. */
export const plannedMealSchema = z.object({
  slot: mealSlotSchema,
  /** Fração aproximada da energia do dia nessa refeição (0–1). */
  energyShare: z.number().min(0).max(1),
  proteinG: z.number().int().min(0).max(150),
  guidance: z.string().trim().min(1).max(300),
  /** Combinações de exemplo, respeitando preferências e restrições do aluno. */
  examples: z.array(z.string().trim().min(1).max(200)).min(1).max(5),
});
export type PlannedMeal = z.infer<typeof plannedMealSchema>;

export const nutritionPlanStructureSchema = z
  .object({
    strategy: energyStrategySchema,
    summary: z.string().trim().min(1).max(600),
    trainingDay: dailyTargetsSchema,
    restDay: dailyTargetsSchema,
    meals: z.array(plannedMealSchema).min(2).max(8),
    /** Orientações práticas (hidratação, refeições fora de casa, ajustes em dias longos). */
    guidelines: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
    /** Suplementos apenas no âmbito permitido pela metodologia do nutricionista. */
    supplements: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(60),
          guidance: z.string().trim().min(1).max(200),
        }),
      )
      .max(5),
  })
  .superRefine((plan, ctx) => {
    const total = plan.meals.reduce((sum, meal) => sum + meal.energyShare, 0);
    if (Math.abs(total - 1) > 0.05) {
      ctx.addIssue({
        code: 'custom',
        path: ['meals'],
        message: 'A distribuição de energia entre as refeições precisa somar 100%.',
      });
    }
  });
export type NutritionPlanStructure = z.infer<typeof nutritionPlanStructureSchema>;

/** Composição por 100 g (macros + micronutrientes da base de alimentos). */
export const nutrientsPer100gSchema = z.object({
  energyKcal: z.number().min(0).max(1_000),
  proteinG: z.number().min(0).max(100),
  carbsG: z.number().min(0).max(100),
  fatG: z.number().min(0).max(100),
  fiberG: z.number().min(0).max(100).nullable(),
  /** Micronutrientes por chave (ex.: `calcium_mg`, `iron_mg`, `sodium_mg`, `vitamin_c_mg`). */
  micros: z.record(z.string().regex(/^[a-z0-9_]+$/), z.number().min(0)),
});
export type NutrientsPer100g = z.infer<typeof nutrientsPer100gSchema>;

export const foodLogSourceSchema = z.enum(['TEXT', 'PHOTO', 'MANUAL', 'AUDIO']);
export type FoodLogSource = z.infer<typeof foodLogSourceSchema>;

/** Item de uma refeição registrada. `foodItemId` nulo = alimento não encontrado na base. */
export const foodLogItemSchema = z.object({
  foodItemId: z.uuid().nullable(),
  label: z.string().trim().min(1).max(120),
  grams: z.number().min(1).max(3_000),
  /** Como a porção foi obtida: informada, estimada pela foto ou medida caseira convertida. */
  portionSource: z.enum(['DECLARED', 'ESTIMATED', 'HOUSEHOLD_MEASURE']),
});
export type FoodLogItem = z.infer<typeof foodLogItemSchema>;

/** Totais calculados de forma determinística a partir da base de alimentos. */
export const nutrientTotalsSchema = z.object({
  energyKcal: z.number().min(0),
  proteinG: z.number().min(0),
  carbsG: z.number().min(0),
  fatG: z.number().min(0),
  fiberG: z.number().min(0),
  micros: z.record(z.string(), z.number().min(0)),
  /** Itens sem correspondência na base (os totais ficam subestimados). */
  unmatchedItems: z.number().int().min(0),
});
export type NutrientTotals = z.infer<typeof nutrientTotalsSchema>;
