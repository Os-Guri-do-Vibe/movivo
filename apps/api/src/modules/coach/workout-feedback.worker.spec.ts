import { describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';

import type { HealthCipherService } from '../../core/database/health-cipher.service';
import { users, workoutSessions, workoutSetEntries } from '../../core/database/schema';
import type {
  TenantDatabase,
  TenantTransaction,
} from '../../core/database/tenant-database.service';
import type { QueueManager } from '../jobs/queue-manager.service';
import type { WorkerFactory } from '../jobs/worker.factory';
import {
  describeTrainingDay,
  describeWhen,
  groupRealized,
  remainingSendDelayMs,
  WorkoutFeedbackWorker,
  type WorkoutFeedbackJob,
} from './workout-feedback.worker';
import type { WorkoutFeedbackService } from './workout-feedback.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';

const PRESCRIPTION = {
  focus: 'Corpo inteiro',
  exercises: [{ exerciseId: 'goblet_squat', name: 'Agachamento goblet', sets: 3 }],
};

function makeTx(opts: {
  userRow?: unknown;
  sessionRow?: unknown;
  setEntries?: unknown[];
  priorSessions?: unknown[];
}) {
  let table: unknown;
  let workoutSessionsCalls = 0;
  const resolve = (): unknown[] => {
    if (table === users) return opts.userRow ? [opts.userRow] : [];
    if (table === workoutSessions) {
      workoutSessionsCalls += 1;
      // 1ª consulta a workoutSessions = a sessão atual; a 2ª = sessões anteriores.
      return workoutSessionsCalls === 1
        ? opts.sessionRow
          ? [opts.sessionRow]
          : []
        : (opts.priorSessions ?? []);
    }
    if (table === workoutSetEntries) return opts.setEntries ?? [];
    return [];
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    from: (t: unknown) => {
      table = t;
      return chain;
    },
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(resolve()),
    then: (onFulfilled: (v: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onFulfilled, onRejected),
  };
  return chain as unknown as TenantTransaction;
}

const DEFAULT_USER_ROW = {
  name: 'Ana',
  phoneNumber: '+5541999999999',
  email: null,
  biologicalSex: 'FEMALE',
};
const DEFAULT_SESSION_ROW = {
  scheduledDate: '2026-09-12',
  sessionKey: 'A',
  loggedLate: false,
  protocolId: 'p1',
  prescription: PRESCRIPTION,
  perceivedEffort: 7,
  painReported: false,
  feedbackCipher: null,
};

/**
 * `noSession`/`noComment` são flags dedicadas (não `sessionRow: undefined`/`comment:
 * undefined`) de propósito: desestruturação com valor default troca `undefined` explícito
 * pelo default mesmo quando a chave É passada — não daria pra simular "sem sessão"/"sem
 * comentário" só passando `undefined`.
 */
function makeWorker(opts: {
  userRow?: unknown;
  sessionRow?: unknown;
  noSession?: boolean;
  setEntries?: unknown[];
  priorSessions?: unknown[];
  comment?: string;
  noComment?: boolean;
  /** Resultado de `recentMissStreak`: o alvo anterior a esta sessão. */
  previousTarget?: { kind: string } | null;
  streakFails?: boolean;
}) {
  const userRow = opts.userRow ?? DEFAULT_USER_ROW;
  const sessionRow = opts.noSession ? undefined : (opts.sessionRow ?? DEFAULT_SESSION_ROW);
  const setEntries = opts.setEntries ?? [];
  const priorSessions = opts.priorSessions ?? [];
  const commentResult = opts.noComment ? undefined : (opts.comment ?? 'Comentário gerado.');

  const db = {
    runAsUser: vi.fn((_userId: string, _role: string, cb: (tx: unknown) => Promise<unknown>) =>
      cb(makeTx({ userRow, sessionRow, setEntries, priorSessions })),
    ),
  } as unknown as TenantDatabase;
  const cipher = { decryptHealth: vi.fn(async () => '{}') } as unknown as HealthCipherService;
  const commentFn = vi.fn(async (_params: unknown) => commentResult);
  const feedback = { comment: commentFn } as unknown as WorkoutFeedbackService;
  const enqueue = vi.fn(async (..._args: unknown[]) => 'job');
  const queues = { enqueue } as unknown as QueueManager;
  const workers = { create: vi.fn() } as unknown as WorkerFactory;
  const recentMissStreak = vi.fn(async () => {
    if (opts.streakFails) throw new Error('banco indisponível');
    return {
      target: opts.previousTarget ? { date: '2026-09-10', status: opts.previousTarget } : null,
      streak: opts.previousTarget?.kind === 'MISSED' ? 1 : 0,
    };
  });
  const warn = vi.fn();
  const worker = new WorkoutFeedbackWorker(
    workers,
    queues,
    db,
    cipher,
    feedback,
    { recentMissStreak } as never,
    { setContext: vi.fn(), warn } as never,
  );
  return { worker, enqueue, commentFn, recentMissStreak, warn };
}

function job(timestamp?: number): Job<WorkoutFeedbackJob> {
  return {
    data: { userId: USER_ID, workoutSessionId: SESSION_ID },
    timestamp,
  } as unknown as Job<WorkoutFeedbackJob>;
}

describe('WorkoutFeedbackWorker', () => {
  it('carrega planejado x realizado, chama o serviço e envia a mensagem com o prefixo pedido', async () => {
    const { worker, enqueue, commentFn } = makeWorker({
      setEntries: [
        {
          exerciseId: 'goblet_squat',
          setNumber: 1,
          reps: 10,
          loadValue: '12',
          loadUnit: 'KG',
          durationSeconds: null,
          completed: true,
          skipped: false,
        },
      ],
    });

    await expect(worker.process(job())).resolves.toEqual({ status: 'SENT' });

    expect(commentFn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        planejado: { foco: 'Corpo inteiro', exercicios: [{ name: 'Agachamento goblet', sets: 3 }] },
        realizado: [
          {
            exercicio: 'Agachamento goblet',
            series: [
              {
                serie: 1,
                reps: 10,
                carga: 12,
                unidade: 'KG',
                duracaoSegundos: null,
                concluida: true,
                pulada: false,
              },
            ],
          },
        ],
        esforcoPercebido: 7,
        dorRelatada: false,
      }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'workout-feedback',
      expect.objectContaining({
        userId: USER_ID,
        type: 'COACH_MESSAGE',
        dedupeId: `workout-feedback-${SESSION_ID}`,
        text: 'Acabei de analisar os resultados do seu treino de hoje!\n---\nComentário gerado.',
      }),
      { jobId: `wa-workout-feedback-${SESSION_ID}`, delay: 0 },
    );
  });

  it('agenda o envio para fechar 5 minutos desde o Finalizar, descontando a geração', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-16T12:00:00Z'));
      const finishedAt = Date.now();
      const { worker, enqueue } = makeWorker({});
      vi.setSystemTime(finishedAt + 4_000);
      await worker.process(job(finishedAt));
      expect(enqueue).toHaveBeenCalledWith(
        'whatsapp-outbound',
        'workout-feedback',
        expect.anything(),
        expect.objectContaining({ delay: 300_000 - 17_500 - 4_000 }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('serviço sem comentário (LLM falhou/reprovado): não envia nada', async () => {
    const { worker, enqueue } = makeWorker({ noComment: true });
    await expect(worker.process(job())).resolves.toEqual({ status: 'SKIPPED' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('sessão inexistente (ou de outro titular): não chama o serviço nem enfileira', async () => {
    const { worker, enqueue, commentFn } = makeWorker({ noSession: true });
    await expect(worker.process(job())).resolves.toEqual({ status: 'NOT_FOUND' });
    expect(commentFn).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  describe('reconhecimento da volta', () => {
    it('sessão prevista anterior sem registro: o serviço recebe voltaAposDiaSemRegistro', async () => {
      const { worker, commentFn, recentMissStreak } = makeWorker({
        previousTarget: { kind: 'MISSED' },
      });
      await worker.process(job());
      // Olha os dias ANTERIORES à data da sessão registrada.
      expect(recentMissStreak).toHaveBeenCalledWith(USER_ID, '2026-09-12');
      expect(commentFn).toHaveBeenCalledWith(
        expect.objectContaining({ voltaAposDiaSemRegistro: true }),
      );
    });

    it('sessão anterior concluída, sem alvo ou em andamento: não é volta', async () => {
      for (const previousTarget of [{ kind: 'DONE' }, { kind: 'IN_PROGRESS' }, null]) {
        const { worker, commentFn } = makeWorker({ previousTarget });
        await worker.process(job());
        expect(commentFn).toHaveBeenCalledWith(
          expect.objectContaining({ voltaAposDiaSemRegistro: false }),
        );
      }
    });

    it('dor relatada tem precedência: nem consulta a volta', async () => {
      const { worker, commentFn, recentMissStreak } = makeWorker({
        previousTarget: { kind: 'MISSED' },
        sessionRow: { ...DEFAULT_SESSION_ROW, painReported: true },
      });
      await worker.process(job());
      expect(recentMissStreak).not.toHaveBeenCalled();
      expect(commentFn).toHaveBeenCalledWith(
        expect.objectContaining({ voltaAposDiaSemRegistro: false }),
      );
    });

    it('falha ao checar a volta não derruba o comentário', async () => {
      const { worker, commentFn, warn } = makeWorker({ streakFails: true });
      await expect(worker.process(job())).resolves.toEqual({ status: 'SENT' });
      expect(commentFn).toHaveBeenCalledWith(
        expect.objectContaining({ voltaAposDiaSemRegistro: false }),
      );
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'workout_feedback_return_check_failed' }),
        expect.any(String),
      );
    });
  });
});

describe('remainingSendDelayMs', () => {
  const T0 = 1_000_000;

  it('desconta o tempo já gasto e o "digitando…" do transporte dos 5 minutos', () => {
    expect(remainingSendDelayMs(T0, T0)).toBe(282_500);
    expect(remainingSendDelayMs(T0, T0 + 10_000)).toBe(272_500);
  });

  it('geração lenta ou retry tardio: manda sem espera extra, nunca negativa', () => {
    expect(remainingSendDelayMs(T0, T0 + 290_000)).toBe(0);
    expect(remainingSendDelayMs(T0, T0 + 900_000)).toBe(0);
  });

  it('job sem relógio ou relógio no futuro: não inventa espera além do teto', () => {
    expect(remainingSendDelayMs(undefined, T0)).toBe(0);
    expect(remainingSendDelayMs(T0 + 5_000, T0)).toBe(282_500);
  });
});

describe('comparação com a última execução do MESMO treino', () => {
  // Terça 2026-10-13 (treino A feito fora do dia previsto); hoje quinta 2026-10-22 (treino A).
  const SET = {
    exerciseId: 'goblet_squat',
    setNumber: 1,
    reps: 10,
    loadValue: '12',
    loadUnit: 'KG',
    durationSeconds: null,
    completed: true,
    skipped: false,
  };

  it('entrega ao Coach a data, o dia da semana e as cargas da vez anterior, mesmo em outro dia', async () => {
    const { worker, commentFn } = makeWorker({
      sessionRow: { ...DEFAULT_SESSION_ROW, scheduledDate: '2026-10-22' },
      priorSessions: [
        {
          id: 'prev',
          scheduledDate: '2026-10-13',
          sessionKey: 'A',
          perceivedEffort: 8,
          painReported: false,
          durationSeconds: null,
        },
      ],
      setEntries: [SET],
    });

    await worker.process(job());

    const params = commentFn.mock.calls[0]?.[0] as unknown as {
      ultimaExecucaoDoMesmoTreino?: {
        quando: string;
        esforcoPercebido: number | null;
        exercicios: Array<{ exercicio: string; series: Array<{ carga: number | null }> }>;
      };
    };
    expect(params.ultimaExecucaoDoMesmoTreino).toMatchObject({
      quando: 'terça-feira, 13/10 (há 9 dias)',
      esforcoPercebido: 8,
      exercicios: [{ exercicio: 'Agachamento goblet', series: [{ carga: 12 }] }],
    });
  });

  it('primeira vez que o aluno faz o treino: não há comparação para inventar', async () => {
    const { worker, commentFn } = makeWorker({ setEntries: [SET] });
    await worker.process(job());
    expect(commentFn.mock.calls[0]?.[0]).not.toHaveProperty('ultimaExecucaoDoMesmoTreino');
  });
});

describe('groupRealized', () => {
  const names = new Map([['squat', 'Agachamento']]);
  const base = {
    setNumber: 1,
    reps: 10,
    loadValue: '20',
    loadUnit: 'KG',
    durationSeconds: null,
    completed: true,
    skipped: false,
  };

  it('mantém só exercícios do treino de hoje e só séries que aconteceram', () => {
    const grouped = groupRealized(
      [
        { ...base, exerciseId: 'squat' },
        { ...base, exerciseId: 'squat', setNumber: 2, completed: false },
        { ...base, exerciseId: 'squat', setNumber: 3, completed: false, skipped: true },
        { ...base, exerciseId: 'other' },
      ],
      names,
    );
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.exercicio).toBe('Agachamento');
    expect(grouped[0]?.series.map((set) => set.serie)).toEqual([1, 3]);
  });

  it('sem nenhum exercício em comum, o resultado é vazio (a letra pode ser de outro treino)', () => {
    expect(groupRealized([{ ...base, exerciseId: 'other' }], names)).toEqual([]);
  });
});

describe('describeWhen', () => {
  it('diz o dia da semana, a data e há quantos dias', () => {
    expect(describeWhen('2026-10-13', '2026-10-22')).toBe('terça-feira, 13/10 (há 9 dias)');
    expect(describeWhen('2026-10-21', '2026-10-22')).toBe('quarta-feira, 21/10 (ontem)');
  });
});

describe('registro tardio no comentário do Coach', () => {
  const SET = {
    exerciseId: 'goblet_squat',
    setNumber: 1,
    reps: 10,
    loadValue: '12',
    loadUnit: 'KG',
    durationSeconds: null,
    completed: true,
    skipped: false,
  };

  it('treino normal segue "de hoje"', async () => {
    const { worker, enqueue, commentFn } = makeWorker({ setEntries: [SET] });
    await worker.process(job());
    expect(commentFn.mock.calls[0]?.[0]).toMatchObject({ treinoDe: 'hoje' });
    expect((enqueue.mock.calls[0]?.[2] as { text: string }).text).toContain(
      'do seu treino de hoje!',
    );
  });

  it('registro tardio: o comentário e a abertura falam do dia em que o treino aconteceu', async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const { worker, enqueue, commentFn } = makeWorker({
      sessionRow: { ...DEFAULT_SESSION_ROW, scheduledDate: yesterday, loggedLate: true },
      setEntries: [SET],
    });
    await worker.process(job());
    const params = commentFn.mock.calls[0]?.[0] as { treinoDe: string };
    expect(['ontem', 'anteontem', 'hoje']).toContain(params.treinoDe);
    expect(params.treinoDe).not.toBe('anteontem');
    const text = (enqueue.mock.calls[0]?.[2] as { text: string }).text;
    expect(text).toContain(`do seu treino de ${params.treinoDe}!`);
  });
});

describe('describeTrainingDay', () => {
  // 2026-10-22T15:00Z = quinta 12:00 em São Paulo.
  const NOW = new Date('2026-10-22T15:00:00.000Z');

  it.each([
    ['2026-10-22', 'hoje'],
    ['2026-10-21', 'ontem'],
    ['2026-10-20', 'anteontem'],
    ['2026-10-17', 'sábado'],
  ])('%s → %s', (date, expected) => {
    expect(describeTrainingDay(date, 'America/Sao_Paulo', NOW)).toBe(expected);
  });

  it('usa o dia local do aluno, não o UTC: 01:00 UTC ainda é "ontem" em São Paulo', () => {
    // 2026-10-23T01:00Z = quinta 22:00 em São Paulo (ainda dia 22).
    expect(
      describeTrainingDay('2026-10-22', 'America/Sao_Paulo', new Date('2026-10-23T01:00:00Z')),
    ).toBe('hoje');
  });

  it('fuso inválido ou ausente cai no de São Paulo', () => {
    expect(describeTrainingDay('2026-10-21', 'Marte/Olympus', NOW)).toBe('ontem');
    expect(describeTrainingDay('2026-10-21', null, NOW)).toBe('ontem');
  });
});
