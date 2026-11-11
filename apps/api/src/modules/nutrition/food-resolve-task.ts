/**
 * Tarefa `nutrition.resolve_food`: o que fazer com um alimento que a busca direta na base não
 * achou. Primeiro o agente procura o MESMO alimento entre os parecidos da tabela (o aluno diz
 * "arroz branco cozido", a tabela chama de "Arroz, tipo 1, cozido"); se a tabela não tem o
 * alimento (açaí com granola, pizza, whey), devolve a composição média por 100 g como estimativa.
 *
 * O código confere: o alimento escolhido precisa estar entre os candidatos e a energia estimada
 * precisa ser coerente com os macros. A estimativa nunca é silenciosa: o aluno é avisado.
 */
import { z } from 'zod';

import { estimatedNutrientsSchema } from '@movivo/shared';

import { defineAgentTask, type Validator, type Violation } from '../../core/agents/agent-task';
import type { Assertion, EvalCase, NamedCheck } from '../../core/agents/eval-case';
import { fold } from '../planning/tasks/common';

export const foodResolveInputSchema = z.object({
  items: z
    .array(
      z.object({
        index: z.number().int().min(0).max(40),
        /** Alimento como o aluno disse (ou como a foto foi lida). */
        label: z.string().trim().min(1).max(120),
        /** Parecidos da tabela de alimentos, do mais ao menos provável. */
        candidates: z
          .array(
            z.object({
              id: z.uuid(),
              name: z.string().max(200),
              energyKcalPer100g: z.number(),
            }),
          )
          .max(12),
      }),
    )
    .min(1)
    .max(20),
});
export type FoodResolveInput = z.infer<typeof foodResolveInputSchema>;

export const foodResolveOutputSchema = z.object({
  items: z
    .array(
      z.object({
        index: z.number().int().min(0).max(40),
        /** Id do candidato que é o MESMO alimento; nulo se a tabela não tem. */
        foodItemId: z.uuid().nullable(),
        /** Composição média por 100 g do alimento como é consumido; só quando `foodItemId` é nulo. */
        estimate: estimatedNutrientsSchema.nullable(),
      }),
    )
    .max(20),
});
export type FoodResolveOutput = z.infer<typeof foodResolveOutputSchema>;

/** Álcool tem 7 kcal/g fora dos macros: a energia pode passar da soma de proteína, carbo e gordura. */
const ALCOHOL =
  /\b(cerveja|chopp?|vinho|espumante|champanhe|cachaca|pinga|vodk?a|whisk(y|ey)|uisque|gin|rum|tequila|saque|licor|caipirinha|caipiroska|drink|drinque|coquetel|aperol|conhaque)\b/;

/** Energia pelos macros (Atwater): 4 kcal/g de proteína e carboidrato, 9 kcal/g de gordura. */
export function atwaterKcal(n: { proteinG: number; carbsG: number; fatG: number }): number {
  return 4 * n.proteinG + 4 * n.carbsG + 9 * n.fatG;
}

export const foodResolveValidators: Validator<FoodResolveInput, FoodResolveOutput>[] = [
  (input, output) => {
    const violations: Violation[] = [];
    const answered = new Map(output.items.map((item, i) => [item.index, { item, i }]));
    if (answered.size !== output.items.length) {
      violations.push({ path: 'items', message: 'cada "index" aparece uma vez só' });
    }
    for (const asked of input.items) {
      const found = answered.get(asked.index);
      if (!found) {
        violations.push({ path: 'items', message: `faltou responder o item ${asked.index}` });
        continue;
      }
      const { item, i } = found;
      if (item.foodItemId && item.estimate) {
        violations.push({
          path: `items.${i}`,
          message: 'escolha um candidato OU estime; nunca os dois',
        });
      }
      if (!item.foodItemId && !item.estimate) {
        violations.push({
          path: `items.${i}`,
          message: 'sem candidato equivalente, preencha "estimate" (por 100 g)',
        });
      }
      if (item.foodItemId && !asked.candidates.some((c) => c.id === item.foodItemId)) {
        violations.push({
          path: `items.${i}.foodItemId`,
          message: 'o id precisa ser de um dos candidatos deste item',
        });
      }
      if (item.estimate) {
        const e = item.estimate;
        const macros = atwaterKcal(e);
        const tolerance = Math.max(30, e.energyKcal * 0.25);
        const alcoholic = ALCOHOL.test(fold(asked.label));
        if (e.proteinG + e.carbsG + e.fatG > 100.5) {
          violations.push({
            path: `items.${i}.estimate`,
            message: 'proteína + carboidrato + gordura não passam de 100 g em 100 g de alimento',
          });
        }
        if (
          macros - e.energyKcal > tolerance ||
          (!alcoholic && e.energyKcal - macros > tolerance)
        ) {
          violations.push({
            path: `items.${i}.estimate.energyKcal`,
            message: `energia (${Math.round(e.energyKcal)} kcal) incoerente com os macros (≈ ${Math.round(macros)} kcal por 4/4/9): revise os valores por 100 g`,
          });
        }
      }
    }
    return violations;
  },
];

