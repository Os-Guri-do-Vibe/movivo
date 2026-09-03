import type { WorkoutJournal, WorkoutSetInput } from '@movivo/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));

import { WorkoutJournalView } from './workout-journal';

const TODAY = '2026-09-03';

type WorkoutSetView = WorkoutSetInput & {
  previous: {
    reps?: number | null;
    loadValue?: number | null;
    loadUnit: 'KG' | 'LB' | 'BODYWEIGHT' | 'NONE';
    durationSeconds?: number | null;
    date: string;
  } | null;
};

const repsExercise = {
  exerciseId: 'agachamento',
  name: 'Agachamento',
  sets: 3,
  reps: { min: 8, max: 12 },
  loadStrategy: 'FIXED_LOAD' as const,
  restSeconds: 60,
};

const durationExercise = {
  exerciseId: 'prancha',
  name: 'Prancha',
  sets: 1,
  durationSeconds: 45,
  loadStrategy: 'BODYWEIGHT' as const,
  restSeconds: 30,
};

function makeWeek(selectedDate: string) {
  return [
    { date: '2026-08-30', weekday: 'SUN', state: 'COMPLETED' as const },
    { date: '2026-08-31', weekday: 'MON', state: 'COMPLETED' as const },
    { date: '2026-09-01', weekday: 'TUE', state: 'MISSED' as const },
    { date: '2026-09-02', weekday: 'WED', state: 'REST' as const },
    { date: selectedDate, weekday: 'THU', state: 'PLANNED' as const },
    { date: '2026-09-04', weekday: 'FRI', state: 'FUTURE' as const },
    { date: '2026-09-05', weekday: 'SAT', state: 'FUTURE' as const },
  ];
}

function journalFor(selectedDate: string, overrides: Partial<WorkoutJournal> = {}): WorkoutJournal {
  return {
    firstName: 'Ana',
    today: TODAY,
    selectedDate,
    week: makeWeek(selectedDate),
    workout: null,
    ...overrides,
  };
}

function workoutInProgress(
  overrides: Partial<NonNullable<WorkoutJournal['workout']>> = {},
): NonNullable<WorkoutJournal['workout']> {
  const sets: WorkoutSetView[] = [
    {
      exerciseId: 'agachamento',
      setNumber: 1,
      reps: 10,
      loadValue: 45,
      loadUnit: 'KG',
      durationSeconds: null,
      completed: true,
      skipped: false,
      previous: {
        reps: 10,
        loadValue: 40,
        loadUnit: 'KG',
        durationSeconds: null,
        date: '2026-08-27',
      },
    },
    {
      exerciseId: 'agachamento',
      setNumber: 2,
      reps: null,
      loadValue: 35,
      loadUnit: 'KG',
      durationSeconds: null,
      completed: false,
      skipped: false,
      previous: {
        reps: 10,
        loadValue: 40,
        loadUnit: 'KG',
        durationSeconds: null,
        date: '2026-08-27',
      },
    },
    {
      exerciseId: 'agachamento',
      setNumber: 3,
      reps: null,
      loadValue: 40,
      loadUnit: 'KG',
      durationSeconds: null,
      completed: false,
      skipped: false,
      previous: {
        reps: 10,
        loadValue: 40,
        loadUnit: 'KG',
        durationSeconds: null,
        date: '2026-08-27',
      },
    },
    {
      exerciseId: 'prancha',
      setNumber: 1,
      reps: null,
      loadValue: null,
      loadUnit: 'NONE',
      durationSeconds: null,
      completed: false,
      skipped: false,
      previous: null,
    },
  ];
  return {
    id: 'workout-1',
    status: 'IN_PROGRESS',
    prescription: {
      dayLabel: 'Treino A',
      focus: 'Inferiores',
      exercises: [repsExercise, durationExercise],
    },
    startedAt: '2026-09-03T10:00:00.000Z',
    finishedAt: null,
    durationSeconds: null,
    perceivedEffort: null,
    painReported: false,
    sets,
    ...overrides,
  };
}

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function fail(status: number, body: unknown = null): Response {
  return { ok: false, status, json: async () => body } as Response;
}

function parseDateParam(url: string): string {
  const match = /date=([\d-]+)/.exec(url);
  return match?.[1] ?? TODAY;
}

interface FetchHandlers {
  journal?: (url: string) => Response;
  saveSets?: (body: { entries: WorkoutSetInput[] }) => Response;
  start?: () => Response;
  finish?: (body: unknown) => Response;
}

