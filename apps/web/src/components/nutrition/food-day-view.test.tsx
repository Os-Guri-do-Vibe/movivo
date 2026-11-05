import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FoodDay, FoodLogDraft } from '@movivo/shared';

const api = vi.hoisted(() => ({
  getFoodDay: vi.fn(),
  draftFromText: vi.fn(),
  draftFromPhoto: vi.fn(),
  confirmFoodLog: vi.fn(),
  removeFoodLog: vi.fn(),
}));
vi.mock('@/lib/nutrition-api', () => api);
vi.mock('@/lib/training-api', () => ({
  TrainingApiError: class extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

import { FoodDayView } from './food-day-view';

const LOG_ID = '33333333-3333-4333-8333-333333333333';
const TOTALS = {
  energyKcal: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  fiberG: 0,
  micros: {},
  unmatchedItems: 0,
};

const day = (over: Partial<FoodDay> = {}): FoodDay => ({
  firstName: 'Ana',
  today: '2026-11-04',
  date: '2026-11-04',
  dayType: 'TRAINING',
  hasPlan: true,
  targets: {
    energyKcal: { min: 2000, max: 2200 },
    proteinG: 160,
    carbsG: 230,
    fatG: 60,
    fiberG: 30,
    waterMl: 3000,
  },
  logs: [],
  totals: { energyKcal: 600, proteinG: 40, carbsG: 70, fatG: 15, fiberG: 8 },
  ...over,
});

const draft: FoodLogDraft = {
  logId: LOG_ID,
  meal: 'LUNCH',
  items: [
    {
      foodItemId: '44444444-4444-4444-8444-444444444444',
      label: 'arroz',
      grams: 150,
      portionSource: 'ESTIMATED',
      matchedName: 'Arroz branco cozido',
    },
    {
      foodItemId: null,
      label: 'unicórnio',
      grams: 100,
      portionSource: 'ESTIMATED',
      matchedName: null,
    },
  ],
  totals: { ...TOTALS, unmatchedItems: 1 },
  needsClarification: null,
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getFoodDay.mockResolvedValue(day());
});

describe('FoodDayView', () => {
  it('mostra a meta do dia e o progresso', async () => {
    render(<FoodDayView />);
    expect(
      await screen.findByRole('heading', { name: /Ana, sua alimentação/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Dia de treino/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Proteína (g)' })).toHaveAttribute(
      'aria-valuenow',
      '40',
    );
    expect(screen.getByText('Nenhuma refeição registrada ainda.')).toBeInTheDocument();
  });

  it('interpreta o texto, deixa corrigir a porção e só então confirma', async () => {
    api.draftFromText.mockResolvedValue(draft);
    api.confirmFoodLog.mockResolvedValue(undefined);
    render(<FoodDayView />);
    await userEvent.type(await screen.findByLabelText('O que você comeu?'), 'arroz e unicórnio');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));

    expect(await screen.findByText('Arroz branco cozido')).toBeInTheDocument();
    expect(screen.getByText(/sem correspondência na tabela/)).toBeInTheDocument();
    expect(api.confirmFoodLog).not.toHaveBeenCalled();

    const grams = screen.getByLabelText(/Gramas de arroz/);
    await userEvent.clear(grams);
    await userEvent.type(grams, '200');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar refeição' }));
    await waitFor(() => expect(api.confirmFoodLog).toHaveBeenCalled());
    expect(api.confirmFoodLog).toHaveBeenCalledWith(LOG_ID, {
      meal: 'LUNCH',
      items: [
        {
          foodItemId: '44444444-4444-4444-8444-444444444444',
          label: 'arroz',
          grams: 200,
          portionSource: 'ESTIMATED',
        },
        { foodItemId: null, label: 'unicórnio', grams: 100, portionSource: 'ESTIMATED' },
      ],
    });
  });

  it('descartar o rascunho apaga o registro não confirmado', async () => {
    api.draftFromText.mockResolvedValue(draft);
    api.removeFoodLog.mockResolvedValue(undefined);
    render(<FoodDayView />);
    await userEvent.type(await screen.findByLabelText('O que você comeu?'), 'arroz');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Descartar' }));
    expect(api.removeFoodLog).toHaveBeenCalledWith(LOG_ID);
  });

  it('erro na interpretação aparece como aviso, sem travar a tela', async () => {
    api.draftFromText.mockRejectedValue(new Error('Não identificamos comida.'));
    render(<FoodDayView />);
    await userEvent.type(await screen.findByLabelText('O que você comeu?'), 'xyz');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não identificamos comida.');
  });

  it('sem plano ainda convida a registrar mesmo assim', async () => {
    api.getFoodDay.mockResolvedValue(day({ targets: null, hasPlan: false }));
    render(<FoodDayView />);
    expect(await screen.findByText(/ainda está sendo preparado/)).toBeInTheDocument();
  });
});
