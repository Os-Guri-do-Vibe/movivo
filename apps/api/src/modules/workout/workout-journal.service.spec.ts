import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';

import type { HealthCipherService } from '../../core/database/health-cipher.service';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import type { FollowupService } from '../followup/followup.service';
import type { QueueManager } from '../jobs/queue-manager.service';
import type { ShareCardRenderer } from './share-card/share-card-renderer.service';
import type { WorkoutCompletionService } from './workout-completion.service';
import { type WorkoutDayStatus, WorkoutJournalService } from './workout-journal.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const WORKOUT_ID = '22222222-2222-4222-8222-222222222222';
const PROTOCOL_ID = '33333333-3333-4333-8333-333333333333';

const SESSION_A = {
  dayLabel: 'A',
  weekday: 'MON' as const,
  focus: 'Corpo inteiro',
  exercises: [
    {
      exerciseId: 'squat',
      name: 'Agachamento',
      sets: 2,
      reps: { min: 8, max: 12 },
      loadStrategy: 'DOUBLE_PROGRESSION' as const,
      restSeconds: 90,
    },
    {
      exerciseId: 'plank',
      name: 'Prancha',
      sets: 1,
      durationSeconds: 30,
      loadStrategy: 'BODYWEIGHT' as const,
      restSeconds: 60,
    },
  ],
};

const SESSION_B = {
  dayLabel: 'B',
  focus: 'Costas',
  exercises: [
    {
      exerciseId: 'row',
      name: 'Remada',
      sets: 1,
      reps: { min: 8, max: 10 },
      loadStrategy: 'DOUBLE_PROGRESSION' as const,
      restSeconds: 90,
    },
  ],
};

const STRUCTURE = {
  promptVersion: 'test-v1',
  goal: 'GAIN_MUSCLE' as const,
  phase: 'ADAPTACAO' as const,
  phaseDurationWeeks: 4,
  weeklyFrequency: 3,
  sessions: [SESSION_A, SESSION_B],
};

const OWNER = {
  name: 'Pedro da Silva',
  timezone: 'UTC',
  protocolId: PROTOCOL_ID,
  protocolVersion: 2,
  startDate: new Date('2026-08-03T12:00:00.000Z'),
  totalWeeks: 4,
  content: STRUCTURE,
};

const WORKOUT = {
  id: WORKOUT_ID,
  userId: USER_ID,
  protocolId: PROTOCOL_ID,
  protocolVersion: 2,
  weekNumber: 2,
  sessionKey: 'A',
  scheduledDate: '2026-08-10',
  prescription: SESSION_A,
  status: 'PLANNED' as const,
  startedAt: null,
  finishedAt: null,
  durationSeconds: null,
  perceivedEffort: null,
  painReported: false,
};

function queryChain(rows: unknown[]) {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    for: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return chain;
}

function mutationChain(
  returning: () => unknown[],
  values: Record<string, unknown>[],
  updates: Record<string, unknown>[],
) {
  const chain = {
    values: (value: unknown) => {
      values.push(value as Record<string, unknown>);
      return chain;
    },
    set: (value: unknown) => {
      updates.push(value as Record<string, unknown>);
      return chain;
    },
    where: () => chain,
    onConflictDoNothing: () => chain,
    onConflictDoUpdate: () => chain,
    returning: async () => returning(),
    then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve([]).then(resolve, reject),
  };
  return chain;
}

function makeService(
  options: {
    selects?: unknown[][];
    insertReturns?: unknown[][];
    updateReturns?: unknown[][];
  } = {},
) {
  const selects = [...(options.selects ?? [])];
  const insertReturns = [...(options.insertReturns ?? [])];
  const updateReturns = [...(options.updateReturns ?? [])];
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const tx = {
    select: () => queryChain(selects.shift() ?? []),
    selectDistinctOn: () => queryChain(selects.shift() ?? []),
    insert: () => mutationChain(() => insertReturns.shift() ?? [], inserted, updated),
    update: () => mutationChain(() => updateReturns.shift() ?? [], inserted, updated),
  };
  const db = {
    runAsUser: vi.fn((_userId: string, _role: string, callback: (value: typeof tx) => unknown) =>
      callback(tx),
    ),
  } as unknown as TenantDatabase;
  const cipher = {
    encryptHealth: vi.fn(async () => Buffer.from('cipher')),
  } as unknown as HealthCipherService;
  const completions = {
    record: vi.fn(async () => true),
  } as unknown as WorkoutCompletionService;
  const queues = { enqueue: vi.fn(async () => 'job') } as unknown as QueueManager;
  const queueEvents = { emit: vi.fn() } as unknown as DashboardQueueEventsService;
  const shareCards = {
    render: vi.fn(async () => ({ png: Buffer.from('png'), etag: 'etag' })),
  } as unknown as ShareCardRenderer;
  const followups = {
    resolveForWorkout: vi.fn(async () => ({ cancelled: 0, resumed: 1 })),
  };
  const warn = vi.fn();
  return {
    service: new WorkoutJournalService(
      db,
      cipher,
      completions,
      queues,
      queueEvents,
      shareCards,
      followups as unknown as FollowupService,
      { setContext: vi.fn(), warn } as unknown as PinoLogger,
    ),
    followups,
    warn,
    db,
    shareCards,
    cipher,
    completions,
    queues,
    queueEvents,
    inserted,
    updated,
  };
}

