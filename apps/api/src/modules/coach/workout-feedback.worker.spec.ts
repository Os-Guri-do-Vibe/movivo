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
import { WorkoutFeedbackWorker, type WorkoutFeedbackJob } from './workout-feedback.worker';
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
  const commentFn = vi.fn(async () => commentResult);
  const feedback = { comment: commentFn } as unknown as WorkoutFeedbackService;
  const enqueue = vi.fn(async () => 'job');
  const queues = { enqueue } as unknown as QueueManager;
  const workers = { create: vi.fn() } as unknown as WorkerFactory;
  const worker = new WorkoutFeedbackWorker(workers, queues, db, cipher, feedback);
  return { worker, enqueue, commentFn };
}

function job(): Job<WorkoutFeedbackJob> {
  return {
    data: { userId: USER_ID, workoutSessionId: SESSION_ID },
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
            exercicio: 'goblet_squat',
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
      { jobId: `wa-workout-feedback-${SESSION_ID}` },
    );
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
});
