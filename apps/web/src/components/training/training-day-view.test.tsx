import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  uploadScreenshot: vi.fn(),
  logExternal: vi.fn(),
  saveCheckIn: vi.fn(),
  getShareCard: vi.fn(),
  getShareCardImage: vi.fn(),
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

const SHARE_STRENGTH = {
  layouts: ['CLASSIC', 'MUSCLES', 'SUMMARY', 'HIGHLIGHT'],
  data: {
    modality: 'STRENGTH',
    title: 'Força A',
    durationSeconds: 2_700,
    exercises: 1,
    sets: 2,
    volumeKg: 960,
    rpe: 7,
    body: 'female',
    muscles: ['quadriceps'],
  },
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getShareCard.mockResolvedValue(SHARE_STRENGTH);
  api.getShareCardImage.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
  URL.createObjectURL = vi.fn(() => 'blob:cartao');
  URL.revokeObjectURL = vi.fn();
});

const STARTED = new Date(Date.now() - 30 * 60_000).toISOString();
const running = (over: Partial<ExecutionView> = {}) => execution({ startedAt: STARTED, ...over });
const pick = (group: string, value: string) =>
  userEvent.click(
    within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name: value }),
  );
const answerDay = async () => {
  await pick('Como foi a qualidade da sua noite de sono?', 'Boa');
  await userEvent.type(screen.getByLabelText('Quantas horas você dormiu hoje?'), '730');
  await pick('Como está sua disposição hoje?', 'Disposto(a)');
  await pick('Como está seu nível de stress hoje?', 'Tranquilo(a)');
  await pick('Como está seu humor hoje?', 'Bom humor');
};

