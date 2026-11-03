/**
 * Tarefa `nutrition.suggest_meal`: o aluno pede, pelo WhatsApp, uma opção que o cardápio não
 * trouxe ("o que como no lanche?", "não tenho frango hoje"). O modelo escolhe alimentos SÓ da
 * lista permitida (sem restrição, alergia ou o que o aluno evita); o código ajusta as porções à
 * meta da refeição do plano, calcula os nutrientes e confere o custo. O plano não muda.
 */
import { z } from 'zod';

import { mealSlotSchema } from '@movivo/shared';

import { defineAgentTask, type Validator, type Violation } from '../../core/agents/agent-task';
import {
  buildOption,
  draftOptionSchema,
  foodCandidateSchema,
  type FoodCandidate,
} from '../planning/calc/menu';
import { FORBIDDEN_FOODS, mentions } from '../planning/calc/food-rules';
import { fold, outputLanguageViolations } from '../planning/tasks/common';

export const mealSuggestionInputSchema = z.object({
  message: z.string().trim().min(1).max(1_000),
  meal: z.object({
    slot: mealSlotSchema,
    /** Meta de energia e de proteína da refeição no plano do aluno. */
    targetKcal: z.number().min(50).max(3_000),
    targetProteinG: z.number().min(0).max(200),
    /** Teto de custo da refeição pelo orçamento do aluno (R$); `null` = sem orçamento informado. */
    maxCostBrl: z.number().min(0).nullable(),
  }),
  /** O que o plano já oferece nessa refeição (a sugestão precisa ser diferente). */
  plannedOptions: z.array(z.string().max(200)).max(3),
  dietaryRestrictions: z.array(z.string()).max(8),
  /** Alimentos permitidos (por 100 g). A sugestão só usa estes. */
  foods: z.array(foodCandidateSchema).min(1).max(220),
  /** Quantas sugestões devolver. */
  count: z.number().int().min(1).max(2),
});
export type MealSuggestionInput = z.infer<typeof mealSuggestionInputSchema>;

export const mealSuggestionOutputSchema = z.object({
  suggestions: z.array(draftOptionSchema).min(1).max(2),
});
export type MealSuggestionOutput = z.infer<typeof mealSuggestionOutputSchema>;

const foodMap = (input: MealSuggestionInput): ReadonlyMap<string, FoodCandidate> =>
  new Map(input.foods.map((food) => [food.id, food]));

export const mealSuggestionValidators: Validator<MealSuggestionInput, MealSuggestionOutput>[] = [
  (input, output) => {
    const violations: Violation[] = [];
    const foods = foodMap(input);
    if (output.suggestions.length < input.count) {
      violations.push({
        path: 'suggestions',
        message: `traga ${input.count} sugestão(ões) de refeição`,
      });
    }
    output.suggestions.forEach((suggestion, index) => {
      const built = buildOption(
        suggestion,
        { energyKcal: input.meal.targetKcal, proteinG: input.meal.targetProteinG },
        foods,
        `suggestions.${index}`,
      );
      for (const issue of built.issues) {
        const [path, ...rest] = issue.split(': ');
        violations.push({ path: path ?? 'suggestions', message: rest.join(': ') });
      }
      if (
        input.meal.maxCostBrl !== null &&
        suggestion.estimatedCostBrl > input.meal.maxCostBrl * 1.15
      ) {
        violations.push({
          path: `suggestions.${index}.estimatedCostBrl`,
          message: `custo de R$ ${suggestion.estimatedCostBrl.toFixed(2)} acima do que cabe no orçamento da refeição (R$ ${input.meal.maxCostBrl.toFixed(2)})`,
        });
      }
      for (const item of suggestion.items) {
        const food = foods.get(item.foodId);
        if (!food) continue;
        for (const restriction of input.dietaryRestrictions) {
          for (const term of FORBIDDEN_FOODS[restriction] ?? []) {
            if (mentions(food.name, term)) {
              violations.push({
                path: `suggestions.${index}`,
                message: `"${food.name}" contraria a restrição ${restriction}`,
              });
            }
          }
        }
      }
    });
    const titles = output.suggestions.map((s) => fold(s.title));
    if (new Set(titles).size !== titles.length) {
      violations.push({
        path: 'suggestions',
        message: 'as sugestões precisam ser diferentes entre si',
      });
    }
    return violations;
  },
  (_input, output) => outputLanguageViolations(output),
];

export const mealSuggestionTask = defineAgentTask<MealSuggestionInput, MealSuggestionOutput>({
  id: 'nutrition.suggest_meal',
  role: 'Nutricionista de IA da MOVIVO. Você sugere refeições práticas dentro do planejamento do aluno quando ele pede uma opção que o cardápio não trouxe.',
  instructions: `Sugira "count" refeição(ões) para a refeição "meal.slot" do aluno, atendendo ao pedido dele ("message").

Regras:
1. Monte cada sugestão como uma refeição completa, com alimentos ("items") escolhidos SÓ da lista "foods" (use o "id" exato), cada um com a quantidade aproximada em "grams". Priorize os primeiros da lista (o que o aluno gosta e os básicos de mercado).
2. O servidor ajusta as quantidades à meta da refeição mantendo as PROPORÇÕES que você escolher: pense nas proporções e na proteína de "meal.targetProteinG" (use os valores por 100 g da lista). Aponte quantidades que já se aproximem de "meal.targetKcal".
3. As sugestões precisam ser diferentes entre si e do que já está em "plannedOptions", práticas e baratas. Com "meal.maxCostBrl" informado, o custo estimado de cada sugestão ("estimatedCostBrl", em reais, preços médios de supermercado no Brasil) deve caber nele.
4. "unit": só para o que se conta em unidades inteiras (ovo = 50 g; fatia de pão de forma = 25 g; banana média = 100 g; pote de iogurte = 170 g). Nunca colher, concha, xícara ou copo: o resto é pesado em gramas (líquidos saem em ml). Omita "unit" no que não se conta. Deixe "swaps" vazio: o aluno pediu uma sugestão, não trocas.
5. NUNCA contrarie restrição alimentar ou alergia. Nada de medicamento, suplemento ou promessa de resultado.`,
  tier: 'STANDARD',
  methodology: ['NUTRITION'],
  state: ['preferences', 'restrictions'],
  input: mealSuggestionInputSchema,
  output: mealSuggestionOutputSchema,
  validators: mealSuggestionValidators,
  maxCorrectionRounds: 2,
});
