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
  mealEnergyIssue,
  mealSlotSchema,
  nutritionPlanBaseSchema,
  type NutritionPlanStructure,
} from '@movivo/shared';

import { defineAgentTask, type Validator, type Violation } from '../../../core/agents/agent-task';
import { macroKcal, weeklyLossPct } from '../calc/energy';
import { FORBIDDEN_FOODS, mentions } from '../calc/food-rules';
import {
  buildOption,
  dailyCost,
  draftMealSchema,
  foodCandidateSchema,
  foodNamesOf,
  mealTarget,
  type DraftMeal,
  type FoodCandidate,
} from '../calc/menu';
import {
  fold,
  healthRecords,
  outputLanguageViolations,
  PROFESSIONAL_INSTRUCTION_RULE,
  professionalInstructionSchema,
} from './common';

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
  /** Orçamento mensal de alimentação, em reais; `null` = o aluno não informou. */
  foodBudgetMonthlyBrl: z.number().min(0).nullable(),
  mealsOutsideHomePerWeek: z.number().int().min(0).max(21),
  /**
   * Alimentos que o cardápio pode usar (por 100 g, da TACO): já sem restrição, alergia e o que o
   * aluno evita, com o que ele gosta primeiro. O cardápio só usa alimentos desta lista.
   */
  foods: z.array(foodCandidateSchema).max(220).default([]),
  /** Orçamento de um dia (mensal ÷ 30); `null` = o aluno não informou. */
  dailyBudgetBrl: z.number().min(0).nullable().default(null),
  professionalInstruction: professionalInstructionSchema,
});
export type NutritionInput = z.infer<typeof nutritionInputSchema>;

/**
 * Rascunho do agente: metas e, por refeição, as opções de cardápio só com alimento e proporção.
 * Quantidades finais, nutrientes e trocas equivalentes são calculados pelo código
 * (`finalizeNutrition`); o plano gravado é `NutritionPlanStructure`.
 */
export const nutritionOutputSchema = nutritionPlanBaseSchema
  .omit({ meals: true, estimatedDailyCostBrl: true })
  .extend({ meals: z.array(draftMealSchema).min(2).max(8) })
  .superRefine((plan, ctx) => {
    if (mealEnergyIssue(plan)) {
      ctx.addIssue({
        code: 'custom',
        path: ['meals'],
        message: 'A distribuição de energia entre as refeições precisa somar 100%.',
      });
    }
  });
export type NutritionOutput = z.infer<typeof nutritionOutputSchema>;

const foodMap = (input: NutritionInput): ReadonlyMap<string, FoodCandidate> =>
  new Map(input.foods.map((food) => [food.id, food]));

/** Tolerâncias: a meta pode sair do limite por arredondamento, não por escolha. */
const KCAL_TOLERANCE = 50;
const MACRO_ENERGY_TOLERANCE = 0.1;

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