describe('TrainingDayView · etapa 2 (perguntas do dia)', () => {
  it('vem antes do treino e só libera com as cinco escalas respondidas', async () => {
    api.getTrainingDay
      .mockResolvedValueOnce({ ...dayWith(STRENGTH), checkedInToday: false })
      .mockResolvedValue({ ...dayWith(STRENGTH), checkedInToday: true });
    api.saveCheckIn.mockResolvedValue(undefined);
    render(<TrainingDayView />);

    expect(
      await screen.findByRole('heading', { name: 'Como você está hoje?' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Força A' })).not.toBeInTheDocument();
    const next = screen.getByRole('button', { name: 'Continuar para o treino' });
    expect(next).toBeDisabled();
    await answerDay();
    await userEvent.click(next);
    await waitFor(() =>
      expect(api.saveCheckIn).toHaveBeenCalledWith({
        energy: 4,
        sleep: 4,
        sleepMinutes: 450,
        mood: 5,
        // "Tranquilo(a)" (4 de 5, da esquerda "muito estressado") é gravado como estresse 2.
        stress: 2,
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Força A' })).toBeInTheDocument();
  });

  it('horas de sono inválidas avisam e não deixam continuar', async () => {
    api.getTrainingDay.mockResolvedValue({ ...dayWith(STRENGTH), checkedInToday: false });
    render(<TrainingDayView />);
    await screen.findByRole('heading', { name: 'Como você está hoje?' });
    await answerDay();
    const hours = screen.getByLabelText('Quantas horas você dormiu hoje?');
    await userEvent.clear(hours);
    await userEvent.type(hours, '775');
    expect(hours).toHaveValue('7:75');
    expect(await screen.findByRole('alert')).toHaveTextContent(/entre 1:00 e 16:00/);
    expect(screen.getByRole('button', { name: 'Continuar para o treino' })).toBeDisabled();
  });

  it('"Responder depois" segue para o treino sem gravar nada', async () => {
    api.getTrainingDay.mockResolvedValue({ ...dayWith(STRENGTH), checkedInToday: false });
    render(<TrainingDayView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Responder depois' }));
    expect(await screen.findByRole('heading', { name: 'Força A' })).toBeInTheDocument();
    expect(api.saveCheckIn).not.toHaveBeenCalled();
  });

  it('no dia de descanso, responde e mostra o dia de recuperação', async () => {
    const rest = { ...dayWith(STRENGTH), selected: [] };
    api.getTrainingDay
      .mockResolvedValueOnce({ ...rest, checkedInToday: false })
      .mockResolvedValue({ ...rest, checkedInToday: true });
    api.saveCheckIn.mockResolvedValue(undefined);
    render(<TrainingDayView />);
    await screen.findByRole('heading', { name: 'Como você está hoje?' });
    await answerDay();
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText('Dia de recuperação')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Check-in do dia registrado');
  });
});

describe('TrainingDayView · etapa 3 (o treino)', () => {
  it('mostra o treino sem a frase de metodologia e inicia com o cronômetro', async () => {
    api.getTrainingDay
      .mockResolvedValueOnce(dayWith(STRENGTH))
      .mockResolvedValue(dayWith(STRENGTH, running()));
    api.startSession.mockResolvedValue(running());
    render(<TrainingDayView />);

    expect(await screen.findByRole('heading', { name: /Ana, seu treino/ })).toBeInTheDocument();
    expect(screen.queryByText(/metodologia dos profissionais/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar' }));
    expect(api.startSession).toHaveBeenCalledWith(SESSION_ID);
    expect(await screen.findByRole('timer', { name: 'Tempo de treino' })).toHaveTextContent(
      /^\d{2}:\d{2}:\d{2}$/,
    );
    expect(await screen.findByText('Agachamento com barra')).toBeInTheDocument();
    // Sem o "Feito" com caixinha: os botões são os da versão anterior.
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pular este exercício' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Concluído' })).toBeInTheDocument();
    // Treino em andamento trava a troca de semana.
    expect(screen.getByRole('button', { name: 'Semana anterior' })).toBeDisabled();
  });

  it('o cronômetro conta desde o "Iniciar" (00:30:xx depois de 30 minutos)', async () => {
    api.getTrainingDay.mockResolvedValue(dayWith(STRENGTH, running()));
    render(<TrainingDayView />);
    expect(await screen.findByRole('timer')).toHaveTextContent(/^00:30:\d{2}$/);
  });

  it('"Concluído" grava as séries digitadas e risca o exercício', async () => {
    api.getTrainingDay.mockResolvedValue(dayWith(STRENGTH, running()));
    api.saveSets.mockResolvedValue(running());
    render(<TrainingDayView />);
    await screen.findByText('Agachamento com barra');

    await userEvent.type(screen.getByLabelText('Repetições da série 1'), '10');
    await userEvent.type(screen.getByLabelText('Carga da série 1 em quilos'), '60,5');
    await userEvent.click(screen.getByRole('button', { name: 'Concluído' }));
    await waitFor(() =>
      expect(api.saveSets).toHaveBeenLastCalledWith(EXECUTION_ID, {
        sets: [
          {
            exerciseId: 'agachamento_barra',
            setNumber: 1,
            reps: 10,
            loadKg: 60.5,
            durationSeconds: null,
            rir: 2,
            completed: true,
          },
          {
            exerciseId: 'agachamento_barra',
            setNumber: 2,
            reps: null,
            loadKg: null,
            durationSeconds: null,
            rir: 2,
            completed: false,
          },
        ],
      }),
    );
    expect(screen.getByRole('heading', { name: 'Agachamento com barra' })).toHaveClass(
      'line-through',
    );
  });

  it('"Pular este exercício" tira ele do registro e permite incluir de novo', async () => {
    api.getTrainingDay.mockResolvedValue(dayWith(STRENGTH, running()));
    api.saveSets.mockResolvedValue(running());
    render(<TrainingDayView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Pular este exercício' }));
    expect(await screen.findByText(/marcado como pulado/)).toBeInTheDocument();
    expect(
      api.saveSets.mock.calls[0]?.[1].sets.every((set: { completed: boolean }) => !set.completed),
    ).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Incluir exercício novamente' }));
    expect(screen.getByLabelText('Repetições da série 1')).toBeInTheDocument();
  });
});

describe('TrainingDayView · etapa 4 (questionário pós-treino)', () => {
  it('PSE, como se sentiu e dor: envia e leva ao treino concluído com o cartão', async () => {
    api.getTrainingDay
      .mockResolvedValueOnce(dayWith(STRENGTH, running()))
      .mockResolvedValueOnce(dayWith(STRENGTH, running()))
      .mockResolvedValue(
        dayWith(STRENGTH, execution({ status: 'COMPLETED', rpe: 8, durationMinutes: 45 })),
      );
    api.finishExecution.mockResolvedValue(execution({ status: 'COMPLETED' }));
    render(<TrainingDayView />);

    await userEvent.click(await screen.findByRole('button', { name: 'Finalizar treino' }));
    expect(await screen.findByRole('heading', { name: 'Como foi para você?' })).toBeInTheDocument();
    // Nenhuma série feita: sugere "Fiz uma parte".
    expect(screen.getByRole('radio', { name: 'Fiz uma parte' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await pick('Você fez o treino?', 'Fiz tudo');
    fireEvent.change(screen.getByLabelText('Percepção de esforço'), { target: { value: '8' } });
    expect(screen.getByText('8/10')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Como você se sentiu?'), 'Pesado no fim.');
    await userEvent.click(screen.getByRole('button', { name: 'Sim' }));
    await userEvent.selectOptions(screen.getByLabelText('Como é a dor'), 'SHARP');
    await userEvent.click(screen.getByLabelText('Atrapalha o movimento'));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar e finalizar' }));

    await waitFor(() => expect(api.finishExecution).toHaveBeenCalled());
    expect(api.finishExecution).toHaveBeenCalledWith(EXECUTION_ID, {
      status: 'COMPLETED',
      rpe: 8,
      durationMinutes: 30,
      enjoyment: null,
      feedback: 'Pesado no fim.',
      painReports: [
        {
          region: 'ombro',
          intensity: 3,
          during: 'DURING',
          character: 'SHARP',
          limitsMovement: true,
        },
      ],
    });
    // Etapa 5: concluído, com o tempo total e o cartão.
    expect(await screen.findByRole('heading', { name: 'Treino concluído' })).toBeInTheDocument();
    expect(screen.getByText(/Tempo total: 00:45:00 · Esforço 8\/10/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Cartão do treino' })).toBeInTheDocument();
  });

  it('corrida: tempo, distância, ritmo e FC digitados à mão ao finalizar', async () => {
    api.getTrainingDay.mockResolvedValue(dayWith(RUNNING, running()));
    api.saveMetrics.mockResolvedValue(running({ metricsConfirmed: true }));
    api.finishExecution.mockResolvedValue(execution({ status: 'COMPLETED' }));
    render(<TrainingDayView />);

    await userEvent.click(await screen.findByRole('button', { name: 'Finalizar treino' }));
    await userEvent.type(await screen.findByLabelText('Tempo total'), '00:28:10');
    await userEvent.type(screen.getByLabelText('Distância (km)'), '5');
    expect(screen.getByText(/Pela distância e o tempo: 5:38 \/km/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('FC média (bpm)'), '150');
    await userEvent.type(screen.getByLabelText('FC máxima (bpm)'), '172');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar e finalizar' }));

    await waitFor(() => expect(api.finishExecution).toHaveBeenCalled());
    expect(api.saveMetrics).toHaveBeenCalledWith(EXECUTION_ID, {
      confirmed: true,
      metrics: {
        movingSeconds: 1_690,
        distanceMeters: 5_000,
        avgPaceSecondsPerKm: 338,
        avgHeartRate: 150,
        maxHeartRate: 172,
      },
    });
    expect(api.finishExecution.mock.calls[0]?.[1]).toMatchObject({
      status: 'COMPLETED',
      rpe: 5,
      durationMinutes: 28,
    });
  });

  it('corrida: os números lidos do relógio chegam preenchidos para conferir', async () => {
    api.getTrainingDay.mockResolvedValue(
      dayWith(
        RUNNING,
        running({
          source: 'FIT_FILE',
          metrics: { distanceMeters: 5_000, movingSeconds: 1_690, avgHeartRate: 152 },
        }),
      ),
    );
    render(<TrainingDayView />);
    expect(await screen.findByText('Números lidos do relógio')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Finalizar treino' }));
    expect(await screen.findByLabelText('Tempo total')).toHaveValue('00:28:10');
    expect(screen.getByLabelText('Distância (km)')).toHaveValue('5');
    expect(screen.getByLabelText('FC média (bpm)')).toHaveValue('152');
  });

  it('número inválido aparece como aviso e nada é enviado', async () => {
    api.getTrainingDay.mockResolvedValue(dayWith(RUNNING, running()));
    render(<TrainingDayView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Finalizar treino' }));
    await userEvent.type(await screen.findByLabelText('FC média (bpm)'), '180');
    await userEvent.type(screen.getByLabelText('FC máxima (bpm)'), '170');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar e finalizar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/FC média não pode ser maior/);
    expect(api.finishExecution).not.toHaveBeenCalled();
  });

  it('"Voltar ao treino" sai do questionário sem fechar', async () => {
    api.getTrainingDay.mockResolvedValue(dayWith(STRENGTH, running()));
    render(<TrainingDayView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Finalizar treino' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Voltar ao treino' }));
    expect(await screen.findByRole('button', { name: 'Finalizar treino' })).toBeInTheDocument();
    expect(api.finishExecution).not.toHaveBeenCalled();
  });
});

describe('TrainingDayView · etapa 5 e navegação', () => {
  it('cartão em carrossel: começa no clássico e as setas trocam o modelo', async () => {
    api.getTrainingDay.mockResolvedValue(
      dayWith(STRENGTH, execution({ status: 'COMPLETED', rpe: 7, durationMinutes: 45 })),
    );
    render(<TrainingDayView />);

    const card = await screen.findByRole('region', { name: 'Cartão do treino' });
    expect(await within(card).findByText(/Clássico/)).toBeInTheDocument();
    expect(within(card).getByText(/1 de 4/)).toBeInTheDocument();
    await waitFor(() =>
      expect(api.getShareCardImage).toHaveBeenCalledWith(EXECUTION_ID, 'CLASSIC'),
    );
    expect(await within(card).findByRole('img')).toHaveAttribute('src', 'blob:cartao');
    // Sem escolha de fundo: o PNG é sempre transparente.
    expect(within(card).queryByRole('radiogroup')).not.toBeInTheDocument();

    await userEvent.click(within(card).getByRole('button', { name: 'Próximo modelo' }));
    expect(within(card).getByText(/2 de 4/)).toBeInTheDocument();
    expect(api.getShareCardImage).toHaveBeenCalledWith(EXECUTION_ID, 'MUSCLES');
    await userEvent.click(within(card).getByRole('button', { name: 'Modelo anterior' }));
    await userEvent.click(within(card).getByRole('button', { name: 'Modelo anterior' }));
    expect(within(card).getByText(/Destaque/)).toBeInTheDocument();
    expect(within(card).getByText(/4 de 4/)).toBeInTheDocument();
  });

  it('treino em andamento não oferece cartão', async () => {
    api.getTrainingDay.mockResolvedValue(dayWith(STRENGTH, running()));
    render(<TrainingDayView />);
    await screen.findByRole('button', { name: 'Finalizar treino' });
    expect(screen.queryByRole('region', { name: 'Cartão do treino' })).not.toBeInTheDocument();
    expect(api.getShareCard).not.toHaveBeenCalled();
  });

  it('dia de descanso e plano ainda não pronto têm mensagens próprias', async () => {
    api.getTrainingDay.mockResolvedValue({ ...dayWith(STRENGTH), selected: [] });
    const { unmount } = render(<TrainingDayView />);
    expect(await screen.findByText('Dia de recuperação')).toBeInTheDocument();
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

  it('as setas navegam entre semanas, sem passar do início do plano nem de hoje', async () => {
    api.getTrainingDay.mockImplementation(async (date?: string) => {
      const day = dayWith(STRENGTH);
      if (!date) return { ...day, firstScheduledOn: '2026-10-26' };
      const week = Array.from({ length: 7 }, (_, i) => ({
        date: `2026-10-${26 + i}`.replace('2026-10-32', '2026-11-01'),
        sessions: [],
      }));
      return { ...day, date, week, selected: [], firstScheduledOn: '2026-10-26' };
    });
    render(<TrainingDayView />);

    await screen.findByRole('heading', { name: 'Força A' });
    expect(screen.getByText('Semana atual')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Próxima semana' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Semana anterior' }));
    await waitFor(() => expect(api.getTrainingDay).toHaveBeenLastCalledWith('2026-10-28'));
    expect(await screen.findByText('Semana passada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Semana anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Próxima semana' })).toBeEnabled();
  });
});
