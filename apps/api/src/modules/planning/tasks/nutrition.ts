/**
 * Tarefa `nutrition.build_plan` — o plano alimentar.
 *
 * O código calcula os LIMITES (gasto, faixa de energia da estratégia, proteína por kg, gordura
 * mínima, fibra, água) a partir dos parâmetros do nutricionista; o modelo escolhe as metas
 * dentro deles e monta a estrutura de refeições respeitando preferências, restrições e alergias.
 * O validador recusa o que sair dos limites, contrariar restrição ou sugerir suplemento fora da
 * lista permitida.
 */
import { z } from 'zod';

import {
  energyStrategySchema,
  mealSlotSchema,
  nutritionPlanStructureSchema,
  type NutritionPlanStructure,
} from '@movivo/shared';

import { defineAgentTask, type Validator, type Violation } from '../../../core/agents/agent-task';
import { macroKcal, weeklyLossPct } from '../calc/energy';
import { fold, healthRecords, outputLanguageViolations } from './common';

const dayBoundsSchema = z.object({
  energyKcal: z.object({ min: z.number(), max: z.number() }),
  proteinG: z.object({ min: z.number(), max: z.number().nullable() }),
  fatMinG: z.number().nullable(),
  fiberMinG: z.number().nullable(),
  waterMinMl: z.number().nullable(),
  /** Gasto estimado do tipo de dia (referência para a perda semanal implícita). */
  expenditureKcal: z.number(),
});

export const nutritionInputSchema = z.object({
  strategy: energyStrategySchema,
  weightKg: z.number().min(30).max(300),
  /** Tipos de dia e seus limites calculados pelo código. */
  bounds: z.object({ trainingDay: dayBoundsSchema, restDay: dayBoundsSchema }),
  mealsPerDay: z.number().int().min(1).max(8),
  usualMeals: z.array(mealSlotSchema).min(1).max(8),
  dietaryRestrictions: z.array(z.string()).max(8),
  /** Suplementos que a metodologia permite sugerir (chaves). Vazio = nenhum. */
  allowedSupplements: z.array(z.string()).max(8),
  proteinPerMealMinG: z.number().nullable(),
  maxWeeklyWeightLossPct: z.number().nullable(),
  cookingCapacity: z.enum(['NONE', 'BASIC', 'GOOD']),
  foodBudget: z.enum(['TIGHT', 'MODERATE', 'COMFORTABLE']),
  mealsOutsideHomePerWeek: z.number().int().min(0).max(21),
});
export type NutritionInput = z.infer<typeof nutritionInputSchema>;

export const nutritionOutputSchema = nutritionPlanStructureSchema;
export type NutritionOutput = NutritionPlanStructure;

/** Tolerâncias: a meta pode sair do limite por arredondamento, não por escolha. */
const KCAL_TOLERANCE = 50;
const MACRO_ENERGY_TOLERANCE = 0.1;

/** Termos de origem animal por restrição (lista de conferência, não substitui o nutricionista). */
const FORBIDDEN_FOODS: Readonly<Record<string, readonly string[]>> = {
  VEGAN: [
    'carne',
    'frango',
    'peixe',
    'atum',
    'sardinha',
    'salmao',
    'tilapia',
    'ovo',
    'ovos',
    'leite',
    'queijo',
    'iogurte',
    'requeijao',
    'manteiga',
    'mel',
    'whey',
    'presunto',
    'peru',
    'bacon',
    'camarao',
    'linguica',
    'bife',
    'carne moida',
    'gelatina',
  ],
  VEGETARIAN: [
    'carne',
    'frango',
    'peixe',
    'atum',
    'sardinha',
    'salmao',
    'tilapia',
    'presunto',
    'peru',
    'bacon',
    'camarao',
    'linguica',
    'bife',
    'carne moida',
  ],
  LACTOSE_FREE: ['leite', 'queijo', 'iogurte', 'requeijao', 'manteiga', 'creme de leite', 'whey'],
  GLUTEN_FREE: [
    'pao',
    'macarrao',
    'trigo',
    'cevada',
    'centeio',
    'biscoito',
    'bolacha',
    'cuscuz de trigo',
  ],
};

/** Palavras que anulam a presença do termo ("leite vegetal", "sem lactose", "sem gluten"). */
const NEGATIONS = [
  'sem lactose',
  'sem gluten',
  'vegetal',
  'de soja',
  'de amendoas',
  'de aveia',
  'de coco',
  'zero lactose',
  'sem leite',
];

const SUPPLEMENT_TERMS: Readonly<Record<string, readonly string[]>> = {
  CREATINE: ['creatina'],
  WHEY: ['whey', 'proteina do soro'],
  CAFFEINE: ['cafeina'],
  VITAMIN_D: ['vitamina d'],
  OMEGA_3: ['omega'],
  MULTIVITAMIN: ['multivitaminico', 'polivitaminico'],
};

