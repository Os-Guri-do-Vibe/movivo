import { describe, expect, it } from 'vitest';

import type { ValidationContext } from '../../core/agents/agent-task';
import type { FoodCandidate } from '../planning/calc/menu';
import { mealSuggestionValidators, type MealSuggestionInput } from './meal-suggestion-task';

const food = (
  id: string,
  name: string,
  category: string,
  energyKcal: number,
  proteinG: number,
  carbsG: number,
  fatG: number,
): FoodCandidate => ({ id, name, category, energyKcal, proteinG, carbsG, fatG, fiberG: 1 });

const FOODS = [
  food('ovo', 'Ovo, cozido', 'Ovos e derivados', 146, 13.3, 0.6, 9.5),
  food('pao', 'Pão, integral', 'Cereais e derivados', 253, 9.4, 49.9, 3.4),
  food('banana', 'Banana', 'Frutas e derivados', 98, 1.3, 26, 0.1),
  food('queijo', 'Queijo, minas', 'Leite e derivados', 264, 17, 3, 20),
];

const input = (over: Partial<MealSuggestionInput> = {}): MealSuggestionInput => ({
  message: 'me dá outra opção de lanche',
  meal: { slot: 'AFTERNOON_SNACK', targetKcal: 320, targetProteinG: 18, maxCostBrl: 8 },
  plannedOptions: ['Sanduíche de frango'],
  dietaryRestrictions: [],
  foods: FOODS,
  count: 1,
  ...over,
});

const ctx: ValidationContext = { state: {}, methodology: {} };
const run = async (
  i: MealSuggestionInput,
  output: Parameters<(typeof mealSuggestionValidators)[0]>[1],
) => (await Promise.all(mealSuggestionValidators.map((v) => v(i, output, ctx)))).flat();

const suggestion = (over: Record<string, unknown> = {}) => ({
  title: 'Pão com ovo e banana',
  estimatedCostBrl: 4,
  items: [
    { foodId: 'ovo', grams: 100, swaps: [] },
    { foodId: 'pao', grams: 50, swaps: [] },
    { foodId: 'banana', grams: 50, swaps: [] },
  ],
  ...over,
});

describe('nutrition.suggest_meal', () => {
  it('aceita uma sugestão que fecha a meta da refeição', async () => {
    expect(await run(input(), { suggestions: [suggestion()] })).toEqual([]);
  });

  it('recusa alimento fora da lista, custo acima do orçamento e restrição', async () => {
    const outside = await run(input(), {
      suggestions: [suggestion({ items: [{ foodId: 'picanha', grams: 100, swaps: [] }] })],
    });
    expect(outside.map((v) => v.message).join(' | ')).toContain('não está na lista permitida');

    const expensive = await run(input(), { suggestions: [suggestion({ estimatedCostBrl: 20 })] });
    expect(expensive.map((v) => v.message).join(' | ')).toContain('orçamento da refeição');

    const lactose = await run(input({ dietaryRestrictions: ['LACTOSE_FREE'] }), {
      suggestions: [
        suggestion({
          items: [
            { foodId: 'queijo', grams: 60, swaps: [] },
            { foodId: 'pao', grams: 50, swaps: [] },
            { foodId: 'banana', grams: 60, swaps: [] },
          ],
        }),
      ],
    });
    expect(lactose.map((v) => v.message).join(' | ')).toContain('LACTOSE_FREE');
  });

  it('as duas sugestões precisam ser diferentes', async () => {
    const found = await run(input({ count: 2 }), {
      suggestions: [suggestion(), suggestion()],
    });
    expect(found.map((v) => v.message).join(' | ')).toContain('diferentes entre si');
  });
});
