import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { HealthCipherService } from '../../core/database/health-cipher.service';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import type { QueueManager } from '../jobs/queue-manager.service';
import type { WorkoutCompletionService } from './workout-completion.service';
import { WorkoutJournalService } from './workout-journal.service';

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
  return {
    service: new WorkoutJournalService(db, cipher, completions, queues, queueEvents),
    cipher,
    completions,
    queues,
    queueEvents,
    inserted,
    updated,
  };
}

describe('WorkoutJournalService.journal', () => {
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
    const previous = [
      {
        exerciseId: 'squat',
        setNumber: 1,
        reps: 8,
        loadValue: null,
        loadUnit: 'KG',
        durationSeconds: null,
      },
      {
        exerciseId: 'squat',
        setNumber: 2,
        reps: 9,
        loadValue: '18.25',
        loadUnit: 'KG',
        durationSeconds: 15,
      },
    ];
    const weekRows = [
      { date: '2026-08-10', status: 'COMPLETED' },
      { date: '2026-08-11', status: 'IN_PROGRESS' },
    ];
    const { service } = makeService({
      selects: [[OWNER], [workout], weekRows, current, [{ id: 'previous' }], previous],
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
    expect(result.workout?.sets[0]?.previous?.loadValue).toBeNull();
    expect(result.workout?.sets[1]?.previous?.loadValue).toBe(18.25);
  });

  it('usa o dia atual, fallback da frequencia e nome padrao sem criar treino em descanso', async () => {
    const owner = {
      ...OWNER,
      name: '   ',
      totalWeeks: 1,
      content: { ...STRUCTURE, weeklyFrequency: 1, sessions: [SESSION_B] },
    };
    const { service } = makeService({ selects: [[owner], [], []] });
    const result = await service.journal(USER_ID, undefined, new Date('2026-08-13T12:00:00Z'));
    expect(result).toMatchObject({ firstName: 'atleta', today: '2026-08-13', workout: null });
    expect(result.week.some((day) => day.state === 'MISSED')).toBe(true);
  });

  it('nao inventa comparativo quando a sessao anterior nao foi concluida', async () => {
    const { service } = makeService({
      selects: [[OWNER], [WORKOUT], [], [], []],
    });
    const result = await service.journal(USER_ID, '2026-08-10', new Date('2026-08-10T12:00:00Z'));
    expect(result.workout?.sets.every((entry) => entry.previous === null)).toBe(true);
  });
});

describe('WorkoutJournalService mutations', () => {
  it('inicia idempotentemente e rejeita sessao alheia', async () => {
    await expect(
      makeService({ updateReturns: [[{ id: WORKOUT_ID }]] }).service.start(USER_ID, WORKOUT_ID),
    ).resolves.toBeUndefined();
    await expect(
      makeService({ updateReturns: [[]], selects: [[WORKOUT]] }).service.start(USER_ID, WORKOUT_ID),
    ).resolves.toBeUndefined();
    await expect(
      makeService({ updateReturns: [[]], selects: [[]] }).service.start(USER_ID, WORKOUT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
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

    const { service, inserted } = makeService({ selects: [[WORKOUT]] });
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

  it('valida inicio e exercicio informado no relato de dor', async () => {
    await expect(
      makeService({ selects: [[]] }).service.finish(USER_ID, WORKOUT_ID, {
        perceivedEffort: 5,
        feelingNotes: '',
        painReported: false,
        painNotes: '',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      makeService({ selects: [[WORKOUT]] }).service.finish(USER_ID, WORKOUT_ID, {
        perceivedEffort: 5,
        feelingNotes: '',
        painReported: false,
        painNotes: '',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      makeService({ selects: [[{ ...WORKOUT, startedAt: new Date() }]] }).service.finish(
        USER_ID,
        WORKOUT_ID,
        {
          perceivedEffort: 5,
          feelingNotes: '',
          painReported: true,
          painExerciseId: 'outro',
          painNotes: 'dor',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('finaliza, cifra feedback, alerta dor e envia insight de duracao', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T12:00:00.000Z'));
    try {
      const workout = { ...WORKOUT, startedAt: new Date('2026-08-10T10:30:00.000Z') };
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
      const { service, cipher, completions, queues, queueEvents, inserted } = makeService({
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
        painExerciseId: 'squat',
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
    } finally {
      vi.useRealTimers();
    }
  });

  it('encerra sem insight quando faltam dados ou a media respeita a preferencia', async () => {
    const workout = { ...WORKOUT, startedAt: new Date(Date.now() - 3_600_000) };
    const invalid = makeService({ selects: [[workout], [], [{ duration: 3600 }], []] });
    await invalid.service.finish(USER_ID, WORKOUT_ID, {
      perceivedEffort: 6,
      feelingNotes: '',
      painReported: false,
      painNotes: '',
    });
    expect(invalid.queues.enqueue).not.toHaveBeenCalled();

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
      painNotes: '',
    });
    expect(within.queues.enqueue).not.toHaveBeenCalled();
  });

  it('valida fuso e atualiza somente preferencias informadas', async () => {
    await expect(
      makeService().service.preferences(USER_ID, { timezone: 'Fuso/Inexistente' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const { service, updated } = makeService();
    await service.preferences(USER_ID, {
      reminderTime: '16:00',
      timezone: 'America/Sao_Paulo',
      reminderEnabled: false,
    });
    await service.preferences(USER_ID, {});
    expect(updated[0]).toMatchObject({
      workoutReminderTime: '16:00',
      timezone: 'America/Sao_Paulo',
      workoutReminderEnabled: false,
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
