import type { WorkoutJournal, WorkoutSetInput } from '@movivo/shared';
import { render, screen, waitFor, within } from '@testing-library/react';
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
    expect(await screen.findByText('Não foi possível carregar seu treino.')).toBeVisible();
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
    expect(await screen.findByText('Dia de recuperação')).toBeVisible();
    expect(screen.getByText('Não há treino prescrito para este dia.')).toBeVisible();
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
    expect(await screen.findByText('Treino concluído')).toBeVisible();
    expect(screen.getByText(/Tempo total: 01:02:05/)).toBeVisible();
    expect(screen.getByText(/Esforço 8\/10/)).toBeVisible();
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

  // Achado 2026-09-10 (pedido do fundador): dia passado é só consulta de protocolo e
  // carga/repetições — nunca pode virar um treino "iniciado" retroativo.
  it('dia passado nunca mostra "Iniciar treino", mesmo com sessão ainda PLANNED', async () => {
    installFetch({
      journal: () =>
        ok(
          journalFor('2026-09-01', {
            workout: workoutInProgress({ status: 'PLANNED', startedAt: null }),
          }),
        ),
    });
    render(<WorkoutJournalView />);
    await screen.findByText('Agachamento');
    expect(screen.queryByRole('button', { name: 'Iniciar treino' })).not.toBeInTheDocument();
    expect(screen.getByText('Dia encerrado')).toBeVisible();
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

    expect(screen.getAllByLabelText('Reps 8-12')).toHaveLength(3);
    expect(screen.getAllByLabelText(/^Carga \(kg\)/)).toHaveLength(4);

    // Com histórico: placeholder nomeia o treino passado, não um valor solto.
    expect(screen.getAllByPlaceholderText('Treino passado: 10')).toHaveLength(3);
    expect(screen.getAllByPlaceholderText('Treino passado: 40')).toHaveLength(3);

    // Só o primeiro exercício vem aberto; o segundo (Prancha) precisa ser expandido.
    await userEvent.click(screen.getByText('Prancha'));
    expect(screen.getByLabelText('Tempo')).toBeVisible();

    // Sem histórico (Prancha nunca foi feita): placeholder cai para o traço.
    expect(screen.getByLabelText('Tempo')).toHaveAttribute('placeholder', '—');
    expect(screen.getByLabelText('Carga (kg)', { selector: 'input' })).toHaveAttribute(
      'placeholder',
      '—',
    );
  });

  it('exercício de cardio (isCardio) não mostra campos de input, só "Pular" (em cima) e "Concluído" (embaixo)', async () => {
    const saveSpy = vi.fn(() => ok({}));
    installFetch({
      journal: () =>
        ok(
          journalFor(TODAY, {
            workout: workoutInProgress({
              prescription: {
                dayLabel: 'Treino C',
                focus: 'Condicionamento',
                exercises: [
                  {
                    exerciseId: 'bicicleta_horizontal',
                    name: 'Bicicleta Horizontal',
                    sets: 1,
                    durationSeconds: 600,
                    loadStrategy: 'BODYWEIGHT',
                    restSeconds: 0,
                    isCardio: true,
                  },
                ],
              },
              sets: [
                {
                  exerciseId: 'bicicleta_horizontal',
                  setNumber: 1,
                  reps: null,
                  loadValue: null,
                  loadUnit: 'NONE',
                  durationSeconds: null,
                  completed: false,
                  skipped: false,
                  previous: null,
                },
              ],
            }),
          }),
        ),
      saveSets: saveSpy,
    });
    render(<WorkoutJournalView />);
    const heading = await screen.findByText('Bicicleta Horizontal');
    const exerciseCard = heading.closest('details');
    if (!exerciseCard) throw new Error('container do exercício não encontrado');

    expect(within(exerciseCard).queryByRole('textbox')).not.toBeInTheDocument();
    const buttons = within(exerciseCard).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Pular este exercício',
      'Concluído',
    ]);

    await userEvent.click(within(exerciseCard).getByRole('button', { name: 'Concluído' }));

    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    const lastCall = saveSpy.mock.calls.at(-1)?.[0] as { entries: WorkoutSetInput[] };
    expect(lastCall.entries[0]).toMatchObject({
      exerciseId: 'bicicleta_horizontal',
      durationSeconds: 600,
      completed: true,
    });

    expect(exerciseCard).not.toHaveAttribute('open');
    expect(screen.getByText('Bicicleta Horizontal')).toHaveClass('line-through');
  });

  it('campo "Tempo": converte segundos passados em s/min/h e respeita o limite de 60 s', async () => {
    installFetch({
      journal: () =>
        ok(
          journalFor(TODAY, {
            workout: workoutInProgress({
              prescription: {
                dayLabel: 'Treino A',
                focus: 'Cardio',
                exercises: [
                  {
                    exerciseId: 'bike',
                    name: 'Bicicleta Horizontal',
                    sets: 1,
                    durationSeconds: 60,
                    loadStrategy: 'BODYWEIGHT',
                    restSeconds: 0,
                  },
                ],
              },
              sets: [
                {
                  exerciseId: 'bike',
                  setNumber: 1,
                  reps: null,
                  loadValue: null,
                  loadUnit: 'NONE',
                  durationSeconds: null,
                  completed: false,
                  skipped: false,
                  previous: {
                    reps: null,
                    loadValue: null,
                    loadUnit: 'NONE',
                    durationSeconds: 600,
                    date: '2026-08-27',
                  },
                },
              ],
            }),
          }),
        ),
    });
    render(<WorkoutJournalView />);

    // Exercício prescrito com 60 s exatos: fica no limite superior de "segundos" (SI).
    expect(await screen.findByText(/60 s · descanso 0 s/)).toBeVisible();

    expect(screen.getByLabelText('Tempo')).toHaveAttribute(
      'placeholder',
      'Treino passado: 10 min',
    );
  });

  it('marca a série de aquecimento (warmupBlocks) com "Aq" antes das séries válidas', async () => {
    installFetch({
      journal: () =>
        ok(
          journalFor(TODAY, {
            workout: workoutInProgress({
              prescription: {
                dayLabel: 'Treino C',
                focus: 'Peito',
                exercises: [
                  {
                    exerciseId: 'supino',
                    name: 'Supino Inclinado (Halter)',
                    sets: 1,
                    reps: { min: 10, max: 15 },
                    loadStrategy: 'DOUBLE_PROGRESSION',
                    restSeconds: 75,
                    warmupBlocks: [{ sets: 1, reps: { min: 12, max: 15 }, restSeconds: 60 }],
                  },
                ],
              },
              sets: [
                {
                  exerciseId: 'supino',
                  setNumber: 0,
                  reps: null,
                  loadValue: null,
                  loadUnit: 'KG',
                  durationSeconds: null,
                  completed: false,
                  skipped: false,
                  previous: null,
                },
                {
                  exerciseId: 'supino',
                  setNumber: 1,
                  reps: null,
                  loadValue: null,
                  loadUnit: 'KG',
                  durationSeconds: null,
                  completed: false,
                  skipped: false,
                  previous: null,
                },
              ],
            }),
          }),
        ),
    });
    render(<WorkoutJournalView />);
    const heading = await screen.findByText('Supino Inclinado (Halter)');
    const exerciseCard = heading.closest('details');
    if (!exerciseCard) throw new Error('container do exercício não encontrado');

    const setLabels = within(exerciseCard).getAllByText(/^(Aq|1)$/);
    expect(setLabels.map((el) => el.textContent)).toEqual(['Aq', '1']);

    expect(within(exerciseCard).getByText('Reps 12-15')).toBeInTheDocument();
    expect(within(exerciseCard).getByText('Reps 10-15')).toBeInTheDocument();
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

    const repsInputs = screen.getAllByLabelText('Reps 8-12');
    const secondInput = repsInputs[1];
    if (!secondInput) throw new Error('segunda série não encontrada');
    await userEvent.type(secondInput, '9');
    await userEvent.tab();
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
  });

  it('carga com vírgula decimal (teclado numérico pt-BR) não trava o campo em NaN', async () => {
    const saveSpy = vi.fn(() => ok({}));
    installFetch({
      journal: () => ok(journalFor(TODAY, { workout: workoutInProgress() })),
      saveSets: saveSpy,
    });
    render(<WorkoutJournalView />);
    await screen.findByText('Agachamento');

    const cargaInputs = screen.getAllByLabelText(/^Carga \(kg\)/, { selector: 'input' });
    const secondCarga = cargaInputs[1];
    if (!secondCarga) throw new Error('segunda série não encontrada');

    // "," é o separador decimal do teclado numérico em pt-BR; Number("20,5") é NaN.
    // O campo preserva o texto digitado (não reformata a cada tecla) e nunca trava em "NaN".
    await userEvent.clear(secondCarga);
    await userEvent.type(secondCarga, '20,5');
    expect(secondCarga).toHaveValue('20,5');
    expect(secondCarga).not.toHaveValue('NaN');

    // O campo continua editável depois: o próximo dígito não vira "NaN2" travado.
    await userEvent.type(secondCarga, '1');
    expect(secondCarga).toHaveValue('20,51');

    await userEvent.tab();
    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    const lastCall = saveSpy.mock.calls.at(-1)?.[0] as { entries: WorkoutSetInput[] };
    expect(lastCall.entries[1]?.loadValue).toBe(20.51);

    // No blur, o texto bruto normaliza para a representação canônica do número salvo.
    expect(secondCarga).toHaveValue('20.51');
  });

  it('digitar uma letra sem querer não apaga o número já digitado', async () => {
    const saveSpy = vi.fn(() => ok({}));
    installFetch({
      journal: () => ok(journalFor(TODAY, { workout: workoutInProgress() })),
      saveSets: saveSpy,
    });
    render(<WorkoutJournalView />);
    await screen.findByText('Agachamento');

    const cargaInputs = screen.getAllByLabelText(/^Carga \(kg\)/, { selector: 'input' });
    const secondCarga = cargaInputs[1];
    if (!secondCarga) throw new Error('segunda série não encontrada');

    await userEvent.clear(secondCarga);
    await userEvent.type(secondCarga, '24');

    // Letra sem querer no meio do número: o texto mostra o erro, mas o valor
    // numérico válido já digitado (24) não pode ser perdido.
    await userEvent.type(secondCarga, 'a');
    expect(secondCarga).toHaveValue('24a');

    await userEvent.tab();
    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    const lastCall = saveSpy.mock.calls.at(-1)?.[0] as { entries: WorkoutSetInput[] };
    expect(lastCall.entries[1]?.loadValue).toBe(24);

    // No blur, o texto inválido some e volta a mostrar o último número válido.
    expect(secondCarga).toHaveValue('24');
  });

  it('ao preencher todas as séries mostra "Concluído"; só o clique recolhe, risca e abre o próximo', async () => {
    installFetch({ journal: () => ok(journalFor(TODAY, { workout: workoutInProgress() })) });
    render(<WorkoutJournalView />);
    await screen.findByText('Agachamento');

    const agachamentoCard = screen.getByText('Agachamento').closest('details');
    const pranchaCard = screen.getByText('Prancha').closest('details');
    if (!agachamentoCard || !pranchaCard) throw new Error('containers não encontrados');

    // Primeiro exercício vem aberto; o próximo (Prancha), fechado.
    expect(agachamentoCard).toHaveAttribute('open');
    expect(pranchaCard).not.toHaveAttribute('open');
    expect(screen.getByText('Agachamento')).not.toHaveClass('line-through');
    expect(
      within(agachamentoCard).getByRole('button', { name: 'Pular este exercício' }),
    ).toBeVisible();

    // Série 1 já tem reps e carga; faltam as séries 2 e 3.
    const repsInputs = screen.getAllByLabelText('Reps 8-12');
    const secondInput = repsInputs[1];
    const thirdInput = repsInputs[2];
    if (!secondInput || !thirdInput) throw new Error('séries 2 e 3 não encontradas');
    await userEvent.type(secondInput, '9');
    await userEvent.tab();
    await userEvent.type(thirdInput, '9');
    await userEvent.tab();

    // Preencher todos os campos troca o botão para "Concluído", mas não recolhe
    // sozinho (achado 2026-09-04: reativo a cada tecla, digitar só o primeiro
    // dígito da carga — ex.: "2" de "24" — já disparava a conclusão sozinho).
    const confirmButton = await within(agachamentoCard).findByRole('button', {
      name: 'Concluído',
    });
    expect(agachamentoCard).toHaveAttribute('open');
    expect(screen.getByText('Agachamento')).not.toHaveClass('line-through');

    await userEvent.click(confirmButton);

    expect(agachamentoCard).not.toHaveAttribute('open');
    expect(screen.getByText('Agachamento')).toHaveClass('line-through');
    expect(pranchaCard).toHaveAttribute('open');
  });

  it('reabrir a página com um exercício já preenchido pelo servidor: já vem recolhido, riscado, e abre o próximo', async () => {
    installFetch({
      journal: () =>
        ok(
          journalFor(TODAY, {
            workout: workoutInProgress({
              sets: [
                {
                  exerciseId: 'agachamento',
                  setNumber: 1,
                  reps: 10,
                  loadValue: 45,
                  loadUnit: 'KG',
                  durationSeconds: null,
                  completed: true,
                  skipped: false,
                  previous: null,
                },
                {
                  exerciseId: 'agachamento',
                  setNumber: 2,
                  reps: 9,
                  loadValue: 35,
                  loadUnit: 'KG',
                  durationSeconds: null,
                  completed: true,
                  skipped: false,
                  previous: null,
                },
                {
                  exerciseId: 'agachamento',
                  setNumber: 3,
                  reps: 9,
                  loadValue: 40,
                  loadUnit: 'KG',
                  durationSeconds: null,
                  completed: true,
                  skipped: false,
                  previous: null,
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
              ],
            }),
          }),
        ),
    });
    render(<WorkoutJournalView />);
    await screen.findByText('Agachamento');

    const agachamentoCard = screen.getByText('Agachamento').closest('details');
    const pranchaCard = screen.getByText('Prancha').closest('details');
    if (!agachamentoCard || !pranchaCard) throw new Error('containers não encontrados');

    expect(agachamentoCard).not.toHaveAttribute('open');
    expect(screen.getByText('Agachamento')).toHaveClass('line-through');
    expect(pranchaCard).toHaveAttribute('open');
  });

  it('pula e reinclui um exercício, persistindo a mudança', async () => {
    const saveSpy = vi.fn(() => ok({}));
    installFetch({
      journal: () => ok(journalFor(TODAY, { workout: workoutInProgress() })),
      saveSets: saveSpy,
    });
    render(<WorkoutJournalView />);
    await screen.findByText('Agachamento');

    const skipButtons = screen.getAllByRole('button', { name: 'Pular este exercício' });
    const skipAgachamento = skipButtons[0];
    if (!skipAgachamento) throw new Error('botão de pular não encontrado');
    await userEvent.click(skipAgachamento);

    await screen.findByText('Este exercício foi marcado como pulado e não entrará como realizado.');
    expect(screen.getByRole('button', { name: 'Incluir exercício novamente' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect(
      saveSpy.mock.calls[0]?.[0]?.entries.filter((e) => e.exerciseId === 'agachamento'),
    ).toSatisfy((entries: WorkoutSetInput[]) => entries.every((entry) => entry.skipped));

    await userEvent.click(screen.getByRole('button', { name: 'Incluir exercício novamente' }));
    await waitFor(() =>
      expect(
        screen.queryByText('Este exercício foi marcado como pulado e não entrará como realizado.'),
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
    const skipButtons = screen.getAllByRole('button', { name: 'Pular este exercício' });
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
    const skipButtons = screen.getAllByRole('button', { name: 'Pular este exercício' });
    const first = skipButtons[0];
    if (!first) throw new Error('botão de pular não encontrado');
    await userEvent.click(first);
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível concluir.');
  });
});

describe('WorkoutJournalView — navegação de semana', () => {
  it('alterna semanas, volta para hoje e navega por um dia específico', async () => {
    installFetch({ journal: (url) => ok(journalFor(parseDateParam(url))) });
    render(<WorkoutJournalView />);
    await screen.findByText('Quinta-feira, 3 de setembro de 2026');
    expect(screen.getByRole('button', { name: 'Proxima semana' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Voltar para hoje' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Semana anterior' }));
    await screen.findByText('Quinta-feira, 27 de agosto de 2026');
    expect(screen.getByRole('button', { name: 'Voltar para hoje' })).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Semana anterior' }));
    await screen.findByText('Quinta-feira, 20 de agosto de 2026');

    await userEvent.click(screen.getByRole('button', { name: 'Voltar para hoje' }));
    await screen.findByText('Quinta-feira, 3 de setembro de 2026');
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
    await screen.findByText('Quinta-feira, 3 de setembro de 2026');
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
    expect(await screen.findByText('Como foi para você?')).toBeVisible();
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));

    // Legenda nas extremidades e no meio da barra de percepção de esforço.
    expect(screen.getByText('Muito fácil')).toBeVisible();
    expect(screen.getByText('Moderado')).toBeVisible();
    expect(screen.getByText('Muito difícil')).toBeVisible();

    const submit = screen.getByRole('button', { name: 'Enviar e finalizar' });
    expect(submit).not.toBeDisabled();

    expect(screen.getByText('Sentiu dor durante o treino?')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Sim' }));
    expect(submit).toBeDisabled();
    expect(screen.getByText('Isso gera um alerta para o profissional CREF.')).toBeVisible();

    const slider = screen.getByLabelText('Percepção de esforço');
    (slider as HTMLInputElement).value = '9';
    slider.dispatchEvent(new Event('change', { bubbles: true }));

    // Combobox: fechado por padrão, some do texto o "Selecione os exercícios" e
    // abre ao clicar, mostrando as caixas de marcação dos exercícios.
    expect(screen.getByText('Selecione os exercícios')).toBeVisible();
    await userEvent.click(screen.getByText('Selecione os exercícios'));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Agachamento' }));
    expect(screen.getByRole('checkbox', { name: 'Agachamento' })).toBeChecked();
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Descrição da dor'), 'Dor leve no joelho');
    expect(submit).not.toBeDisabled();

    await userEvent.type(screen.getByLabelText('Como você se sentiu?'), 'Foi puxado');

    await userEvent.click(submit);
    await waitFor(() =>
      expect(finishSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          feelingNotes: 'Foi puxado',
          painReported: true,
          painExerciseIds: ['agachamento'],
          painNotes: 'Dor leve no joelho',
        }),
      ),
    );
    expect(await screen.findByText('Treino concluído')).toBeVisible();
    expect(screen.getByText(/Esforço 7\/10/)).toBeVisible();
  });

  it('permite marcar dor em mais de um exercício (multi-select)', async () => {
    const finishSpy = vi.fn(() => ok({}));
    installFetch({
      journal: () => ok(journalFor(TODAY, { workout: workoutInProgress() })),
      saveSets: () => ok({}),
      finish: finishSpy,
    });
    render(<WorkoutJournalView />);
    await screen.findByText('Agachamento');
    await userEvent.click(screen.getByRole('button', { name: 'Finalizar treino' }));
    await screen.findByText('Como foi para você?');

    await userEvent.click(screen.getByRole('button', { name: 'Sim' }));
    const trigger = screen.getByText('Selecione os exercícios');
    const combobox = trigger.closest('summary');
    if (!combobox) throw new Error('combobox não encontrado');
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Agachamento' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Prancha' }));
    expect(screen.getByRole('checkbox', { name: 'Agachamento' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Prancha' })).toBeChecked();
    // Junção natural em pt-BR no rótulo do combobox: "Agachamento e Prancha".
    expect(combobox).toHaveTextContent('Agachamento e Prancha');
    await userEvent.type(screen.getByLabelText('Descrição da dor'), 'Dor nas duas séries');

    await userEvent.click(screen.getByRole('button', { name: 'Enviar e finalizar' }));
    await waitFor(() =>
      expect(finishSpy).toHaveBeenCalledWith(
        expect.objectContaining({ painExerciseIds: ['agachamento', 'prancha'] }),
      ),
    );
  });

  it('clicar em "Não" libera o envio sem exigir exercício/observações', async () => {
    installFetch({
      journal: () => ok(journalFor(TODAY, { workout: workoutInProgress() })),
      saveSets: () => ok({}),
      finish: () => ok({}),
    });
    render(<WorkoutJournalView />);
    await screen.findByText('Agachamento');
    await userEvent.click(screen.getByRole('button', { name: 'Finalizar treino' }));
    await screen.findByText('Como foi para você?');

    expect(screen.getByRole('button', { name: 'Não' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Sim' }));
    expect(screen.getByRole('button', { name: 'Enviar e finalizar' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Não' }));
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
    await screen.findByText('Como foi para você?');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar e finalizar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao concluir treino.');
    expect(screen.getByText('Como foi para você?')).toBeVisible();
  });
});