function installFetch(handlers: FetchHandlers = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.startsWith('/api/workout/journal')) {
      if (!handlers.journal) throw new Error('sem handler de journal configurado');
      return handlers.journal(url);
    }
    if (/\/sessions\/[^/]+\/sets$/.test(url) && method === 'PATCH') {
      const body = init?.body
        ? (JSON.parse(init.body as string) as { entries: WorkoutSetInput[] })
        : { entries: [] };
      return handlers.saveSets?.(body) ?? ok({});
    }
    if (/\/sessions\/[^/]+\/start$/.test(url) && method === 'POST') {
      return handlers.start?.() ?? ok({});
    }
    if (/\/sessions\/[^/]+\/finish$/.test(url) && method === 'POST') {
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      return handlers.finish?.(body) ?? ok({});
    }
    throw new Error(`fetch não tratado nos testes: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  navigation.replace.mockReset();
});

describe('WorkoutJournalView — carregamento e sessão', () => {
  it('mostra o estado de preparação antes do primeiro carregamento resolver', () => {
    installFetch({ journal: () => new Promise<Response>(() => {}) as unknown as Response });
    render(<WorkoutJournalView />);
    expect(screen.getByText('Preparando seu treino...')).toBeVisible();
  });

  it('mostra erro quando o carregamento inicial falha (resposta não 401)', async () => {
    installFetch({ journal: () => fail(500) });
    render(<WorkoutJournalView />);
    expect(await screen.findByText('Nao foi possivel carregar seu treino.')).toBeVisible();
  });

  it('redireciona para /treino/acessar quando a sessão expirou (401)', async () => {
    installFetch({ journal: () => fail(401) });
    render(<WorkoutJournalView />);
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/treino/acessar'));
    expect(screen.getByText('Preparando seu treino...')).toBeVisible();
  });

  it('renderiza sem quebrar quando a semana vem vazia', async () => {
    installFetch({ journal: () => ok(journalFor(TODAY, { week: [] })) });
    render(<WorkoutJournalView />);
    expect(await screen.findByText('Ana')).toBeVisible();
  });
});

describe('WorkoutJournalView — dia sem treino e treino concluído', () => {
  it('dia de recuperação quando não há treino prescrito', async () => {
    installFetch({ journal: () => ok(journalFor(TODAY)) });
    render(<WorkoutJournalView />);
    expect(await screen.findByText('Dia de recuperacao')).toBeVisible();
    expect(screen.getByText('Nao ha treino prescrito para este dia.')).toBeVisible();
  });

  it('treino concluído mostra duração e esforço percebido, sem editor de séries', async () => {
    installFetch({
      journal: () =>
        ok(
          journalFor(TODAY, {
            workout: workoutInProgress({
              status: 'COMPLETED',
              durationSeconds: 3725,
              perceivedEffort: 8,
            }),
          }),
        ),
    });
    render(<WorkoutJournalView />);
    expect(await screen.findByText('Treino concluido')).toBeVisible();
    expect(screen.getByText(/Tempo total: 01:02:05/)).toBeVisible();
    expect(screen.getByText(/Esforco 8\/10/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Finalizar treino' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reps')).not.toBeInTheDocument();
  });
});

describe('WorkoutJournalView — iniciar treino', () => {
  it('inicia o treino e recarrega o dia com status em andamento', async () => {
    let reloaded = false;
    const startSpy = vi.fn(() => ok({}));
    installFetch({
      journal: () =>
        ok(
          journalFor(TODAY, {
            workout: workoutInProgress({
              ...(reloaded ? {} : { status: 'PLANNED' as const, startedAt: null }),
            }),
          }),
        ),
      start: () => {
        reloaded = true;
        return startSpy();
      },
    });
    render(<WorkoutJournalView />);
    const startButton = await screen.findByRole('button', { name: 'Iniciar treino' });
    await userEvent.click(startButton);
    await waitFor(() => expect(startSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/^\d{2}:\d{2}:\d{2}$/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Iniciar treino' })).not.toBeInTheDocument();
  });

  it('mostra erro quando iniciar o treino falha, sem travar a tela', async () => {
    installFetch({
      journal: () =>
        ok(
          journalFor(TODAY, { workout: workoutInProgress({ status: 'PLANNED', startedAt: null }) }),
        ),
      start: () => fail(500, { message: 'Não foi possível iniciar.' }),
    });
    render(<WorkoutJournalView />);
    await userEvent.click(await screen.findByRole('button', { name: 'Iniciar treino' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível iniciar.');
    expect(screen.getByRole('button', { name: 'Iniciar treino' })).not.toBeDisabled();
  });
});

describe('WorkoutJournalView — série em andamento', () => {
  it('mostra deltas de carga, estados completo/pendente e campos por tipo de exercício', async () => {
    installFetch({ journal: () => ok(journalFor(TODAY, { workout: workoutInProgress() })) });
    render(<WorkoutJournalView />);
    await screen.findByText('Agachamento');

    expect(screen.getByText('+5kg')).toBeVisible();
    expect(screen.getByText('-5kg')).toBeVisible();
    expect(screen.getByText('—')).toBeVisible();

    expect(screen.getAllByText('Registrada automaticamente')).toHaveLength(1);
    expect(screen.getAllByText('Usara a sugestao')).toHaveLength(3);

    expect(screen.getAllByLabelText('Reps')).toHaveLength(3);
    expect(screen.getByLabelText('Segundos')).toBeVisible();
    expect(screen.getAllByLabelText(/^Carga \(kg\)/)).toHaveLength(4);
  });

  it('edita reps de uma série e salva ao perder o foco', async () => {
    const saveSpy = vi.fn((body: { entries: WorkoutSetInput[] }) => {
      expect(body.entries[1]?.reps).toBe(9);
      return ok({});
    });
    installFetch({
      journal: () => ok(journalFor(TODAY, { workout: workoutInProgress() })),
      saveSets: saveSpy,
    });
    render(<WorkoutJournalView />);
    await screen.findByText('Agachamento');

    const repsInputs = screen.getAllByLabelText('Reps');
    const secondInput = repsInputs[1];
    if (!secondInput) throw new Error('segunda série não encontrada');
    await userEvent.type(secondInput, '9');
    // updateSet marca completed=true de imediato, antes mesmo do PATCH resolver.
    expect(screen.getAllByText('Registrada automaticamente')).toHaveLength(2);
    await userEvent.tab();
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
  });

  it('pula e reinclui um exercício, persistindo a mudança', async () => {
    const saveSpy = vi.fn(() => ok({}));
    installFetch({
      journal: () => ok(journalFor(TODAY, { workout: workoutInProgress() })),
      saveSets: saveSpy,
    });
    render(<WorkoutJournalView />);
    await screen.findByText('Agachamento');

    const skipButtons = screen.getAllByRole('button', { name: 'Pular este exercicio' });
    const skipAgachamento = skipButtons[0];
    if (!skipAgachamento) throw new Error('botão de pular não encontrado');
    await userEvent.click(skipAgachamento);

    await screen.findByText('Este exercicio foi marcado como pulado e nao entrara como realizado.');
    expect(screen.getByRole('button', { name: 'Incluir exercicio novamente' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect(
      saveSpy.mock.calls[0]?.[0]?.entries.filter((e) => e.exerciseId === 'agachamento'),
    ).toSatisfy((entries: WorkoutSetInput[]) => entries.every((entry) => entry.skipped));

    await userEvent.click(screen.getByRole('button', { name: 'Incluir exercicio novamente' }));
    await waitFor(() =>
      expect(
        screen.queryByText('Este exercicio foi marcado como pulado e nao entrara como realizado.'),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(2));
  });

  it('erro ao pular exercício mostra a mensagem enviada pelo servidor', async () => {
    installFetch({
      journal: () => ok(journalFor(TODAY, { workout: workoutInProgress() })),
      saveSets: () => fail(500, { message: 'Falha customizada ao salvar.' }),
    });
    render(<WorkoutJournalView />);
    await screen.findByText('Agachamento');
    const skipButtons = screen.getAllByRole('button', { name: 'Pular este exercicio' });
    const first = skipButtons[0];
    if (!first) throw new Error('botão de pular não encontrado');
    await userEvent.click(first);
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha customizada ao salvar.');
  });

  it('erro sem corpo JSON válido no servidor cai na mensagem padrão', async () => {
    installFetch({
      journal: () => ok(journalFor(TODAY, { workout: workoutInProgress() })),
      saveSets: () =>
        ({
          ok: false,
          status: 500,
          json: async () => {
            throw new Error('corpo inválido');
          },
        }) as Response,
    });
    render(<WorkoutJournalView />);
    await screen.findByText('Agachamento');
    const skipButtons = screen.getAllByRole('button', { name: 'Pular este exercicio' });
    const first = skipButtons[0];
    if (!first) throw new Error('botão de pular não encontrado');
    await userEvent.click(first);
    expect(await screen.findByRole('alert')).toHaveTextContent('Nao foi possivel concluir.');
  });
});

describe('WorkoutJournalView — navegação de semana', () => {
  it('alterna semanas, volta para hoje e navega por um dia específico', async () => {
    installFetch({ journal: (url) => ok(journalFor(parseDateParam(url))) });
    render(<WorkoutJournalView />);
    await screen.findByText('Semana atual');
    expect(screen.getByRole('button', { name: 'Proxima semana' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Voltar para hoje' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Semana anterior' }));
    await screen.findByText('Semana passada');
    expect(screen.getByRole('button', { name: 'Voltar para hoje' })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Semana anterior' }));
    await screen.findByText('2 semanas atras');

    await userEvent.click(screen.getByRole('button', { name: 'Voltar para hoje' }));
    await screen.findByText('Semana atual');
    expect(screen.queryByRole('button', { name: 'Voltar para hoje' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Qua, 2026-09-02' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Qua, 2026-09-02/ })).toHaveAttribute(
        'aria-current',
        'date',
      ),
    );
  });

  it('dia futuro fica desabilitado e não dispara carregamento', async () => {
    const fetchMock = installFetch({ journal: (url) => ok(journalFor(parseDateParam(url))) });
    render(<WorkoutJournalView />);
    await screen.findByText('Semana atual');
    const callsBefore = fetchMock.mock.calls.length;
    const futureDay = screen.getByRole('button', { name: 'Sex, 2026-09-04' });
    expect(futureDay).toBeDisabled();
    await userEvent.click(futureDay);
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });
});

describe('WorkoutJournalView — finalizar treino e feedback', () => {
  it('finaliza a série, exige dados de dor quando reportada e envia a finalização', async () => {
    const finishSpy = vi.fn(() => ok({}));
    const saveSpy = vi.fn(() => ok({}));
    let finished = false;
    installFetch({
      journal: () =>
        ok(
          journalFor(TODAY, {
            workout: finished
              ? workoutInProgress({ status: 'COMPLETED', durationSeconds: 120, perceivedEffort: 7 })
              : workoutInProgress(),
          }),
        ),
      saveSets: saveSpy,
      finish: (body) => {
        finished = true;
        return finishSpy(body);
      },
    });
    render(<WorkoutJournalView />);
    await screen.findByText('Agachamento');

    await userEvent.click(screen.getByRole('button', { name: 'Finalizar treino' }));
    expect(await screen.findByText('Como foi para voce?')).toBeVisible();
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));

    const submit = screen.getByRole('button', { name: 'Enviar e finalizar' });
    expect(submit).not.toBeDisabled();

    await userEvent.click(screen.getByRole('checkbox', { name: /Senti dor/ }));
    expect(submit).toBeDisabled();
    expect(screen.getByText('Isso gera um alerta para o profissional CREF.')).toBeVisible();

    const slider = screen.getByLabelText('Percepcao de esforco');
    (slider as HTMLInputElement).value = '9';
    slider.dispatchEvent(new Event('change', { bubbles: true }));

    await userEvent.selectOptions(
      screen.getByLabelText('Exercicio relacionado a dor'),
      screen.getByRole('option', { name: 'Agachamento' }),
    );
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Descricao da dor'), 'Dor leve no joelho');
    expect(submit).not.toBeDisabled();

    await userEvent.type(screen.getByLabelText('Como voce se sentiu?'), 'Foi puxado');

    await userEvent.click(submit);
    await waitFor(() =>
      expect(finishSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          feelingNotes: 'Foi puxado',
          painReported: true,
          painExerciseId: 'agachamento',
          painNotes: 'Dor leve no joelho',
        }),
      ),
    );
    expect(await screen.findByText('Treino concluido')).toBeVisible();
    expect(screen.getByText(/Esforco 7\/10/)).toBeVisible();
  });

  it('desmarcar "senti dor" libera o envio sem exigir exercício/observações', async () => {
    installFetch({
      journal: () => ok(journalFor(TODAY, { workout: workoutInProgress() })),
      saveSets: () => ok({}),
      finish: () => ok({}),
    });
    render(<WorkoutJournalView />);
    await screen.findByText('Agachamento');
    await userEvent.click(screen.getByRole('button', { name: 'Finalizar treino' }));
    await screen.findByText('Como foi para voce?');

    const checkbox = screen.getByRole('checkbox', { name: /Senti dor/ });
    await userEvent.click(checkbox);
    expect(screen.getByRole('button', { name: 'Enviar e finalizar' })).toBeDisabled();
    await userEvent.click(checkbox);
    expect(screen.getByRole('button', { name: 'Enviar e finalizar' })).not.toBeDisabled();
    expect(
      screen.queryByText('Isso gera um alerta para o profissional CREF.'),
    ).not.toBeInTheDocument();
  });

  it('mostra erro quando finalizar falha e mantém os dados preenchidos', async () => {
    installFetch({
      journal: () => ok(journalFor(TODAY, { workout: workoutInProgress() })),
      saveSets: () => ok({}),
      finish: () => fail(500, { message: 'Falha ao concluir treino.' }),
    });
    render(<WorkoutJournalView />);
    await screen.findByText('Agachamento');
    await userEvent.click(screen.getByRole('button', { name: 'Finalizar treino' }));
    await screen.findByText('Como foi para voce?');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar e finalizar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao concluir treino.');
    expect(screen.getByText('Como foi para voce?')).toBeVisible();
  });
});
