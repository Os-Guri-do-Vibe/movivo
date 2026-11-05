import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ getEvolution: vi.fn(), addMeasurements: vi.fn() }));
vi.mock('@/lib/checkin-api', () => api);
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

import { EvolutionView } from './evolution-view';

const DATA = {
  firstName: 'Ana',
  strategyTitle: 'Recomposição corporal',
  milestones: [
    { milestone: { description: 'Cintura 2 cm menor' }, dueOn: '2026-12-30', status: 'PENDING' },
  ],
  tasks: [
    { title: 'Treinar 3 vezes', target: 3, progress: 2, windowEnd: '2026-11-08', status: 'OPEN' },
  ],
  measurements: {
    WAIST: [
      { on: '2026-10-01', value: 90 },
      { on: '2026-11-01', value: 88 },
    ],
  },
  weeks: Array.from({ length: 8 }, (_, i) => ({
    weekStart: new Date(Date.UTC(2026, 8, 7 + i * 7)).toISOString().slice(0, 10),
    sessions: i % 4,
    load: 100 * i,
  })),
};

beforeEach(() => {
  api.getEvolution.mockReset().mockResolvedValue(DATA);
  api.addMeasurements.mockReset().mockResolvedValue(undefined);
});

describe('EvolutionView', () => {
  it('mostra estratégia, metas, treinos por semana e a variação das medidas', async () => {
    render(<EvolutionView />);
    expect(await screen.findByRole('heading', { name: /Ana, sua evolução/ })).toBeInTheDocument();
    expect(screen.getByText(/Recomposição corporal/)).toBeInTheDocument();
    expect(screen.getByText(/Cintura 2 cm menor/)).toBeInTheDocument();
    expect(screen.getByText(/-2.0 desde/)).toBeInTheDocument();
    expect(screen.getAllByRole('img').length).toBe(8);
  });

  it('registra uma medida e recarrega', async () => {
    render(<EvolutionView />);
    await screen.findByRole('heading', { name: /Ana/ });
    await userEvent.type(screen.getByLabelText(/Valor/), '87,5');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(api.addMeasurements).toHaveBeenCalled());
    expect(api.addMeasurements.mock.calls[0]?.[0]?.[0]).toMatchObject({
      kind: 'WAIST',
      value: 87.5,
      method: 'SELF_TAPE',
    });
    await waitFor(() => expect(api.getEvolution).toHaveBeenCalledTimes(2));
  });

  it('sem sessão pede o link do WhatsApp', async () => {
    const { TrainingApiError } = await import('@/lib/training-api');
    api.getEvolution.mockRejectedValue(new TrainingApiError(401, 'x'));
    render(<EvolutionView />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/link mais recente/);
  });
});
