import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExecutionView, TrainingDay } from '@movivo/shared';

const api = vi.hoisted(() => ({
  getTrainingDay: vi.fn(),
  startSession: vi.fn(),
  finishExecution: vi.fn(),
  saveSets: vi.fn(),
  saveMetrics: vi.fn(),
  uploadActivityFile: vi.fn(),
  logExternal: vi.fn(),
}));
vi.mock('@/lib/training-api', () => ({
  ...api,
  TrainingApiError: class extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

import { TrainingDayView } from './training-day-view';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const EXECUTION_ID = '22222222-2222-4222-8222-222222222222';

const execution = (over: Partial<ExecutionView> = {}): ExecutionView => ({
  id: EXECUTION_ID,
  status: 'IN_PROGRESS',
  source: 'LINK',
  sets: [],
  metrics: null,
  metricsConfirmed: false,
  rpe: null,
  durationMinutes: null,
  enjoyment: null,
  ...over,
});

function dayWith(
  content: TrainingDay['selected'][number]['content'],
  ex: ExecutionView | null = null,
): TrainingDay {
  const week = Array.from({ length: 7 }, (_, i) => ({
    date: `2026-11-0${2 + i}`,
    sessions: [],
  }));
  return {
    firstName: 'Ana',
    today: '2026-11-04',
    date: '2026-11-04',
    hasPlan: true,
    week,
    selected: [
      {
        scheduledSessionId: SESSION_ID,
        planSessionKey: 'S1',
        title: content.modality === 'STRENGTH' ? 'Força A' : 'Rodagem leve',
        purpose: 'Construir base.',
        modality: content.modality,
        priority: 'KEY',
        estimatedMinutes: 45,
        estimatedRpe: 6,
        scheduledOn: '2026-11-04',
        slot: 'EVENING',
        status: 'PLANNED',
        content,
        execution: ex,
      },
    ],
  };
}

const STRENGTH = {
  modality: 'STRENGTH' as const,
  focus: 'Corpo todo',
  exercises: [
    {
      exerciseId: 'agachamento_barra',
      name: 'Agachamento com barra',
      sets: 2,
      reps: { min: 8, max: 12 },
      loadStrategy: 'DOUBLE_PROGRESSION' as const,
      rir: 2,
      restSeconds: 90,
    },
  ],
};
const RUNNING = {
  modality: 'RUNNING' as const,
  kind: 'EASY' as const,
  terrain: 'ANY' as const,
  segments: [
    {
      type: 'STEADY' as const,
      distanceMeters: 5_000,
      target: { by: 'ZONE' as const, zone: 'Z2' as const },
    },
  ],
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('TrainingDayView', () => {
  it('mostra o treino do dia e abre a execução ao começar', async () => {
    api.getTrainingDay.mockResolvedValue(dayWith(STRENGTH));
    api.startSession.mockResolvedValue(execution());
    render(<TrainingDayView />);

    expect(await screen.findByRole('heading', { name: /Ana, seu treino/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Força A' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Começar treino' }));
    expect(api.startSession).toHaveBeenCalledWith(SESSION_ID);
    expect(await screen.findByText('Agachamento com barra')).toBeInTheDocument();
    expect(screen.getByText('Série 2')).toBeInTheDocument();
  });

  it('grava a série ao marcá-la como feita', async () => {
    api.getTrainingDay.mockResolvedValue(dayWith(STRENGTH, execution()));
    api.saveSets.mockResolvedValue(execution());
    render(<TrainingDayView />);
    await screen.findByText('Agachamento com barra');

    await userEvent.type(screen.getByLabelText('Repetições da série 1'), '10');
    await userEvent.type(screen.getByLabelText('Carga da série 1 em quilos'), '60');
    const [done] = screen.getAllByRole('checkbox', { name: 'Feita' });
    await userEvent.click(done as HTMLElement);
    await waitFor(() => expect(api.saveSets).toHaveBeenCalled());
    expect(api.saveSets).toHaveBeenLastCalledWith(EXECUTION_ID, {
      sets: [
        {
          exerciseId: 'agachamento_barra',
          setNumber: 1,
          reps: 10,
          loadKg: 60,
          durationSeconds: null,
          rir: 2,
          completed: true,
        },
      ],
    });
  });

  it('só conclui com esforço e minutos, e envia o fechamento', async () => {
    api.getTrainingDay.mockResolvedValue(dayWith(STRENGTH, execution()));
    api.finishExecution.mockResolvedValue(
      execution({ status: 'COMPLETED', rpe: 7, durationMinutes: 45 }),
    );
    render(<TrainingDayView />);
    await screen.findByRole('button', { name: 'Concluí' });

    await userEvent.clear(screen.getByLabelText('Quantos minutos durou?'));
    await userEvent.click(screen.getByRole('button', { name: 'Concluí' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/esforço e quantos minutos/);
    expect(api.finishExecution).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('radio', { name: '7' }));
    await userEvent.type(screen.getByLabelText('Quantos minutos durou?'), '45');
    await userEvent.click(screen.getByRole('button', { name: 'Concluí' }));
    await waitFor(() => expect(api.finishExecution).toHaveBeenCalled());
    expect(api.finishExecution).toHaveBeenCalledWith(EXECUTION_ID, {
      status: 'COMPLETED',
      rpe: 7,
      durationMinutes: 45,
      enjoyment: null,
      painReports: [],
    });
  });

  it('relata dor junto do fechamento', async () => {
    api.getTrainingDay.mockResolvedValue(dayWith(STRENGTH, execution()));
    api.finishExecution.mockResolvedValue(execution({ status: 'PARTIAL' }));
    render(<TrainingDayView />);
    await screen.findByRole('button', { name: 'Fiz só uma parte' });

    await userEvent.click(screen.getByRole('radio', { name: '8' }));
    await userEvent.type(screen.getByLabelText('Quantos minutos durou?'), '30');
    await userEvent.click(screen.getByLabelText('Sim, senti dor'));
    await userEvent.click(screen.getByRole('button', { name: 'Fiz só uma parte' }));
    await waitFor(() => expect(api.finishExecution).toHaveBeenCalled());
    expect(api.finishExecution.mock.calls[0]?.[1]).toMatchObject({
      status: 'PARTIAL',
      painReports: [{ region: 'ombro', intensity: 3, during: 'DURING' }],
    });
  });

  it('corrida: números lidos do arquivo precisam de confirmação antes de concluir', async () => {
    const imported = execution({
      source: 'FIT_FILE',
      metrics: {
        distanceMeters: 5_000,
        movingSeconds: 1_690,
        avgHeartRate: 152,
        avgPaceSecondsPerKm: 338,
      },
      metricsConfirmed: false,
    });
    api.getTrainingDay.mockResolvedValue(dayWith(RUNNING, imported));
    api.saveMetrics.mockResolvedValue({ ...imported, metricsConfirmed: true });
    render(<TrainingDayView />);

    expect(await screen.findByText('Números lidos do arquivo')).toBeInTheDocument();
    expect(screen.getByText('5 km')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Concluí' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Está certo' }));
    expect(api.saveMetrics).toHaveBeenCalledWith(EXECUTION_ID, {
      metrics: imported.metrics,
      confirmed: true,
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Concluí' })).toBeEnabled());
  });

  it('dia de descanso e plano ainda não pronto têm mensagens próprias', async () => {
    api.getTrainingDay.mockResolvedValue({ ...dayWith(STRENGTH), selected: [] });
    const { unmount } = render(<TrainingDayView />);
    expect(await screen.findByText(/Dia de descanso/)).toBeInTheDocument();
    unmount();
    api.getTrainingDay.mockResolvedValue({ ...dayWith(STRENGTH), selected: [], hasPlan: false });
    render(<TrainingDayView />);
    expect(await screen.findByText(/ainda está sendo preparado/)).toBeInTheDocument();
  });

  it('sessão sem acesso (401) pede o link do WhatsApp', async () => {
    const { TrainingApiError } = await import('@/lib/training-api');
    api.getTrainingDay.mockRejectedValue(new TrainingApiError(401, 'x'));
    render(<TrainingDayView />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/link mais recente/);
  });
});