/** Metas, refeições, restrições e suplementos: valem na geração e na edição do profissional. */
export const nutritionEditValidators: Validator<NutritionInput, NutritionOutput>[] = [
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

  // Restrições alimentares e alergias: nenhum alimento do cardápio contraria.
  (input, output, context) => {
    const violations: Violation[] = [];
    const allergens = allergenTerms(context.state);
    const foods = foodMap(input);
    output.meals.forEach((meal, index) => {
      for (const { path, name } of foodNamesOf(meal, foods)) {
        for (const restriction of input.dietaryRestrictions) {
          for (const term of FORBIDDEN_FOODS[restriction] ?? []) {
            if (mentions(name, term)) {
              violations.push({
                path: `meals.${index}.${path}`,
                message: `"${name}" contraria a restrição ${restriction} (contém ${term})`,
              });
            }
          }
        }
        for (const allergen of allergens) {
          if (fold(name).includes(allergen)) {
            violations.push({
              path: `meals.${index}.${path}`,
              message: `"${name}" contém ${allergen}, alergia/intolerância registrada`,
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

/** Cardápio: opções por refeição, quantidades que fecham a meta e custo dentro do orçamento. */
const menuValidators: Validator<NutritionInput, NutritionOutput>[] = [
  (input, output) => {
    const violations: Violation[] = [];
    const foods = foodMap(input);
    output.meals.forEach((meal, mealIndex) => {
      const main = ['BREAKFAST', 'LUNCH', 'DINNER'].includes(meal.slot);
      const options = meal.options ?? [];
      if (options.length < (main ? 3 : 2)) {
        violations.push({
          path: `meals.${mealIndex}.options`,
          message: `traga ${main ? 3 : 2} opções de cardápio para esta refeição`,
        });
        return;
      }
      const target = mealTarget(meal, output);
      options.forEach((option, optionIndex) => {
        const built = buildOption(
          option,
          target,
          foods,
          `meals.${mealIndex}.options.${optionIndex}`,
        );
        for (const issue of built.issues) {
          const [path, ...rest] = issue.split(': ');
          violations.push({ path: path ?? `meals.${mealIndex}.options`, message: rest.join(': ') });
        }
      });
    });
    return violations;
  },

  // Orçamento: o custo de um dia (média das opções de cada refeição) cabe no orçamento do aluno.
  (input, output) => {
    if (input.dailyBudgetBrl === null) return [];
    const cost = dailyCost(output.meals);
    const limit = input.dailyBudgetBrl * 1.05;
    return cost > limit
      ? [
          {
            path: 'meals',
            message: `o cardápio custa ~R$ ${cost.toFixed(2)} por dia e o orçamento do aluno é R$ ${input.dailyBudgetBrl.toFixed(2)} por dia; use opções mais baratas`,
          },
        ]
      : [];
  },
];

export const nutritionValidators: Validator<NutritionInput, NutritionOutput>[] = [
  ...nutritionEditValidators,
  ...menuValidators,
];

/**
 * Do rascunho do agente ao plano gravado: ajusta as porções à meta de cada refeição, calcula os
 * nutrientes e as trocas equivalentes e resume as opções em `examples`. Só roda depois de o
 * rascunho passar nos validadores, então não produz cardápio fora da tolerância.
 */
export function finalizeNutrition(
  draft: NutritionOutput,
  input: NutritionInput,
): NutritionPlanStructure {
  const foods = foodMap(input);
  const meals = draft.meals.map((meal: DraftMeal) => {
    const target = mealTarget(meal, draft);
    const options = (meal.options ?? []).map(
      (option, index) => buildOption(option, target, foods, `meals.${index}`).option,
    );
    return {
      slot: meal.slot,
      energyShare: meal.energyShare,
      proteinG: meal.proteinG,
      guidance: meal.guidance,
      examples:
        options.length > 0 ? options.map((option) => option.title).slice(0, 5) : [meal.guidance],
      ...(options.length > 0 ? { options } : {}),
    };
  });
  return {
    ...draft,
    meals,
    estimatedDailyCostBrl: Math.round(dailyCost(meals) * 100) / 100,
  };
}

/** Ids dos alimentos citados num plano (itens e trocas). */
export function foodIdsOf(structure: NutritionPlanStructure): string[] {
  return [
    ...new Set(
      structure.meals.flatMap((meal) =>
        (meal.options ?? []).flatMap((option) =>
          option.items.flatMap((item) => [item.foodId, ...item.swaps.map((swap) => swap.foodId)]),
        ),
      ),
    ),
  ];
}

/**
 * Edição do profissional: as quantidades ficam como ele prescreveu; o servidor só recalcula
 * nutrientes, totais e a quantidade das trocas equivalentes (nunca confia em número do cliente).
 */
export function rebuildNutrition(
  structure: NutritionPlanStructure,
  input: NutritionInput,
): { structure: NutritionPlanStructure; violations: Violation[] } {
  const foods = foodMap(input);
  const violations: Violation[] = [];
  const meals = structure.meals.map((meal, mealIndex) => {
    if (!meal.options) return meal;
    const target = mealTarget(meal, structure);
    const options = meal.options.map((option, optionIndex) => {
      const built = buildOption(
        option,
        target,
        foods,
        `meals.${mealIndex}.options.${optionIndex}`,
        false,
      );
      for (const issue of built.issues) {
        const [path, ...rest] = issue.split(': ');
        violations.push({ path: path ?? 'meals', message: rest.join(': ') });
      }
      return built.option;
    });
    return { ...meal, examples: options.map((o) => o.title).slice(0, 5), options };
  });
  return {
    structure: {
      ...structure,
      meals,
      estimatedDailyCostBrl: Math.round(dailyCost(meals) * 100) / 100,
    },
    violations,
  };
}

export const nutritionTask = defineAgentTask<NutritionInput, NutritionOutput>({
  id: 'nutrition.build_plan',
  role: 'Nutricionista de IA da MOVIVO, trabalhando sob a metodologia publicada pelos nutricionistas parceiros. Você monta planos alimentares práticos, seguros e que o aluno consegue seguir na rotina real, sem rigidez e sem culpa.',
  instructions: `Monte o plano alimentar do aluno.

Regras:
1. A "strategy" do plano é exatamente a recebida. Escolha as metas de cada tipo de dia (treino e descanso) DENTRO dos limites em "bounds": energia (faixa), proteína, gordura mínima, fibra mínima e água mínima. Os macronutrientes precisam fechar com a energia (proteína 4 kcal/g, carboidrato 4 kcal/g, gordura 9 kcal/g). Dia de treino costuma ter mais carboidrato.
2. Refeições: use as que o aluno já faz ("usualMeals"; pré e pós-treino são extras opcionais). A distribuição de energia soma 100% e a proteína das refeições fecha a meta do dia, com o mínimo por refeição principal da metodologia.
3. Cardápio: cada refeição tem OPÇÕES de cardápio ("options"): 3 para café da manhã, almoço e jantar e 2 para as demais. Cada opção é uma refeição completa (ex.: ovos mexidos + pão + banana), com os alimentos ("items") escolhidos SÓ da lista "foods" (use o "id" exato) e a quantidade aproximada em "grams". Priorize os alimentos que o aluno gosta (primeiros da lista) e monte opções diferentes entre si, práticas e compatíveis com a capacidade de cozinhar e com as refeições fora de casa. NUNCA contrariar restrição alimentar nem alergia/intolerância registrada.
   - O servidor ajusta as quantidades à meta de energia da refeição mantendo as PROPORÇÕES que você escolher: pense nas proporções (ex.: 1 porção de arroz para 1 de frango e 1 de legumes) e na proteína da refeição ("proteinG"), usando os valores por 100 g da lista.
   - "unit": só para o que o aluno CONTA em unidades inteiras: ovo = {"singular":"ovo","plural":"ovos","grams":50}, pão francês = 50 g, fatia de pão de forma = 25 g, banana média = 100 g, maçã = 130 g, pote de iogurte = 170 g. NUNCA use colher, concha, xícara ou copo como medida: arroz, feijão, carnes, legumes e massas são pesados em gramas, e líquidos (leite, bebida vegetal, suco) são medidos em ml pelo servidor. Omita "unit" em tudo que não se conta em unidades.
   - "swaps": 1 a 3 trocas equivalentes por alimento (id da lista, do MESMO grupo: arroz ↔ batata, macarrão ou mandioca; frango ↔ carne, peixe ou ovo; fruta ↔ fruta; leguminosa ↔ leguminosa). O servidor calcula a quantidade da troca para igualar a energia.
   - "estimatedCostBrl": o custo da opção em reais, com preços médios de supermercado no Brasil. Com "dailyBudgetBrl" informado, o custo de um dia (média das opções de cada refeição, somada) deve caber nele: escolha alimentos básicos e baratos (ovo, frango, feijão, arroz, banana, aveia) quando o orçamento for apertado. Sem orçamento informado, mantenha o custo moderado.
4. Suplementos: apenas os da lista permitida; se a lista estiver vazia, devolva lista vazia. Nunca sugira medicamento.
5. guidelines: orientações curtas e acionáveis (hidratação, dia de treino longo, refeição fora de casa, o que fazer quando a rotina quebra). Em estratégia de restrição energética, nada de linguagem de culpa ou proibição.
6. summary: 2 a 3 frases claras sobre a lógica do plano. Sem prometer resultado, sem diagnosticar. "guidance" de cada refeição: 1 a 2 frases sobre como montar e comer aquela refeição, sem repetir os alimentos.
7. ${PROFESSIONAL_INSTRUCTION_RULE}`,
  tier: 'REASONING',
  methodology: ['NUTRITION'],
  state: ['identity', 'goals', 'restrictions', 'preferences', 'body', 'safety', 'training'],
  input: nutritionInputSchema,
  output: nutritionOutputSchema,
  validators: nutritionValidators,
  maxCorrectionRounds: 2,
});
