/**
 * Jornada de tela da agenda flexível no diário (`/treino`), contra um backend FAKE com estado
 * (o mesmo contrato do BFF): o aluno abre o link do registro tardio (`?date=`), toca em
 * "Registrar este treino", registra sem cronômetro, finaliza e vê "Registrado depois", tudo no
 * dia do treino (nenhuma chamada escorrega para "hoje"). E a regressão do dia de hoje: o fluxo
 * normal (Iniciar, cronômetro) não muda, mesmo que o backend marque `canLogLate` por engano.
 *
 * Os testes de unidade do componente (`workout-journal.test.tsx`) cobrem cada estado isolado;
 * aqui a sequência inteira roda numa única tela, como o aluno a vive.
 */
import type { WorkoutJournal } from '@movivo/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));

import { WorkoutJournalView } from './workout-journal';

const TODAY = '2026-10-20';
const YESTERDAY = '2026-10-19';

type Workout = NonNullable<WorkoutJournal['workout']>;

function plannedWorkout(id: string, overrides: Partial<Workout> = {}): Workout {
  return {
    id,
    status: 'PLANNED',
    prescription: {
      dayLabel: 'A',
      focus: 'Peito e Bíceps',
      exercises: [
        {
          exerciseId: 'supino_reto_barra',
          name: 'Supino reto com barra',
          sets: 1,
          reps: { min: 8, max: 12 },
          loadStrategy: 'DOUBLE_PROGRESSION',
          restSeconds: 90,
        },
      ],
    },
    startedAt: null,
    finishedAt: null,
    durationSeconds: null,
    perceivedEffort: null,
    painReported: false,
    sets: [
      {
        exerciseId: 'supino_reto_barra',
        setNumber: 1,
        reps: 10,
        loadValue: 40,
        loadUnit: 'KG',
        durationSeconds: null,
        completed: true,
        skipped: false,
        previous: {
          reps: 10,
          loadValue: 35,
          loadUnit: 'KG',
          durationSeconds: null,
          date: '2026-10-15',
        },
      },
    ],
    loggedLate: false,
    canLogLate: false,
    ...overrides,
  };
}

function week(): WorkoutJournal['week'] {
  return [
    { date: '2026-10-18', weekday: 'SUN', state: 'COMPLETED' },
    { date: YESTERDAY, weekday: 'MON', state: 'MISSED' },
    { date: TODAY, weekday: 'TUE', state: 'PLANNED' },
    { date: '2026-10-21', weekday: 'WED', state: 'FUTURE' },
    { date: '2026-10-22', weekday: 'THU', state: 'FUTURE' },
    { date: '2026-10-23', weekday: 'FRI', state: 'FUTURE' },
    { date: '2026-10-24', weekday: 'SAT', state: 'FUTURE' },
  ];
}

function json(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response;
}

/**
 * Backend fake com estado: um treino por dia; `late-start`, `sets` e `finish` mudam o estado como
 * a API muda. Registra cada chamada (método + caminho) para conferir a ordem e o dia.
 */
