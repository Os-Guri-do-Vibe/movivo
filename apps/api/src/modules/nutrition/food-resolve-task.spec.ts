import { describe, expect, it } from 'vitest';

import {
  foodResolveCases,
  foodResolveTask,
  foodResolveValidators,
  type FoodResolveInput,
  type FoodResolveOutput,
} from './food-resolve-task';

const RICE = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';

const input: FoodResolveInput = {
  items: [
    {
      index: 0,
      label: 'arroz branco cozido',
      candidates: [{ id: RICE, name: 'Arroz, tipo 1, cozido', energyKcalPer100g: 128 }],
    },
    { index: 1, label: 'pizza de calabresa', candidates: [] },
  ],
};

const violationsOf = async (output: FoodResolveOutput, given: FoodResolveInput = input) =>
  (await Promise.all(foodResolveValidators.map((v) => v(given, output, {} as never)))).flat();

const pizza = { energyKcal: 270, proteinG: 11, carbsG: 30, fatG: 11, fiberG: 2 };

describe('nutrition.resolve_food', () => {
  it('aceita o candidato da tabela e a estimativa coerente', async () => {
    expect(
      await violationsOf({
        items: [
          { index: 0, foodItemId: RICE, estimate: null },
          { index: 1, foodItemId: null, estimate: pizza },
        ],
      }),
    ).toEqual([]);
  });

  it('recusa id que não está entre os candidatos do item', async () => {
    const found = await violationsOf({
      items: [
        { index: 0, foodItemId: OTHER, estimate: null },
        { index: 1, foodItemId: null, estimate: pizza },
      ],
    });
    expect(found.map((v) => v.path)).toEqual(['items.0.foodItemId']);
  });

  it('recusa item sem resposta, sem candidato nem estimativa, ou com os dois', async () => {
    expect(
      (await violationsOf({ items: [{ index: 0, foodItemId: RICE, estimate: null }] })).length,
    ).toBe(1);
    expect(
      (
        await violationsOf({
          items: [
            { index: 0, foodItemId: RICE, estimate: pizza },
            { index: 1, foodItemId: null, estimate: null },
          ],
        })
      ).length,
    ).toBe(2);
  });

  it('recusa energia que não bate com os macros (4/4/9)', async () => {
    const found = await violationsOf({
      items: [
        { index: 0, foodItemId: RICE, estimate: null },
        { index: 1, foodItemId: null, estimate: { ...pizza, energyKcal: 90 } },
      ],
    });
    expect(found.some((v) => v.path === 'items.1.estimate.energyKcal')).toBe(true);
  });

  it('bebida alcoólica pode ter mais energia que os macros (álcool)', async () => {
    const beer: FoodResolveInput = {
      items: [{ index: 0, label: 'cerveja pilsen', candidates: [] }],
    };
    const estimate = { energyKcal: 43, proteinG: 0.5, carbsG: 3.5, fatG: 0, fiberG: 0 };
    expect(await violationsOf({ items: [{ index: 0, foodItemId: null, estimate }] }, beer)).toEqual(
      [],
    );
    // O mesmo desvio em alimento sem álcool é erro.
    const juice: FoodResolveInput = { items: [{ index: 0, label: 'suco verde', candidates: [] }] };
    expect(
      (
        await violationsOf(
          { items: [{ index: 0, foodItemId: null, estimate: { ...estimate, energyKcal: 80 } }] },
          juice,
        )
      ).length,
    ).toBe(1);
  });

  it('os casos de avaliação têm entrada válida', () => {
    for (const evalCase of foodResolveCases) {
      expect(foodResolveTask.input.safeParse(evalCase.input).success, evalCase.id).toBe(true);
    }
  });
});