export const foodResolveTask = defineAgentTask<FoodResolveInput, FoodResolveOutput>({
  id: 'nutrition.resolve_food',
  role: 'Nutricionista de IA da MOVIVO, especialista em tabelas de composição de alimentos (TACO, IBGE, USDA e rótulos). Você identifica o alimento na tabela ou, se ele não existe nela, informa a composição média com rigor.',
  instructions: `Para cada item de "items", decida de onde vêm os nutrientes.

Regras:
1. Procure em "candidates" o MESMO alimento, no mesmo estado de preparo (ex.: "arroz branco cozido" = "Arroz, tipo 1, cozido"; "peito de frango grelhado" = "Frango, peito, sem pele, grelhado"; "manga" = uma manga crua qualquer). Achou: "foodItemId" com o id exato e "estimate" nulo.
2. Só aceite um candidato se ele for nutricionalmente equivalente. Cru não é cozido; integral não é refinado; um ingrediente não representa um prato pronto ("pizza de calabresa" não é "linguiça calabresa"; "açaí com granola" não é só "açaí polpa"); produto diet/zero não é o comum. Na dúvida, não force.
3. A tabela não tem o alimento: "foodItemId" nulo e "estimate" com a composição MÉDIA por 100 g do alimento como é consumido (pronto para comer), a partir de tabelas de composição usuais ou do rótulo típico para industrializados: energyKcal, proteinG, carbsG, fatG e fiberG.
4. A energia precisa bater com os macros (4 kcal/g de proteína e de carboidrato, 9 kcal/g de gordura); bebida alcoólica tem a energia do álcool a mais.
5. Responda TODOS os itens, cada "index" uma vez. Não comente, não julgue o alimento.`,
  tier: 'STANDARD',
  methodology: [],
  state: [],
  input: foodResolveInputSchema,
  output: foodResolveOutputSchema,
  validators: foodResolveValidators,
  maxCorrectionRounds: 2,
});

// --- Casos de avaliação ---------------------------------------------------------------------

const path = (
  p: string,
  op: Extract<Assertion, { kind: 'path' }>['op'],
  value: unknown,
  description: string,
): Assertion => ({ kind: 'path', path: p, op, value, description });

const RICE_ID = '11111111-1111-4111-8111-111111111111';
const SAUSAGE_ID = '22222222-2222-4222-8222-222222222222';

export const foodResolveChecks: Record<string, NamedCheck> = {
  pizzaEstimadaPlausivel: (output) => {
    const estimate = (output as FoodResolveOutput).items?.[0]?.estimate;
    const pass =
      estimate !== null &&
      estimate !== undefined &&
      estimate.energyKcal >= 200 &&
      estimate.energyKcal <= 340;
    return { pass, detail: estimate ? `${estimate.energyKcal} kcal/100 g` : 'sem estimativa' };
  },
};

const baseCase = {
  taskId: foodResolveTask.id,
  safetyCritical: false,
  state: {},
  minScore: 1,
} as const;

export const foodResolveCases: EvalCase[] = [
  {
    ...baseCase,
    id: 'arroz-branco-e-o-tipo-1-da-tabela',
    title: 'Alimento com outro nome na tabela é reconhecido, sem estimar',
    input: {
      items: [
        {
          index: 0,
          label: 'arroz branco cozido',
          candidates: [
            { id: RICE_ID, name: 'Arroz, tipo 1, cozido', energyKcalPer100g: 128 },
            {
              id: '33333333-3333-4333-8333-333333333333',
              name: 'Arroz, integral, cozido',
              energyKcalPer100g: 124,
            },
            {
              id: '44444444-4444-4444-8444-444444444444',
              name: 'Arroz, tipo 1, cru',
              energyKcalPer100g: 358,
            },
          ],
        },
      ],
    },
    assertions: [
      path('items.0.foodItemId', 'eq', RICE_ID, 'escolhe o arroz tipo 1 cozido'),
      path('items.0.estimate', 'eq', null, 'não estima o que a tabela tem'),
    ],
  },
  {
    ...baseCase,
    id: 'pizza-nao-e-linguica',
    title: 'Prato pronto fora da tabela é estimado, não aproximado por um ingrediente',
    input: {
      items: [
        {
          index: 0,
          label: 'pizza de calabresa',
          candidates: [
            { id: SAUSAGE_ID, name: 'Linguiça, porco, calabresa, crua', energyKcalPer100g: 296 },
          ],
        },
      ],
    },
    assertions: [
      path('items.0.foodItemId', 'eq', null, 'não usa a linguiça no lugar da pizza'),
      { kind: 'check', name: 'pizzaEstimadaPlausivel', description: 'pizza entre 200 e 340 kcal' },
    ],
  },
];