function installBackend(workouts: Record<string, Workout>) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push(`${method} ${url}`);
    if (url.startsWith('/api/workout/journal')) {
      const date = /date=([\d-]+)/.exec(url)?.[1] ?? TODAY;
      return json({
        firstName: 'Rui',
        today: TODAY,
        selectedDate: date,
        week: week(),
        workout: workouts[date] ?? null,
      } satisfies WorkoutJournal);
    }
    const id = /\/sessions\/([^/]+)\//.exec(url)?.[1];
    const entry = Object.entries(workouts).find(([, workout]) => workout.id === id);
    if (!entry) return json({ message: 'Not Found' }, 404);
    const [date, workout] = entry;
    if (url.endsWith('/late-start')) {
      if (!workout.canLogLate) {
        return json({ message: 'So e possivel registrar treinos dos ultimos 2 dias.' }, 400);
      }
      workouts[date] = { ...workout, status: 'IN_PROGRESS', loggedLate: true, canLogLate: false };
      return json({ ok: true });
    }
    if (url.endsWith('/start')) {
      workouts[date] = { ...workout, status: 'IN_PROGRESS', startedAt: new Date().toISOString() };
      return json({ ok: true });
    }
    if (url.endsWith('/sets')) return json({ ok: true });
    if (url.endsWith('/finish')) {
      const body = JSON.parse(String(init?.body)) as { perceivedEffort: number };
      workouts[date] = {
        ...workout,
        status: 'COMPLETED',
        finishedAt: '2026-10-20T11:00:00.000Z',
        durationSeconds: workout.loggedLate ? null : 3000,
        perceivedEffort: body.perceivedEffort,
      };
      return json({ ok: true });
    }
    throw new Error(`chamada não prevista: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

beforeEach(() => {
  navigation.replace.mockReset();
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

describe('registro tardio pela tela, do link até "Registrado depois"', () => {
  it('abre no dia do treino, registra sem cronômetro e finaliza sem sair daquele dia', async () => {
    window.history.replaceState(null, '', `/treino?date=${YESTERDAY}`);
    const { calls } = installBackend({
      [YESTERDAY]: plannedWorkout('w-ontem', { canLogLate: true }),
      [TODAY]: plannedWorkout('w-hoje'),
    });
    render(<WorkoutJournalView />);

    await userEvent.click(await screen.findByRole('button', { name: 'Registrar este treino' }));
    expect(await screen.findByText('Registro tardio')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Iniciar' })).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d\d:\d\d$/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Finalizar treino' }));
    await screen.findByText('Como foi para você?');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar e finalizar' }));

    expect(await screen.findByText('Treino concluído')).toBeVisible();
    expect(screen.getByText(/Registrado depois/)).toBeVisible();
    expect(screen.queryByText(/Tempo total/)).not.toBeInTheDocument();

    // Toda a jornada no treino de ontem: nenhuma chamada caiu no treino de hoje.
    expect(calls.filter((call) => call.includes('w-hoje'))).toEqual([]);
    expect(calls.filter((call) => call.startsWith('GET'))).toEqual([
      `GET /api/workout/journal?date=${YESTERDAY}`,
      `GET /api/workout/journal?date=${YESTERDAY}`,
      `GET /api/workout/journal?date=${YESTERDAY}`,
    ]);
    // As séries são salvas ao abrir o "Como foi para você?" e de novo no envio (como hoje).
    expect([...new Set(calls.filter((call) => !call.startsWith('GET')))]).toEqual([
      'POST /api/workout/sessions/w-ontem/late-start',
      'PATCH /api/workout/sessions/w-ontem/sets',
      'POST /api/workout/sessions/w-ontem/finish',
    ]);
  });

  it('a API recusa (fora da janela): a tela mostra o motivo e continua no dia, sem abrir o treino', async () => {
    window.history.replaceState(null, '', `/treino?date=${YESTERDAY}`);
    const workouts = { [YESTERDAY]: plannedWorkout('w-ontem', { canLogLate: true }) };
    installBackend(workouts);
    render(<WorkoutJournalView />);
    const button = await screen.findByRole('button', { name: 'Registrar este treino' });
    // A janela fechou entre carregar a tela e tocar no botão (passou da meia-noite).
    workouts[YESTERDAY] = { ...workouts[YESTERDAY], canLogLate: false } as Workout;
    await userEvent.click(button);
    expect(
      await screen.findByText('So e possivel registrar treinos dos ultimos 2 dias.'),
    ).toBeVisible();
    expect(screen.queryByText('Registro tardio')).not.toBeInTheDocument();
  });
});

describe('regressão: o treino de hoje segue o fluxo de sempre', () => {
  it('hoje mostra "Iniciar" (nunca "Registrar este treino"), mesmo com canLogLate por engano', async () => {
    installBackend({ [TODAY]: plannedWorkout('w-hoje', { canLogLate: true }) });
    render(<WorkoutJournalView />);
    expect(await screen.findByRole('button', { name: 'Iniciar' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Registrar este treino' })).not.toBeInTheDocument();
  });

  it('Iniciar, registrar e finalizar hoje: com cronômetro e "Tempo total", sem "Registrado depois"', async () => {
    const { calls } = installBackend({ [TODAY]: plannedWorkout('w-hoje') });
    render(<WorkoutJournalView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Iniciar' }));
    await waitFor(() => expect(calls).toContain('POST /api/workout/sessions/w-hoje/start'));
    expect(screen.queryByText('Registro tardio')).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Finalizar treino' }));
    await screen.findByText('Como foi para você?');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar e finalizar' }));
    expect(await screen.findByText(/Tempo total: 00:50:00/)).toBeVisible();
    expect(screen.queryByText(/Registrado depois/)).not.toBeInTheDocument();
    expect(calls.some((call) => call.includes('late-start'))).toBe(false);
  });
});