function allergenTerms(state: Record<string, unknown>): string[] {
  return healthRecords(state)
    .filter((r) => r.kind === 'FOOD_ALLERGY')
    .map((r) => fold(r.summary.replace(/\s*\(.*\)\s*$/, '').trim()))
    .filter((t) => t.length >= 3);
}

function mentions(text: string, term: string): boolean {
  const folded = fold(text);
  if (NEGATIONS.some((n) => folded.includes(n))) return false;
  return new RegExp(`(^|[^a-z])${term}([^a-z]|$)`).test(folded);
}

export const nutritionValidators: Validator<NutritionInput, NutritionOutput>[] = [
  // A estratégia do plano é a definida pelo Motor de Objetivos.
  (input, output) =>
    output.strategy === input.strategy
      ? []
      : [
          {
            path: 'strategy',
            message: `a estratégia energética do plano deve ser ${input.strategy}`,
          },
        ],

  // Metas dentro dos limites calculados, em cada tipo de dia.
  (input, output) => {
    const violations: Violation[] = [];
    for (const dayKey of ['trainingDay', 'restDay'] as const) {
      const target = output[dayKey];
      const bound = input.bounds[dayKey];
      const base = dayKey;
      if (target.energyKcal.min < bound.energyKcal.min - KCAL_TOLERANCE) {
        violations.push({
          path: `${base}.energyKcal.min`,
          message: `energia mínima abaixo do limite do dia (${bound.energyKcal.min} kcal)`,
        });
      }
      if (target.energyKcal.max > bound.energyKcal.max + KCAL_TOLERANCE) {
        violations.push({
          path: `${base}.energyKcal.max`,
          message: `energia máxima acima do limite do dia (${bound.energyKcal.max} kcal)`,
        });
      }
      if (target.proteinG < bound.proteinG.min) {
        violations.push({
          path: `${base}.proteinG`,
          message: `proteína de ${target.proteinG} g abaixo do mínimo (${bound.proteinG.min} g)`,
        });
      }
      if (bound.proteinG.max !== null && target.proteinG > bound.proteinG.max) {
        violations.push({
          path: `${base}.proteinG`,
          message: `proteína de ${target.proteinG} g acima do máximo (${bound.proteinG.max} g)`,
        });
      }
      if (bound.fatMinG !== null && target.fatG < bound.fatMinG) {
        violations.push({
          path: `${base}.fatG`,
          message: `gordura de ${target.fatG} g abaixo do mínimo (${bound.fatMinG} g)`,
        });
      }
      if (bound.fiberMinG !== null && target.fiberG < bound.fiberMinG * 0.9) {
        violations.push({
          path: `${base}.fiberG`,
          message: `fibra de ${target.fiberG} g abaixo do mínimo (${bound.fiberMinG} g)`,
        });
      }
      if (bound.waterMinMl !== null && target.waterMl < bound.waterMinMl * 0.9) {
        violations.push({
          path: `${base}.waterMl`,
          message: `água de ${target.waterMl} ml abaixo do mínimo (${bound.waterMinMl} ml)`,
        });
      }
      // Macros precisam fechar com a energia (4/4/9), dentro de uma tolerância.
      const midpoint = (target.energyKcal.min + target.energyKcal.max) / 2;
      const fromMacros = macroKcal(target);
      if (Math.abs(fromMacros - midpoint) / midpoint > MACRO_ENERGY_TOLERANCE) {
        violations.push({
          path: `${base}`,
          message: `proteína, carboidrato e gordura somam ${Math.round(fromMacros)} kcal, mas a meta de energia é ~${Math.round(midpoint)} kcal`,
        });
      }
      // Ritmo de perda de peso implícito.
      if (input.maxWeeklyWeightLossPct !== null) {
        const loss = weeklyLossPct(bound.expenditureKcal, target.energyKcal.min, input.weightKg);
        if (loss > input.maxWeeklyWeightLossPct) {
          violations.push({
            path: `${base}.energyKcal`,
            message: `a energia mínima implica perder ~${loss.toFixed(2)}% do peso por semana; o máximo é ${input.maxWeeklyWeightLossPct}%`,
          });
        }
      }
    }
    return violations;
  },

  // Refeições: usam as do aluno, fecham a proteína do dia e cumprem o mínimo por refeição.
  (input, output) => {
    const violations: Violation[] = [];
    const slots = new Set(output.meals.map((m) => m.slot));
    if (slots.size !== output.meals.length) {
      violations.push({ path: 'meals', message: 'há refeições repetidas' });
    }
    const proteinSum = output.meals.reduce((sum, m) => sum + m.proteinG, 0);
    const proteinTarget = output.restDay.proteinG;
    if (Math.abs(proteinSum - proteinTarget) / proteinTarget > 0.15) {
      violations.push({
        path: 'meals',
        message: `a proteína das refeições soma ${proteinSum} g; a meta de um dia de descanso é ${proteinTarget} g`,
      });
    }
    if (input.proteinPerMealMinG !== null) {
      output.meals.forEach((meal, index) => {
        const main = ['BREAKFAST', 'LUNCH', 'DINNER'].includes(meal.slot);
        const minimum = input.proteinPerMealMinG;
        if (main && minimum !== null && meal.proteinG < minimum) {
          violations.push({
            path: `meals.${index}.proteinG`,
            message: `refeição principal com ${meal.proteinG} g de proteína; o mínimo é ${minimum} g`,
          });
        }
      });
    }
    const usual = new Set(input.usualMeals);
    const outside = output.meals.filter((m) => !usual.has(m.slot) && !m.slot.includes('WORKOUT'));
    if (outside.length > 1) {
      violations.push({
        path: 'meals',
        message:
          'o plano usa refeições que o aluno não costuma fazer; adapte às que ele já faz (pré e pós-treino à parte)',
      });
    }
    return violations;
  },

  // Restrições alimentares e alergias: nenhum exemplo contraria.
  (input, output, context) => {
    const violations: Violation[] = [];
    const allergens = allergenTerms(context.state);
    output.meals.forEach((meal, index) => {
      for (const [exampleIndex, example] of meal.examples.entries()) {
        const path = `meals.${index}.examples.${exampleIndex}`;
        for (const restriction of input.dietaryRestrictions) {
          for (const term of FORBIDDEN_FOODS[restriction] ?? []) {
            if (mentions(example, term)) {
              violations.push({
                path,
                message: `"${example}" contraria a restrição ${restriction} (contém ${term})`,
              });
            }
          }
        }
        for (const allergen of allergens) {
          if (fold(example).includes(allergen)) {
            violations.push({
              path,
              message: `"${example}" contém ${allergen}, alergia/intolerância registrada`,
            });
          }
        }
      }
    });
    return violations;
  },

  // Suplementos só os permitidos pela metodologia.
  (input, output) => {
    const violations: Violation[] = [];
    output.supplements.forEach((supplement, index) => {
      const folded = fold(supplement.name);
      const allowed = input.allowedSupplements.some((key) =>
        (SUPPLEMENT_TERMS[key] ?? [fold(key)]).some((term) => folded.includes(term)),
      );
      if (!allowed) {
        violations.push({
          path: `supplements.${index}.name`,
          message: `"${supplement.name}" não está entre os suplementos permitidos pela metodologia`,
        });
      }
    });
    return violations;
  },

  (_input, output) => outputLanguageViolations(output),
];

