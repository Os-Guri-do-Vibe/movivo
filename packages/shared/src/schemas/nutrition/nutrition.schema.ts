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

/** Medida caseira de um alimento: o que é 1 unidade ("fatia", 25 g). */
export const mealUnitSchema = z.object({
  singular: z.string().trim().min(1).max(30),
  plural: z.string().trim().min(1).max(30),
  grams: z.number().min(3).max(1_000),
});
export type MealUnit = z.infer<typeof mealUnitSchema>;

/** Troca equivalente de um alimento: mesma energia, quantidade calculada pelo servidor (TACO). */
export const mealSwapSchema = z.object({
  foodId: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(120),
  grams: z.number().int().min(1).max(1_500),
  unit: mealUnitSchema.optional(),
  /** Quantidade em unidades da medida caseira (`grams / unit.grams`). */
  units: z.number().min(0.25).max(100).optional(),
  energyKcal: z.number().int().min(0).max(5_000),
});
export type MealSwap = z.infer<typeof mealSwapSchema>;

/** Alimento do cardápio, com a quantidade e os nutrientes dessa quantidade. */
export const mealItemSchema = z.object({
  /** Alimento da base (`food_items.id`). */
  foodId: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(120),
  grams: z.number().int().min(1).max(1_500),
  unit: mealUnitSchema.optional(),
  units: z.number().min(0.25).max(100).optional(),
  energyKcal: z.number().int().min(0).max(5_000),
  proteinG: z.number().min(0).max(500),
  carbsG: z.number().min(0).max(1_000),
  fatG: z.number().min(0).max(500),
  swaps: z.array(mealSwapSchema).max(3),
});
export type MealItem = z.infer<typeof mealItemSchema>;

export const mealTotalsSchema = z.object({
  energyKcal: z.number().int().min(0).max(8_000),
  proteinG: z.number().min(0).max(600),
  carbsG: z.number().min(0).max(1_500),
  fatG: z.number().min(0).max(600),
  fiberG: z.number().min(0).max(300),
});
export type MealTotals = z.infer<typeof mealTotalsSchema>;

/** Uma opção completa de cardápio para a refeição (o aluno escolhe A, B ou C). */
export const mealOptionSchema = z.object({
  title: z.string().trim().min(1).max(80),
  items: z.array(mealItemSchema).min(1).max(8),
  /** Soma dos itens, calculada pelo servidor com a base de alimentos. */
  totals: mealTotalsSchema,
  /** Custo estimado da opção, em reais (estimativa do nutricionista de IA). */
  estimatedCostBrl: z.number().min(0).max(300),
});
export type MealOption = z.infer<typeof mealOptionSchema>;

/** Uma refeição planejada: metas da refeição e opções de cardápio com quantidades. */
export const plannedMealSchema = z.object({
  slot: mealSlotSchema,
  /** Fração aproximada da energia do dia nessa refeição (0–1). */
  energyShare: z.number().min(0).max(1),
  proteinG: z.number().int().min(0).max(150),
  guidance: z.string().trim().min(1).max(300),
  /** Resumo das opções (títulos); planos antigos trazem combinações de exemplo em texto. */
  examples: z.array(z.string().trim().min(1).max(200)).min(1).max(5),
  /** Cardápio com quantidade de cada alimento. Ausente nos planos anteriores ao cardápio. */
  options: z.array(mealOptionSchema).min(1).max(3).optional(),
});
export type PlannedMeal = z.infer<typeof plannedMealSchema>;

const supplementSchema = z.object({
  name: z.string().trim().min(1).max(60),
  guidance: z.string().trim().min(1).max(200),
});

/** Corpo do plano, sem a regra de fechamento (base para o rascunho do agente). */
export const nutritionPlanBaseSchema = z.object({
  strategy: energyStrategySchema,
  summary: z.string().trim().min(1).max(600),
  trainingDay: dailyTargetsSchema,
  restDay: dailyTargetsSchema,
  meals: z.array(plannedMealSchema).min(2).max(8),
  /** Orientações práticas (hidratação, refeições fora de casa, ajustes em dias longos). */
  guidelines: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
  /** Suplementos apenas no âmbito permitido pela metodologia do nutricionista. */
  supplements: z.array(supplementSchema).max(5),
  /** Custo estimado de um dia seguindo o cardápio (média das opções), em reais. */
  estimatedDailyCostBrl: z.number().min(0).max(1_000).optional(),
});

/** A energia das refeições precisa somar 100% do dia. */
export function mealEnergyIssue(plan: { meals: readonly { energyShare: number }[] }): boolean {
  const total = plan.meals.reduce((sum, meal) => sum + meal.energyShare, 0);
  return Math.abs(total - 1) > 0.05;
}

export const nutritionPlanStructureSchema = nutritionPlanBaseSchema.superRefine((plan, ctx) => {
  if (mealEnergyIssue(plan)) {
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
