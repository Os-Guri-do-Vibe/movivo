import { describe, expect, it } from 'vitest';

import type { ValidationContext } from '../../core/agents/agent-task';
import { mealAdaptValidators, type MealAdaptInput, type MealAdaptOutput } from './meal-adapt-task';

const ctx: ValidationContext = { state: {}, methodology: {} };

const input = (over: Partial<MealAdaptInput> = {}): MealAdaptInput => ({
  message: 'Não tem ovo em casa para o café hoje, o que eu posso comer?',
  meal: {
    slot: 'BREAKFAST',
    label: 'Café da manhã',
    targetKcal: 450,
    targetProteinG: 28,
    options: [
      {
        title: 'Ovos mexidos com pão',
        items: [
          { name: 'Ovo, de galinha, mexido', grams: 100, swaps: [] },
          { name: 'Pão francês', grams: 50, swaps: [] },
        ],
      },
    ],
  },
  day: {
    dayType: 'TRAINING',
    strategy: 'DEFICIT',
    targetEnergyMinKcal: 1_900,
    targetEnergyMaxKcal: 2_100,
    targetProteinG: 140,
    consumedKcal: 0,
    consumedProteinG: 0,
    laterMeals: ['Almoço', 'Lanche da tarde', 'Jantar'],
  },
  pantry: null,
  avoid: 'ovo',
  dietaryRestrictions: [],
  previousIssue: null,
  ...over,
});

const run = async (i: MealAdaptInput, o: MealAdaptOutput) =>
  JSON.stringify((await Promise.all(mealAdaptValidators.map((v) => v(i, o, ctx)))).flat());

describe('nutrition.adapt_meal', () => {
  it('sem saber o que há em casa, pergunta (e só pergunta)', async () => {
    const ask: MealAdaptOutput = {
      action: 'ASK_PANTRY',
      reply: 'Sem ovo, tranquilo! O que você tem aí em casa agora para o café?',
      meal: null,
    };
    expect(await run(input(), ask)).toBe('[]');
    expect(
      await run(input(), { ...ask, reply: 'Sem ovo, tranquilo, vamos dar um jeito.' }),
    ).toContain('terminar em');
    expect(
      await run(input(), { ...ask, meal: { items: [{ label: 'pão francês', grams: 50 }] } }),
    ).toContain('meal');
  });

  it('com a despensa dita, não volta a perguntar', async () => {
    const ask: MealAdaptOutput = {
      action: 'ASK_PANTRY',
      reply: 'E o que mais você tem aí?',
      meal: null,
    };
    expect(await run(input({ pantry: 'pão, queijo e banana' }), ask)).toContain('já disse');
  });

  it('SUGGEST exige alimentos e só deixa citar números dos dados', async () => {
    const suggest: MealAdaptOutput = {
      action: 'SUGGEST',
      reply:
        'Com o pão e o queijo dá um sanduíche na frigideira. Como o café ficou com menos proteína, reforce o almoço: faltam 28 g hoje.',
      meal: {
        items: [
          { label: 'pão francês', grams: 100 },
          { label: 'queijo minas frescal', grams: 60 },
          { label: 'banana prata', grams: 100 },
        ],
      },
    };
    const withPantry = input({ pantry: 'pão, queijo e banana', avoid: 'ovo' });
    expect(await run(withPantry, suggest)).toBe('[]');
    expect(await run(withPantry, { ...suggest, meal: null })).toContain('alimentos e gramas');
    expect(
      await run(withPantry, {
        ...suggest,
        reply: 'Esse café fecha 520 kcal certinho para você.',
      }),
    ).toContain('números fora dos dados');
  });
});