export const nutritionTask = defineAgentTask<NutritionInput, NutritionOutput>({
  id: 'nutrition.build_plan',
  role: 'Nutricionista de IA da MOVIVO, trabalhando sob a metodologia publicada pelos nutricionistas parceiros. Você monta planos alimentares práticos, seguros e que o aluno consegue seguir na rotina real, sem rigidez e sem culpa.',
  instructions: `Monte o plano alimentar do aluno.

Regras:
1. A "strategy" do plano é exatamente a recebida. Escolha as metas de cada tipo de dia (treino e descanso) DENTRO dos limites em "bounds": energia (faixa), proteína, gordura mínima, fibra mínima e água mínima. Os macronutrientes precisam fechar com a energia (proteína 4 kcal/g, carboidrato 4 kcal/g, gordura 9 kcal/g). Dia de treino costuma ter mais carboidrato.
2. Refeições: use as que o aluno já faz ("usualMeals"; pré e pós-treino são extras opcionais). A distribuição de energia soma 100% e a proteína das refeições fecha a meta do dia, com o mínimo por refeição principal da metodologia.
3. Exemplos: combinações práticas e baratas, compatíveis com orçamento, capacidade de cozinhar e refeições fora de casa. NUNCA contrariar restrição alimentar nem alergia/intolerância registrada, e respeitar os alimentos que o aluno gosta ou evita (no Estado do Aluno).
4. Suplementos: apenas os da lista permitida; se a lista estiver vazia, devolva lista vazia. Nunca sugira medicamento.
5. guidelines: orientações curtas e acionáveis (hidratação, dia de treino longo, refeição fora de casa, o que fazer quando a rotina quebra). Em estratégia de restrição energética, nada de linguagem de culpa ou proibição.
6. summary: 2 a 3 frases claras sobre a lógica do plano. Sem prometer resultado, sem diagnosticar.`,
  tier: 'REASONING',
  methodology: ['NUTRITION'],
  state: ['identity', 'goals', 'restrictions', 'preferences', 'body', 'safety', 'training'],
  input: nutritionInputSchema,
  output: nutritionOutputSchema,
  validators: nutritionValidators,
  maxCorrectionRounds: 2,
});
