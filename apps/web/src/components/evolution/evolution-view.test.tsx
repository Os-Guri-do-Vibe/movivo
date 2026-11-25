import { render, screen, waitFor, within } from '@testing-library/react';
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
    // Uma barra por semana (o logo da faixa do topo também é uma imagem, por isso o recorte).
    expect(
      within(screen.getByRole('region', { name: 'Treinos por semana' })).getAllByRole('img'),
    ).toHaveLength(8);
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

  it('constância, últimas semanas, recordes, previsões e a progressão de força e corrida', async () => {
    const days = Array.from({ length: 28 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 9, 19 + i)).toISOString().slice(0, 10),
      state: i < 24 ? (i % 7 === 4 || i % 7 === 6 ? 'REST' : 'DONE') : 'FUTURE',
    }));
    api.getEvolution.mockResolvedValue({
      ...DATA,
      progress: {
        streak: { current: 12, best: 18, activeToday: true, days },
        consistency: { adherencePct: 92, sessions28d: 17, minutes28d: 905 },
        strength: [
          {
            exerciseId: 'supino',
            name: 'Supino reto',
            sessions: 8,
            points: [
              { date: '2026-10-05', topLoadKg: 60, reps: 9, e1rmKg: 78 },
              { date: '2026-11-09', topLoadKg: 70, reps: 9, e1rmKg: 91 },
            ],
          },
        ],
        running: {
          runs: 6,
          totalKm: 38.5,
          longestKm: 9.2,
          bestPaceSecondsPerKm: 335,
          points: [
            { date: '2026-10-06', distanceKm: 5, paceSecondsPerKm: 370, avgHeartRate: 160 },
            { date: '2026-11-10', distanceKm: 7, paceSecondsPerKm: 335, avgHeartRate: 150 },
          ],
          weeks: [{ weekStart: '2026-11-09', km: 7 }],
        },
        hyrox: null,
        records: [{ label: 'Maior carga · Supino reto', value: '70 kg × 9', date: '2026-11-09' }],
        predictions: {
          basedOn: { date: '2026-11-10', distanceKm: 7, seconds: 2_345 },
          running: [
            { race: '5K', km: 5, seconds: 1_640, paceSecondsPerKm: 328, confidence: 'HIGH' },
            {
              race: 'MARATHON',
              km: 42.195,
              seconds: 15_600,
              paceSecondsPerKm: 370,
              confidence: 'LOW',
            },
          ],
          hyrox: {
            seconds: 5_100,
            runSeconds: 2_950,
            stationsSeconds: 1_790,
            roxzoneSeconds: 360,
            measuredStations: 3,
            confidence: 'MEDIUM',
          },
        },
      },
    });
    render(<EvolutionView />);

    const streak = await screen.findByRole('region', { name: 'Constância' });
    expect(within(streak).getByText('12')).toBeInTheDocument();
    expect(within(streak).getByText(/Recorde: 18 dias/)).toBeInTheDocument();
    expect(within(streak).getByText(/descanso do seu plano não quebram/)).toBeInTheDocument();
    expect(within(streak).getAllByRole('listitem')).toHaveLength(28);
    expect(within(streak).getAllByLabelText(/: descanso$/).length).toBeGreaterThan(0);

    const consistency = screen.getByRole('region', { name: 'Últimas 4 semanas' });
    expect(consistency).toHaveTextContent('92%');
    expect(consistency).toHaveTextContent('15h05');

    expect(
      within(screen.getByRole('region', { name: 'Recordes' })).getByText('70 kg × 9'),
    ).toBeInTheDocument();
    const strength = screen.getByRole('region', { name: 'Força' });
    expect(within(strength).getByText(/1RM estimado: 78 → 91 kg/)).toBeInTheDocument();
    expect(within(strength).getByText('+10 kg')).toBeInTheDocument();
    const running = screen.getByRole('region', { name: 'Corrida' });
    // Ritmo caiu 35 s/km: ficou mais rápido.
    expect(within(running).getByText('−35 s/km')).toBeInTheDocument();
    expect(within(running).getByText(/160 → 150 bpm/)).toBeInTheDocument();

    const predictions = screen.getByRole('region', { name: 'Previsões' });
    expect(within(predictions).getByText('27:20')).toBeInTheDocument();
    expect(within(predictions).getByText('4:20:00')).toBeInTheDocument();
    expect(within(predictions).getByText('só um norte')).toBeInTheDocument();
    expect(within(predictions).getByText('1:25:00')).toBeInTheDocument();
    expect(within(predictions).getByText(/3 de 8 estações medidas/)).toBeInTheDocument();
    expect(screen.queryByText(/Ofensiva/)).not.toBeInTheDocument();
  });
});