describe('WorkoutJournalService.dayStatus', () => {
  // O protocolo (3x/semana: seg, qua, sex) começou na segunda 2026-08-03; 2026-08-10 também é
  // segunda e 2026-08-09 é domingo (descanso).
  const MONDAY = '2026-08-10';
  const SUNDAY = '2026-08-09';
  const NOW = new Date('2026-08-10T23:35:00.000Z');
  const VERSIONS = [{ version: 2, content: STRUCTURE, createdAt: new Date('2026-08-03') }];

  it('MISSED: treino previsto sem sessão, com foco e dia da semana, sem criar a sessão', async () => {
    const { service, inserted } = makeService({ selects: [[OWNER], [], VERSIONS] });
    await expect(service.dayStatus(USER_ID, MONDAY, NOW)).resolves.toEqual({
      kind: 'MISSED',
      dayLabel: 'A',
      focus: 'Corpo inteiro',
      sessionKey: 'A',
      workoutSessionId: null,
      protocolId: PROTOCOL_ID,
      weekdayName: 'segunda-feira',
    });
    expect(inserted).toEqual([]);
  });

  it('MISSED: sessão existente ainda PLANNED devolve o id e a prescrição do dia', async () => {
    const { service } = makeService({
      selects: [
        [OWNER],
        [{ id: WORKOUT_ID, status: 'PLANNED', sessionKey: 'A', prescription: SESSION_A }],
      ],
    });
    await expect(service.dayStatus(USER_ID, MONDAY, NOW)).resolves.toMatchObject({
      kind: 'MISSED',
      workoutSessionId: WORKOUT_ID,
      focus: 'Corpo inteiro',
    });
  });

  it('IN_PROGRESS não é falta', async () => {
    const { service } = makeService({
      selects: [
        [OWNER],
        [{ id: WORKOUT_ID, status: 'IN_PROGRESS', sessionKey: 'A', prescription: SESSION_A }],
      ],
    });
    await expect(service.dayStatus(USER_ID, MONDAY, NOW)).resolves.toEqual({
      kind: 'IN_PROGRESS',
    });
  });

  it('DONE: treino concluído não é cobrado', async () => {
    const { service } = makeService({
      selects: [
        [OWNER],
        [{ id: WORKOUT_ID, status: 'COMPLETED', sessionKey: 'A', prescription: SESSION_A }],
      ],
    });
    await expect(service.dayStatus(USER_ID, MONDAY, NOW)).resolves.toEqual({ kind: 'DONE' });
  });

  it('REST: dia sem treino previsto', async () => {
    const { service } = makeService({ selects: [[OWNER], [], VERSIONS] });
    await expect(service.dayStatus(USER_ID, SUNDAY, NOW)).resolves.toEqual({ kind: 'REST' });
  });

  it('BEFORE_START: o dia da entrega do 1º protocolo e os anteriores não são cobrados', async () => {
    for (const date of ['2026-08-03', '2026-08-02']) {
      const { service } = makeService({ selects: [[OWNER]] });
      await expect(service.dayStatus(USER_ID, date, NOW)).resolves.toEqual({
        kind: 'BEFORE_START',
      });
    }
  });

  it('rejeita dia futuro', async () => {
    const { service } = makeService({ selects: [[OWNER]] });
    await expect(service.dayStatus(USER_ID, '2026-08-11', NOW)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('WorkoutJournalService.attendanceWindow', () => {
  // Protocolo 3x/semana (seg, qua, sex) entregue em 2026-08-03; janela de 14 dias antes de 17/08.
  const BEFORE = '2026-08-17';
  const NOW = new Date('2026-08-17T07:00:00Z');
  const VERSIONS = [{ version: 2, content: STRUCTURE, createdAt: new Date('2026-08-03') }];
  const kinds = (window: Array<{ date: string; status: { kind: string } }>) =>
    Object.fromEntries(window.map(({ date, status }) => [date.slice(5), status.kind]));

  it('classifica os 14 dias em UMA passada: dono, sessões do intervalo e versões do protocolo', async () => {
    const { service, db } = makeService({
      selects: [
        [OWNER],
        [
          {
            id: WORKOUT_ID,
            date: '2026-08-10',
            status: 'COMPLETED',
            sessionKey: 'A',
            prescription: SESSION_A,
          },
        ],
        VERSIONS,
      ],
    });
    const window = await service.attendanceWindow(USER_ID, BEFORE, NOW);

    expect(window).toHaveLength(14);
    expect(window[0]?.date).toBe('2026-08-03');
    expect(window.at(-1)?.date).toBe('2026-08-16');
    expect(kinds(window)).toMatchObject({
      '08-03': 'BEFORE_START', // dia da entrega
      '08-04': 'REST',
      '08-05': 'MISSED',
      '08-07': 'MISSED',
      '08-10': 'DONE',
      '08-12': 'MISSED',
      '08-14': 'MISSED',
      '08-16': 'REST',
    });
    // Uma única consulta de sessões e uma de versões, não uma rodada por dia.
    expect(db.runAsUser).toHaveBeenCalledTimes(2); // dono + janela
  });

  it('sessão iniciada e não finalizada aparece como IN_PROGRESS, não como falta', async () => {
    const { service } = makeService({
      selects: [
        [OWNER],
        [
          {
            id: WORKOUT_ID,
            date: '2026-08-12',
            status: 'IN_PROGRESS',
            sessionKey: 'B',
            prescription: SESSION_B,
          },
        ],
        VERSIONS,
      ],
    });
    const window = await service.attendanceWindow(USER_ID, BEFORE, NOW);
    expect(kinds(window)['08-12']).toBe('IN_PROGRESS');
  });

  it('sessão criada e nunca iniciada (PLANNED) é falta e guarda o id da sessão', async () => {
    const { service } = makeService({
      selects: [
        [OWNER],
        [
          {
            id: WORKOUT_ID,
            date: '2026-08-10',
            status: 'PLANNED',
            sessionKey: 'A',
            prescription: SESSION_A,
          },
        ],
        VERSIONS,
      ],
    });
    const window = await service.attendanceWindow(USER_ID, BEFORE, NOW);
    expect(window.find(({ date }) => date === '2026-08-10')?.status).toMatchObject({
      kind: 'MISSED',
      workoutSessionId: WORKOUT_ID,
    });
  });

  it('rejeita um dia futuro', async () => {
    const { service } = makeService({ selects: [[OWNER]] });
    await expect(service.attendanceWindow(USER_ID, '2026-08-25', NOW)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('WorkoutJournalService.recentMissStreak', () => {
  // Resolve o `dayStatus` por data com uma tabela, sem passar pelo banco.
  function withStatuses(table: Record<string, WorkoutDayStatus>) {
    const { service } = makeService();
    const calls: string[] = [];
    vi.spyOn(service, 'dayStatus').mockImplementation(async (_userId, date) => {
      calls.push(date);
      return table[date] ?? { kind: 'REST' };
    });
    return { service, calls };
  }
  const missed = (focus = 'Costas'): WorkoutDayStatus => ({
    kind: 'MISSED',
    dayLabel: 'Dia A',
    focus,
    sessionKey: 'Dia A',
    workoutSessionId: null,
    protocolId: PROTOCOL_ID,
    weekdayName: 'segunda-feira',
  });
  const NOW = new Date('2026-08-12T07:00:00Z');

  it('ontem previsto e sem registro, anterior concluído: sequência de 1', async () => {
    const { service } = withStatuses({ '2026-08-11': missed(), '2026-08-10': { kind: 'DONE' } });
    const result = await service.recentMissStreak(USER_ID, '2026-08-12', NOW);
    expect(result.target?.date).toBe('2026-08-11');
    expect(result.streak).toBe(1);
  });

  it('pula o descanso para achar a última sessão prevista (sexta sem registro, hoje segunda)', async () => {
    const { service } = withStatuses({
      '2026-08-09': { kind: 'REST' }, // domingo
      '2026-08-08': { kind: 'REST' }, // sábado
      '2026-08-07': missed('Pernas'), // sexta
      '2026-08-05': { kind: 'DONE' },
    });
    const result = await service.recentMissStreak(USER_ID, '2026-08-10', NOW);
    expect(result.target).toMatchObject({ date: '2026-08-07' });
    expect(result.streak).toBe(1);
  });

  it('conta as faltas seguidas pulando descanso e para no teto', async () => {
    const { service } = withStatuses({
      '2026-08-11': missed(),
      '2026-08-10': { kind: 'REST' },
      '2026-08-09': missed(),
      '2026-08-08': missed(),
      '2026-08-07': missed(),
    });
    expect((await service.recentMissStreak(USER_ID, '2026-08-12', NOW)).streak).toBe(3);
    expect((await service.recentMissStreak(USER_ID, '2026-08-12', NOW, { cap: 2 })).streak).toBe(2);
  });

  it('treino concluído ou em andamento corta a sequência', async () => {
    const done = withStatuses({
      '2026-08-11': missed(),
      '2026-08-10': { kind: 'DONE' },
      '2026-08-09': missed(),
    });
    expect((await done.service.recentMissStreak(USER_ID, '2026-08-12', NOW)).streak).toBe(1);

    const running = withStatuses({ '2026-08-11': { kind: 'IN_PROGRESS' } });
    expect(await running.service.recentMissStreak(USER_ID, '2026-08-12', NOW)).toMatchObject({
      streak: 0,
      target: { status: { kind: 'IN_PROGRESS' } },
    });
  });

  it('último dia previsto concluído ou antes do protocolo: nada a perguntar', async () => {
    const done = withStatuses({ '2026-08-11': { kind: 'DONE' } });
    expect((await done.service.recentMissStreak(USER_ID, '2026-08-12', NOW)).streak).toBe(0);
    const start = withStatuses({ '2026-08-11': { kind: 'BEFORE_START' } });
    expect((await start.service.recentMissStreak(USER_ID, '2026-08-12', NOW)).streak).toBe(0);
  });

  it('só descanso na janela de 3 dias: sem alvo', async () => {
    const { service, calls } = withStatuses({ '2026-08-07': missed() });
    const result = await service.recentMissStreak(USER_ID, '2026-08-12', NOW);
    expect(result).toEqual({ target: null, streak: 0 });
    expect(calls).toEqual(['2026-08-11', '2026-08-10', '2026-08-09']);
  });
});

describe('WorkoutJournalService.shareCardImage', () => {
  const completed = {
    ...WORKOUT,
    status: 'COMPLETED' as const,
    finishedAt: new Date('2026-08-10T11:05:00Z'),
    durationSeconds: 3900,
  };

  it('desenha o card com os mesmos músculos/duração que o diário devolve', async () => {
    const { service, shareCards } = makeService({
      selects: [
        [completed],
        [{ name: 'Pedro da Silva', biologicalSex: 'FEMALE' }],
        [
          { exerciseId: 'squat', setNumber: 1, completed: true, skipped: false },
          { exerciseId: 'plank', setNumber: 1, completed: false, skipped: true },
        ],
        [{ id: 'squat', muscleGroups: ['quadríceps', 'glúteo'] }],
      ],
    });
    await expect(service.shareCardImage(USER_ID, WORKOUT_ID)).resolves.toEqual({
      png: Buffer.from('png'),
      etag: 'etag',
    });
    expect(shareCards.render).toHaveBeenCalledWith({
      gender: 'female',
      groups: ['quads', 'glutes'],
      durationSeconds: 3900,
    });
  });

  it('exercício de corpo todo (burpee) não apaga o foco do treino no card', async () => {
    const [squat] = SESSION_A.exercises;
    const prescription = {
      ...SESSION_A,
      exercises: [
        { ...squat, exerciseId: 'bench', name: 'Supino' },
        { ...squat, exerciseId: 'burpee_sobre_a_barra', name: 'Burpee' },
      ],
    };
    const { service, shareCards } = makeService({
      selects: [
        [{ ...completed, prescription }],
        [{ name: 'Rodrigo', biologicalSex: 'MALE' }],
        [
          { exerciseId: 'bench', setNumber: 1, completed: true, skipped: false },
          { exerciseId: 'burpee_sobre_a_barra', setNumber: 1, completed: true, skipped: false },
        ],
        [
          { id: 'bench', muscleGroups: ['peito', 'ombros', 'tríceps'] },
          { id: 'burpee_sobre_a_barra', muscleGroups: ['corpo todo'] },
        ],
      ],
    });
    await service.shareCardImage(USER_ID, WORKOUT_ID);
    expect(shareCards.render).toHaveBeenCalledWith(
      expect.objectContaining({ groups: ['chest', 'shoulders', 'triceps'] }),
    );
  });

  it('não desenha card de treino alheio, em andamento ou sem sexo cadastrado', async () => {
    const own = (selects: unknown[][]) => makeService({ selects }).service;
    await expect(own([[]]).shareCardImage(USER_ID, WORKOUT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      own([[WORKOUT], [{ name: 'Pedro', biologicalSex: 'MALE' }], []]).shareCardImage(
        USER_ID,
        WORKOUT_ID,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      own([[completed], [{ name: 'Pedro', biologicalSex: null }], []]).shareCardImage(
        USER_ID,
        WORKOUT_ID,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('WorkoutJournalService.journal', () => {
  it('deriva o share card do cadastro e dos exercícios realizados na prescrição salva', async () => {
    const { service } = makeService({
      selects: [
        [{ ...OWNER, biologicalSex: 'FEMALE' }],
        [
          {
            ...WORKOUT,
            status: 'COMPLETED',
            finishedAt: new Date('2026-08-10T11:05:00Z'),
            durationSeconds: 3900,
          },
        ],
        [],
        [
          { exerciseId: 'squat', setNumber: 1, completed: true, skipped: false },
          { exerciseId: 'plank', setNumber: 1, completed: false, skipped: true },
        ],
        [],
        [{ id: 'squat', muscleGroups: ['quadríceps', 'glúteo'] }],
      ],
    });
    const result = await service.journal(USER_ID, '2026-08-10', new Date('2026-08-12T12:00:00Z'));
    expect(result.workout?.shareCard).toEqual({
      user: { name: 'Pedro', gender: 'female' },
      workout: {
        name: 'A',
        durationSeconds: 3900,
        completedAt: '2026-08-10T11:05:00.000Z',
        trainedMuscles: ['Quadríceps', 'Glúteos'],
        muscleGroupsForHighlighter: ['quads', 'glutes'],
      },
    });
  });

  it('não presume sexo ausente nem gera card para treino em andamento', async () => {
    for (const owner of [OWNER, { ...OWNER, biologicalSex: 'MALE' }]) {
      const { service } = makeService({ selects: [[owner], [WORKOUT], [], [], []] });
      expect(
        (await service.journal(USER_ID, '2026-08-10', new Date('2026-08-12T12:00:00Z'))).workout
          ?.shareCard,
      ).toBeUndefined();
    }
  });
  it('rejeita futuro e ausencia de protocolo ativo', async () => {
    await expect(
      makeService({ selects: [[OWNER]] }).service.journal(
        USER_ID,
        '2026-08-11',
        new Date('2026-08-10T12:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(makeService({ selects: [[]] }).service.journal(USER_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('monta semana, placeholders e comparativo sem misturar exercicios', async () => {
    const workout = {
      ...WORKOUT,
      status: 'COMPLETED' as const,
      startedAt: new Date('2026-08-10T10:00:00.000Z'),
      finishedAt: new Date('2026-08-10T11:00:00.000Z'),
      durationSeconds: 3600,
      perceivedEffort: 8,
      painReported: true,
    };
    const current = [
      {
        exerciseId: 'squat',
        setNumber: 1,
        reps: 10,
        loadValue: '20.50',
        loadUnit: 'KG',
        durationSeconds: null,
        completed: true,
        skipped: false,
      },
      {
        exerciseId: 'squat',
        setNumber: 2,
        reps: null,
        loadValue: null,
        loadUnit: 'LB',
        durationSeconds: 20,
        completed: false,
        skipped: true,
      },
    ];
    // Já ordenado como o banco devolve: sessão realizada mais recente primeiro.
    const previous = [
      {
        exerciseId: 'squat',
        setNumber: 1,
        reps: 8,
        loadValue: null,
        loadUnit: 'KG',
        durationSeconds: null,
        date: '2026-08-03',
      },
      {
        exerciseId: 'squat',
        setNumber: 2,
        reps: 9,
        loadValue: '18.25',
        loadUnit: 'KG',
        durationSeconds: 15,
        date: '2026-08-03',
      },
      {
        // Sessão mais antiga do mesmo exercício: nunca sobrescreve a mais recente.
        exerciseId: 'squat',
        setNumber: 1,
        reps: 5,
        loadValue: '10',
        loadUnit: 'KG',
        durationSeconds: null,
        date: '2026-07-27',
      },
    ];
    const weekRows = [
      { date: '2026-08-10', status: 'COMPLETED' },
      { date: '2026-08-11', status: 'IN_PROGRESS' },
    ];
    const { service } = makeService({
      selects: [[OWNER], [workout], weekRows, current, previous],
    });

    const result = await service.journal(
      USER_ID,
      '2026-08-10',
      new Date('2026-08-12T12:00:00.000Z'),
    );

    expect(result.firstName).toBe('Pedro');
    expect(result.week.map((day) => day.state)).toEqual([
      'REST',
      'COMPLETED',
      'IN_PROGRESS',
      'PLANNED',
      'FUTURE',
      'FUTURE',
      'FUTURE',
    ]);
    expect(result.workout?.sets).toEqual([
      expect.objectContaining({ exerciseId: 'squat', loadValue: 20.5, completed: true }),
      expect.objectContaining({ exerciseId: 'squat', loadValue: null, skipped: true }),
      expect.objectContaining({ exerciseId: 'plank', loadUnit: 'BODYWEIGHT', previous: null }),
    ]);
    expect(result.workout?.sets[0]?.previous).toMatchObject({
      reps: 8,
      loadValue: null,
      date: '2026-08-03',
    });
    expect(result.workout?.sets[1]?.previous?.loadValue).toBe(18.25);
  });

  it('usa o dia atual, fallback da frequencia e nome padrao sem criar treino em descanso', async () => {
    const content = { ...STRUCTURE, weeklyFrequency: 1, sessions: [SESSION_B] };
    const owner = { ...OWNER, name: '   ', totalWeeks: 1, content };
    const version = { version: 2, content, createdAt: new Date('2026-08-01T00:00:00.000Z') };
    // 4 selects: dono/protocolo vigente, sessao existente (nenhuma), versao historica
    // (resolvida via `protocol_versions` — achado 2026-09-10), semana.
    const { service } = makeService({ selects: [[owner], [], [version], []] });
    const result = await service.journal(USER_ID, undefined, new Date('2026-08-13T12:00:00Z'));
    expect(result).toMatchObject({ firstName: 'atleta', today: '2026-08-13', workout: null });
    expect(result.week.some((day) => day.state === 'MISSED')).toBe(true);
  });

  it('nao abre nem cria sessao antes do primeiro protocolo e marca esses dias como BEFORE_START', async () => {
    // Primeiro protocolo entregue em 2026-08-05 (qua). Semana exibida: 02/08 a 08/08.
    const owner = { ...OWNER, firstStartDate: new Date('2026-08-05T15:00:00.000Z') };
    const { service, inserted } = makeService({ selects: [[owner], []] });
    const result = await service.journal(USER_ID, '2026-08-03', new Date('2026-08-08T12:00:00Z'));
    expect(result.workout).toBeNull();
    expect(result.firstProtocolDate).toBe('2026-08-05');
    expect(inserted).toHaveLength(0);
    expect(result.week.map((day) => day.state).slice(0, 3)).toEqual([
      'BEFORE_START',
      'BEFORE_START',
      'BEFORE_START',
    ]);
    expect(result.week[3]?.state).not.toBe('BEFORE_START');
  });

  it('nao inventa comparativo quando a sessao anterior nao foi concluida', async () => {
    const { service } = makeService({
      selects: [[OWNER], [WORKOUT], [], [], []],
    });
    const result = await service.journal(USER_ID, '2026-08-10', new Date('2026-08-10T12:00:00Z'));
    expect(result.workout?.sets.every((entry) => entry.previous === null)).toBe(true);
  });

  it('inclui as series de aquecimento (warmupBlocks) antes das series validas', async () => {
    const sessionWithWarmup = {
      dayLabel: 'C',
      focus: 'Peito',
      exercises: [
        {
          exerciseId: 'bench',
          name: 'Supino',
          sets: 2,
          reps: { min: 10, max: 15 },
          loadStrategy: 'DOUBLE_PROGRESSION' as const,
          restSeconds: 75,
          warmupBlocks: [{ sets: 1, reps: { min: 12, max: 15 }, restSeconds: 60 }],
        },
      ],
    };
    const owner = { ...OWNER, content: { ...STRUCTURE, sessions: [sessionWithWarmup] } };
    const workout = { ...WORKOUT, prescription: sessionWithWarmup };
    const { service } = makeService({
      selects: [[owner], [workout], [], [], []],
    });

    const result = await service.journal(USER_ID, '2026-08-10', new Date('2026-08-10T12:00:00Z'));

    expect(result.workout?.sets.map((entry) => entry.setNumber)).toEqual([0, 1, 2]);
    expect(result.workout?.sets.every((entry) => entry.exerciseId === 'bench')).toBe(true);
  });

  it('marca isCardio a partir do catalogo (achado 2026-09-04): cardio nao tem reps/carga', async () => {
    const sessionWithCardio = {
      dayLabel: 'C',
      focus: 'Condicionamento',
      exercises: [
        {
          exerciseId: 'bicicleta_horizontal',
          name: 'Bicicleta Horizontal',
          sets: 1,
          durationSeconds: 600,
          loadStrategy: 'BODYWEIGHT' as const,
          restSeconds: 0,
        },
        {
          exerciseId: 'squat',
          name: 'Agachamento',
          sets: 3,
          reps: { min: 8, max: 12 },
          loadStrategy: 'FIXED_LOAD' as const,
          restSeconds: 60,
        },
      ],
    };
    const owner = { ...OWNER, content: { ...STRUCTURE, sessions: [sessionWithCardio] } };
    const workout = { ...WORKOUT, prescription: sessionWithCardio };
    const { service } = makeService({ selects: [[owner], [workout], [], [], []] });

    const result = await service.journal(USER_ID, '2026-08-10', new Date('2026-08-10T12:00:00Z'));

    const exercises = result.workout?.prescription.exercises ?? [];
    expect(
      exercises.find((exercise) => exercise.exerciseId === 'bicicleta_horizontal')?.isCardio,
    ).toBe(true);
    expect(exercises.find((exercise) => exercise.exerciseId === 'squat')?.isCardio).toBe(false);
  });

  // Achado 2026-09-10 (pedido do fundador): uma substituição de exercício só pode valer da
  // data de aprovação em diante — nunca reescrever um dia passado nunca visitado antes.
  describe('substituição de exercício não reescreve dia passado nunca visitado', () => {
    const SESSION_A_SUBSTITUIDA = {
      ...SESSION_A,
      exercises: [
        { ...SESSION_A.exercises[0], exerciseId: 'lunge', name: 'Avanço' },
        SESSION_A.exercises[1],
      ],
    };

    it('dia passado sem sessão ainda: usa a versão HISTÓRICA vigente naquele dia, não a atual', async () => {
      // Aluno treinava Agachamento (v1) na segunda 2026-08-03; a troca pra Avanço (v2) só
      // foi aprovada em 2026-08-10. `owner.content`/`owner.protocolVersion` já refletem a
      // v2 (estado vigente), mas o aluno nunca abriu o dia 2026-08-03.
      const owner = {
        ...OWNER,
        protocolVersion: 2,
        content: { ...STRUCTURE, sessions: [SESSION_A_SUBSTITUIDA, SESSION_B] },
      };
      const v1 = {
        version: 1,
        content: STRUCTURE, // SESSION_A original (Agachamento)
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      };
      const v2 = {
        version: 2,
        content: owner.content, // SESSION_A_SUBSTITUIDA (Avanço)
        createdAt: new Date('2026-08-10T15:00:00.000Z'),
      };
      const { service, inserted } = makeService({
        // dono, sessão existente (nenhuma), histórico de versões, releitura pós-insert
        // (vazia — irrelevante pro que este teste prova), semana.
        selects: [[owner], [], [v1, v2], [], []],
      });

      const result = await service.journal(
        USER_ID,
        '2026-08-03', // segunda-feira, antes da aprovação da troca
        new Date('2026-08-12T12:00:00Z'),
      );

      expect(inserted).toHaveLength(1);
      expect(inserted[0]).toMatchObject({
        protocolVersion: 1,
        prescription: expect.objectContaining({
          exercises: expect.arrayContaining([expect.objectContaining({ exerciseId: 'squat' })]),
        }),
      });
      expect(
        (inserted[0]?.prescription as { exercises: { exerciseId: string }[] }).exercises.some(
          (e) => e.exerciseId === 'lunge',
        ),
      ).toBe(false);
      expect(result.selectedDate).toBe('2026-08-03');
    });

    it('dia atual sem sessão ainda: usa a versão VIGENTE (nenhuma versão futura existe)', async () => {
      const owner = {
        ...OWNER,
        protocolVersion: 2,
        content: { ...STRUCTURE, sessions: [SESSION_A_SUBSTITUIDA, SESSION_B] },
      };
      const v1 = {
        version: 1,
        content: STRUCTURE,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      };
      const v2 = {
        version: 2,
        content: owner.content,
        createdAt: new Date('2026-08-10T15:00:00.000Z'),
      };
      const { service, inserted } = makeService({
        selects: [[owner], [], [v1, v2], [], []],
      });

      await service.journal(USER_ID, '2026-08-10', new Date('2026-08-10T18:00:00Z'));

      expect(inserted).toHaveLength(1);
      expect(inserted[0]).toMatchObject({ protocolVersion: 2 });
      expect(
        (inserted[0]?.prescription as { exercises: { exerciseId: string }[] }).exercises.some(
          (e) => e.exerciseId === 'lunge',
        ),
      ).toBe(true);
    });
  });
});

describe('WorkoutJournalService mutations', () => {
  it('inicia idempotentemente e rejeita sessao alheia', async () => {
    const now = new Date('2026-08-10T12:00:00Z');
    const owned = [{ scheduledDate: '2026-08-10', timezone: 'UTC' }];
    await expect(
      makeService({ selects: [owned], updateReturns: [[{ id: WORKOUT_ID }]] }).service.start(
        USER_ID,
        WORKOUT_ID,
        now,
      ),
    ).resolves.toBeUndefined();
    await expect(
      makeService({
        selects: [owned, [{ ...WORKOUT, status: 'IN_PROGRESS' }]],
        updateReturns: [[]],
      }).service.start(USER_ID, WORKOUT_ID, now),
    ).resolves.toBeUndefined();
    await expect(
      makeService({ selects: [[]] }).service.start(USER_ID, WORKOUT_ID, now),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // Achado 2026-09-10 (pedido do fundador): "Iniciar treino" só pode valer pro dia atual —
  // dia passado é só consulta de protocolo/carga, nunca pode virar treino em andamento.
  it('recusa iniciar treino de um dia passado', async () => {
    const owned = [{ scheduledDate: '2026-08-05', timezone: 'UTC' }];
    await expect(
      makeService({ selects: [owned] }).service.start(
        USER_ID,
        WORKOUT_ID,
        new Date('2026-08-10T12:00:00Z'), // "hoje" é 08-10; a sessão é do dia 08-05
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('valida pertencimento e estado antes de salvar series', async () => {
    await expect(
      makeService({ selects: [[]] }).service.saveSets(USER_ID, WORKOUT_ID, []),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      makeService({ selects: [[{ ...WORKOUT, status: 'COMPLETED' }]] }).service.saveSets(
        USER_ID,
        WORKOUT_ID,
        [],
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      makeService({ selects: [[WORKOUT]] }).service.saveSets(USER_ID, WORKOUT_ID, [
        { exerciseId: 'outro', setNumber: 1, loadUnit: 'KG', completed: true, skipped: false },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);

    const { service, inserted } = makeService({
      selects: [[{ ...WORKOUT, status: 'IN_PROGRESS' }]],
    });
    await service.saveSets(USER_ID, WORKOUT_ID, [
      {
        exerciseId: 'squat',
        setNumber: 1,
        reps: 10,
        loadValue: 22.5,
        loadUnit: 'KG',
        completed: true,
        skipped: false,
      },
      {
        exerciseId: 'plank',
        setNumber: 1,
        durationSeconds: 30,
        loadUnit: 'BODYWEIGHT',
        completed: true,
        skipped: false,
      },
    ]);
    expect(inserted[0]).toMatchObject({ loadValue: '22.5', workoutSessionId: WORKOUT_ID });
    expect(inserted[1]).toMatchObject({ loadValue: undefined, durationSeconds: 30 });
  });

  it('decide no servidor o que é série feita: reps/tempo > 0 e não pulada, nunca só carga', async () => {
    const { service, inserted } = makeService({
      selects: [[{ ...WORKOUT, status: 'IN_PROGRESS' }]],
    });
    await service.saveSets(USER_ID, WORKOUT_ID, [
      {
        exerciseId: 'squat',
        setNumber: 1,
        reps: 10,
        loadUnit: 'KG',
        completed: false,
        skipped: false,
      },
      {
        exerciseId: 'squat',
        setNumber: 2,
        reps: 0,
        loadValue: 30,
        loadUnit: 'KG',
        completed: true,
        skipped: false,
      },
      {
        exerciseId: 'plank',
        setNumber: 1,
        loadValue: 5,
        loadUnit: 'KG',
        completed: true,
        skipped: false,
      },
    ]);
    expect(inserted.map((row) => row.completed)).toEqual([true, false, false]);
  });

  it('valida inicio e exercicio informado no relato de dor', async () => {
    await expect(
      makeService({ selects: [[]] }).service.finish(USER_ID, WORKOUT_ID, {
        perceivedEffort: 5,
        feelingNotes: '',
        painReported: false,
        painExerciseIds: [],
        painNotes: '',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      makeService({ selects: [[WORKOUT]] }).service.finish(USER_ID, WORKOUT_ID, {
        perceivedEffort: 5,
        feelingNotes: '',
        painReported: false,
        painExerciseIds: [],
        painNotes: '',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      makeService({
        selects: [[{ ...WORKOUT, status: 'IN_PROGRESS', startedAt: new Date() }]],
      }).service.finish(USER_ID, WORKOUT_ID, {
        perceivedEffort: 5,
        feelingNotes: '',
        painReported: true,
        painExerciseIds: ['outro'],
        painNotes: 'dor',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('finaliza, cifra feedback, alerta dor e envia insight de duracao', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T12:00:00.000Z'));
    try {
      const workout = {
        ...WORKOUT,
        status: 'IN_PROGRESS',
        startedAt: new Date('2026-08-10T10:30:00.000Z'),
      };
      const structured = {
        primaryGoal: 'GAIN_MUSCLE',
        emphasis: [],
        hasImportantEvent: false,
        trainingStatus: 'REGULAR',
        experience: 'INTERMEDIATE',
        pastActivities: ['WEIGHT_TRAINING'],
        consistencyBarriers: [],
        daysPerWeek: 3,
        preferredDays: ['MON', 'WED', 'FRI'],
        sessionDuration: 'M45_TO_60',
        location: 'FULL_GYM',
        preferredPeriod: 'VARIES',
        practicesOtherSport: false,
        hasAvoidedExercise: false,
      };
      const { service, cipher, completions, queues, queueEvents, inserted, followups } =
        makeService({
          selects: [
            [workout],
            [{ exerciseId: 'squat', completed: true }],
            [{ duration: 5_400 }, { duration: 5_000 }, { duration: null }],
            [{ data: structured }],
          ],
          insertReturns: [[{ id: 'insight-1' }]],
        });

      await service.finish(USER_ID, WORKOUT_ID, {
        perceivedEffort: 9,
        feelingNotes: 'Treino puxado',
        painReported: true,
        painExerciseIds: ['squat'],
        painNotes: 'Dor no joelho',
      });

      expect(cipher.encryptHealth).toHaveBeenCalledWith(expect.stringContaining('Treino puxado'));
      expect(completions.record).toHaveBeenCalledWith(
        USER_ID,
        PROTOCOL_ID,
        2,
        2,
        'A',
        '2026-08-10',
        'WEB_JOURNAL',
        expect.objectContaining({ perceivedEffort: 9 }),
      );
      expect(inserted).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ reason: 'DOR_APOS_TREINO' }),
          expect.objectContaining({ kind: 'DURATION_OVER_PREFERENCE' }),
        ]),
      );
      expect(queues.enqueue).toHaveBeenCalledWith(
        'whatsapp-outbound',
        'workout-duration-insight',
        expect.objectContaining({ userId: USER_ID, type: 'WORKOUT_INSIGHT' }),
        { jobId: 'wa-workout-insight-insight-1' },
      );
      expect(queueEvents.emit).toHaveBeenCalledWith('handoff');
      // Registrou um treino: pendências de dias até esta data deixam de fazer sentido (voltou).
      expect(followups.resolveForWorkout).toHaveBeenCalledWith(USER_ID, '2026-08-10');
    } finally {
      vi.useRealTimers();
    }
  });

  it('falha ao fechar a pendência de conversa não impede registrar o treino', async () => {
    const workout = {
      ...WORKOUT,
      status: 'IN_PROGRESS',
      startedAt: new Date(Date.now() - 3_600_000),
    };
    const { service, followups, warn, queues } = makeService({
      selects: [[workout], [], [{ duration: 3600 }], []],
    });
    followups.resolveForWorkout.mockRejectedValueOnce(new Error('banco indisponível'));
    await expect(
      service.finish(USER_ID, WORKOUT_ID, {
        perceivedEffort: 6,
        feelingNotes: '',
        painReported: false,
        painExerciseIds: [],
        painNotes: '',
      }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'workout_followup_settle_failed' }),
      expect.any(String),
    );
    expect(queues.enqueue).toHaveBeenCalledWith(
      'workout-feedback',
      'workout-feedback',
      expect.anything(),
      expect.anything(),
    );
  });

  it('encerra sem insight quando faltam dados ou a media respeita a preferencia', async () => {
    const workout = {
      ...WORKOUT,
      status: 'IN_PROGRESS',
      startedAt: new Date(Date.now() - 3_600_000),
    };
    const invalid = makeService({ selects: [[workout], [], [{ duration: 3600 }], []] });
    await invalid.service.finish(USER_ID, WORKOUT_ID, {
      perceivedEffort: 6,
      feelingNotes: '',
      painReported: false,
      painExerciseIds: [],
      painNotes: '',
    });
    // Sem insight de duração — mas o comentário de feedback do Coach sempre é enfileirado
    // (achado 2026-09-12), independente de haver ou não desvio de duração.
    expect(invalid.queues.enqueue).toHaveBeenCalledTimes(1);
    expect(invalid.queues.enqueue).toHaveBeenCalledWith(
      'workout-feedback',
      'workout-feedback',
      { userId: USER_ID, workoutSessionId: WORKOUT_ID },
      { jobId: `workout-feedback-${WORKOUT_ID}` },
    );

    const structured = {
      primaryGoal: 'GAIN_MUSCLE',
      trainingStatus: 'REGULAR',
      experience: 'BEGINNER',
      daysPerWeek: 1,
      sessionDuration: 'M45_TO_60',
      location: 'HOME',
      preferredPeriod: 'MORNING',
      practicesOtherSport: false,
      hasAvoidedExercise: false,
    };
    const within = makeService({
      selects: [[workout], [], [{ duration: 3000 }, { duration: 3300 }], [{ data: structured }]],
    });
    await within.service.finish(USER_ID, WORKOUT_ID, {
      perceivedEffort: 6,
      feelingNotes: '',
      painReported: false,
      painExerciseIds: [],
      painNotes: '',
    });
    // Idem: sem insight de duração, mas o feedback do Coach sempre é enfileirado.
    expect(within.queues.enqueue).toHaveBeenCalledTimes(1);
    expect(within.queues.enqueue).toHaveBeenCalledWith(
      'workout-feedback',
      'workout-feedback',
      { userId: USER_ID, workoutSessionId: WORKOUT_ID },
      { jobId: `workout-feedback-${WORKOUT_ID}` },
    );
  });

  it('valida fuso e atualiza somente preferencias informadas', async () => {
    await expect(
      makeService().service.preferences(USER_ID, { timezone: 'Fuso/Inexistente' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const { service, updated } = makeService();
    await service.preferences(USER_ID, {
      reminderTime: '16:00',
      timezone: 'America/Sao_Paulo',
    });
    await service.preferences(USER_ID, {});
    expect(updated[0]).toMatchObject({
      workoutReminderTime: '16:00',
      timezone: 'America/Sao_Paulo',
    });
    expect(updated[1]).toEqual({});
  });

  it('registra respostas aos insights e abre handoff somente quando solicitado', async () => {
    const adjust = makeService({ updateReturns: [[{ id: 'insight-1' }]] });
    await expect(adjust.service.respondToInsight(USER_ID, 'insight-1', true)).resolves.toBe(true);
    expect(adjust.inserted[0]).toMatchObject({ reason: 'AJUSTE_DURACAO_SOLICITADO' });
    expect(adjust.queueEvents.emit).toHaveBeenCalledWith('handoff');

    const acknowledge = makeService({ updateReturns: [[{ id: 'insight-2' }]] });
    await expect(acknowledge.service.respondToInsight(USER_ID, 'insight-2', false)).resolves.toBe(
      true,
    );
    expect(acknowledge.inserted).toHaveLength(0);
    expect(acknowledge.queueEvents.emit).not.toHaveBeenCalled();

    await expect(
      makeService({ updateReturns: [[]] }).service.respondToInsight(USER_ID, 'missing', true),
    ).resolves.toBe(false);
  });
});

describe('WorkoutJournalService — estado final não pode ser sobrescrito', () => {
  it('recusa nova finalização sem alterar dados ou enfileirar novamente', async () => {
    const { service, updated, inserted, queues, completions } = makeService({
      selects: [[{ ...WORKOUT, status: 'COMPLETED', startedAt: new Date() }]],
    });
    await expect(
      service.finish(USER_ID, WORKOUT_ID, {
        perceivedEffort: 8,
        feelingNotes: '',
        painReported: false,
        painExerciseIds: [],
        painNotes: '',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(updated).toHaveLength(0);
    expect(inserted).toHaveLength(0);
    expect(queues.enqueue).not.toHaveBeenCalled();
    expect(completions.record).not.toHaveBeenCalled();
  });
});
