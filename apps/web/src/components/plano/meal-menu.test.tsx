import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PlannedMeal } from '@movivo/shared';

import { MealMenu } from './meal-menu';

const meal: PlannedMeal = {
  slot: 'BREAKFAST',
  energyShare: 0.25,
  proteinG: 35,
  guidance: 'Combine proteína e fruta.',
  examples: ['Ovos e pão'],
  options: [
    {
      title: 'Ovos, pão e banana',
      estimatedCostBrl: 5.5,
      totals: { energyKcal: 654, proteinG: 33, carbsG: 80, fatG: 22, fiberG: 6 },
      items: [
        {
          foodId: 'ovo',
          name: 'Ovo, cozido',
          grams: 150,
          unit: { singular: 'ovo', plural: 'ovos', grams: 50 },
          units: 3,
          energyKcal: 219,
          proteinG: 20,
          carbsG: 1,
          fatG: 14,
          swaps: [{ foodId: 'frango', name: 'Frango, grelhado', grams: 140, energyKcal: 222 }],
        },
        {
          foodId: 'banana',
          name: 'Banana',
          grams: 100,
          energyKcal: 98,
          proteinG: 1,
          carbsG: 26,
          fatG: 0,
          swaps: [],
        },
      ],
    },
  ],
};

describe('MealMenu', () => {
  it('mostra a opção com a quantidade de cada alimento, as trocas e o custo', () => {
    render(<MealMenu meal={meal} />);
    expect(screen.getByText(/Opção A · Ovos, pão e banana/)).toBeVisible();
    expect(screen.getByText('654 kcal · 33 g de proteína')).toBeVisible();
    expect(screen.getByText('3 ovos')).toBeVisible();
    expect(screen.getByText('100 g')).toBeVisible();
    expect(screen.getByText(/Ou troque por: 140 g de Frango, grelhado/)).toBeVisible();
    expect(screen.getByText(/Custo estimado da opção/)).toHaveTextContent('R$');
  });

  it('plano antigo, sem cardápio, mostra as combinações de exemplo', () => {
    const { options, ...legacy } = meal;
    void options;
    const { container } = render(<MealMenu meal={legacy} />);
    expect(within(container).getByText('Ovos e pão')).toBeVisible();
  });
});
