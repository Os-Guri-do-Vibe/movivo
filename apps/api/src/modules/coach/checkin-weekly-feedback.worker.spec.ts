import { describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';

import { checkins, users } from '../../core/database/schema';
import type { HealthCipherService } from '../../core/database/health-cipher.service';
import type {
  TenantDatabase,
  TenantTransaction,
} from '../../core/database/tenant-database.service';
import type { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import type { QueueManager } from '../jobs/queue-manager.service';
import type { WorkerFactory } from '../jobs/worker.factory';
import type { ProtocolRepository } from '../protocol/protocol.repository';
import type { ProtocolSubstitutionRepository } from '../protocol/protocol-substitution.repository';
import type { WorkoutCompletionService } from '../workout/workout-completion.service';
import {
  CheckinWeeklyFeedbackWorker,
  type CheckinWeeklyFeedbackJob,
} from './checkin-weekly-feedback.worker';
import type { CheckinWeeklyFeedbackService } from './checkin-weekly-feedback.service';
import type { ProtocolVolumeAdjustmentService } from './protocol-volume-adjustment.service';
import type { SubstitutionTargetService } from './substitution-target.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CHECKIN_ID = '22222222-2222-4222-8222-222222222222';

const DEFAULT_USER_ROW = {
  name: 'Ana',
  phoneNumber: '+5541999999999',
  email: null,
  biologicalSex: 'FEMALE',
};
const DEFAULT_ANSWERS = {
  sleepQuality: 'BOA',
  mood: 'FELIZ',
  nutritionScore: 8,
  adherenceScore: 9,
  changesNoticed: ['FORCA'],
  durationFit: 'ADEQUADA',
};

function makeTx(opts: {
  userRow?: unknown;
  checkinRow?: { answers: unknown; notesCipher: Buffer | null };
  alertInsertValues?: (v: unknown) => void;
}) {
  let table: unknown;
  const resolve = (): unknown[] => {
    if (table === users) return opts.userRow ? [opts.userRow] : [];
    if (table === checkins) return opts.checkinRow ? [opts.checkinRow] : [];
    return [];
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    from: (t: unknown) => {
      table = t;
      return chain;
    },
    where: () => chain,
    limit: () => Promise.resolve(resolve()),
    insert: () => ({
      values: (v: unknown) => {
        opts.alertInsertValues?.(v);
        return { onConflictDoNothing: () => Promise.resolve([]) };
      },
    }),
  };
  return chain as unknown as TenantTransaction;
}

function makeWorker(opts: {
  userRow?: unknown;
  noCheckin?: boolean;
  answers?: Record<string, unknown>;
  notesCipher?: Buffer | null;
  decryptedNotes?: Record<string, unknown>;
  comment?: string;
  noComment?: boolean;
  volumeAdjustResult?: {
    applied: boolean;
    summary?: string;
    protocolId?: string;
    version?: number;
    reason?: string;
  };
  identifyResult?: { identified: boolean; exerciseId?: string };
  personalInfo?: unknown;
}) {
  const userRow = opts.userRow ?? DEFAULT_USER_ROW;
  const checkinRow = opts.noCheckin
    ? undefined
    : {
        answers: opts.answers ?? DEFAULT_ANSWERS,
        notesCipher: opts.notesCipher ?? null,
      };
  const alertInsertValues = vi.fn();
  const db = {
    runAsUser: vi.fn((_userId: string, _role: string, cb: (tx: unknown) => Promise<unknown>) =>
      cb(makeTx({ userRow, checkinRow, alertInsertValues })),
    ),
  } as unknown as TenantDatabase;
  const cipher = {
    decryptHealth: vi.fn(async () => JSON.stringify(opts.decryptedNotes ?? {})),
  } as unknown as HealthCipherService;
  const commentFn = vi.fn(async () =>
    opts.noComment ? undefined : (opts.comment ?? 'Comentário gerado.'),
  );
  const feedback = { comment: commentFn } as unknown as CheckinWeeklyFeedbackService;
  const adjustFn = vi.fn(
    async () => opts.volumeAdjustResult ?? { applied: false, reason: 'NOT_CALLED' },
  );
  const volumeAdjustment = { adjust: adjustFn } as unknown as ProtocolVolumeAdjustmentService;
  const identifyFn = vi.fn(async () => opts.identifyResult ?? { identified: false });
  const substitutionTarget = { identify: identifyFn } as unknown as SubstitutionTargetService;
  const loadActiveProtocol = vi.fn(async () => ({
    content: {
      sessions: [{ exercises: [{ exerciseId: 'goblet_squat', name: 'Agachamento Goblet' }] }],
    },
  }));
  const substitutionRepo = { loadActiveProtocol } as unknown as ProtocolSubstitutionRepository;
  const findLatestPersonalInfo = vi.fn(async () => opts.personalInfo ?? null);
  const setPdfContent = vi.fn(async () => undefined);
  const protocolRepository = {
    findLatestPersonalInfo,
    setPdfContent,
  } as unknown as ProtocolRepository;
  const enqueue = vi.fn(async () => 'job');
  const queues = { enqueue } as unknown as QueueManager;
  const workers = { create: vi.fn() } as unknown as WorkerFactory;
  const queueEvents = { emit: vi.fn() } as unknown as DashboardQueueEventsService;
  const recordFromCheckin = vi.fn(async () => 0);
  const workoutCompletions = { recordFromCheckin } as unknown as WorkoutCompletionService;
  const logger = { warn: vi.fn(), info: vi.fn(), setContext: vi.fn() } as never;

  const worker = new CheckinWeeklyFeedbackWorker(
    workers,
    queues,
    db,
    cipher,
    feedback,
    volumeAdjustment,
    substitutionTarget,
    substitutionRepo,
    protocolRepository,
    queueEvents,
    workoutCompletions,
    logger,
  );
  return {
    worker,
    enqueue,
    commentFn,
    adjustFn,
    identifyFn,
    alertInsertValues,
    recordFromCheckin,
    findLatestPersonalInfo,
  };
}

function job(): Job<CheckinWeeklyFeedbackJob> {
  return {
    data: { userId: USER_ID, checkinId: CHECKIN_ID },
  } as unknown as Job<CheckinWeeklyFeedbackJob>;
}

describe('CheckinWeeklyFeedbackWorker', () => {
  it('sessão inexistente: não chama nada, devolve NOT_FOUND', async () => {
    const { worker, commentFn, enqueue } = makeWorker({ noCheckin: true });
    await expect(worker.process(job())).resolves.toEqual({ status: 'NOT_FOUND' });
    expect(commentFn).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('caminho feliz: registra fallback de treino, gera comentário e envia', async () => {
    const { worker, enqueue, recordFromCheckin } = makeWorker({});
    await expect(worker.process(job())).resolves.toEqual({ status: 'SENT' });
    expect(recordFromCheckin).toHaveBeenCalledWith(USER_ID, 9);
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'checkin-weekly-feedback',
      expect.objectContaining({
        userId: USER_ID,
        type: 'COACH_MESSAGE',
        text: 'Acabei de analisar seu check-in semanal!\n---\nComentário gerado.',
      }),
      { jobId: `wa-checkin-weekly-feedback-${CHECKIN_ID}` },
    );
  });

  it('comentário reprovado/ausente: não envia nada', async () => {
    const { worker, enqueue } = makeWorker({ noComment: true });
    await expect(worker.process(job())).resolves.toEqual({ status: 'SKIPPED' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('aderência baixa cria alerta de revisão para o profissional', async () => {
    const { worker, alertInsertValues } = makeWorker({
      answers: { ...DEFAULT_ANSWERS, adherenceScore: 2 },
    });
    await worker.process(job());
    expect(alertInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'ALERT', reason: 'CHECKIN_REVISAO' }),
    );
  });

  it('humor desmotivado cria alerta de revisão mesmo com boa aderência', async () => {
    const { worker, alertInsertValues } = makeWorker({
      answers: { ...DEFAULT_ANSWERS, mood: 'DESMOTIVADO' },
    });
    await worker.process(job());
    expect(alertInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'ALERT', reason: 'CHECKIN_REVISAO' }),
    );
  });

  it('duração mais curta: aplica o ajuste e passa o resumo pro comentário', async () => {
    const { worker, adjustFn, commentFn } = makeWorker({
      answers: { ...DEFAULT_ANSWERS, durationFit: 'MAIS_CURTOS' },
      volumeAdjustResult: {
        applied: true,
        summary: 'reduziu 1 série do Agachamento Goblet',
        protocolId: 'p1',
        version: 4,
      },
    });
    await worker.process(job());
    expect(adjustFn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, checkinId: CHECKIN_ID }),
    );
    expect(commentFn).toHaveBeenCalledWith(
      expect.objectContaining({ volumeAdjustmentSummary: 'reduziu 1 série do Agachamento Goblet' }),
    );
  });

  it('duração mais curta: ajuste não aplicado não quebra o fluxo nem menciona resumo', async () => {
    const { worker, commentFn } = makeWorker({
      answers: { ...DEFAULT_ANSWERS, durationFit: 'MAIS_CURTOS' },
      volumeAdjustResult: { applied: false, reason: 'VALIDATION_BLOCKED' },
    });
    await expect(worker.process(job())).resolves.toEqual({ status: 'SENT' });
    expect(commentFn).toHaveBeenCalledWith(
      expect.objectContaining({ volumeAdjustmentSummary: undefined }),
    );
  });

  it('reentrega do protocolo falhando (sem anamnese) não derruba o job nem o comentário', async () => {
    const { worker } = makeWorker({
      answers: { ...DEFAULT_ANSWERS, durationFit: 'MAIS_CURTOS' },
      volumeAdjustResult: { applied: true, summary: 'x', protocolId: 'p1', version: 4 },
      personalInfo: null,
    });
    await expect(worker.process(job())).resolves.toEqual({ status: 'SENT' });
  });

  it('duração mais longa: não chama o ajuste de volume', async () => {
    const { worker, adjustFn } = makeWorker({
      answers: { ...DEFAULT_ANSWERS, durationFit: 'MAIS_LONGOS' },
    });
    await worker.process(job());
    expect(adjustFn).not.toHaveBeenCalled();
  });

  it('exercício difícil identificado: nomeia no comentário', async () => {
    const { worker, identifyFn, commentFn } = makeWorker({
      notesCipher: Buffer.from('cipher'),
      decryptedNotes: { difficultExerciseDescription: 'tive dificuldade no agachamento' },
      identifyResult: { identified: true, exerciseId: 'goblet_squat' },
    });
    await worker.process(job());
    expect(identifyFn).toHaveBeenCalledWith(
      expect.objectContaining({ recentConversation: 'tive dificuldade no agachamento' }),
    );
    expect(commentFn).toHaveBeenCalledWith(
      expect.objectContaining({ identifiedExerciseName: 'Agachamento Goblet' }),
    );
  });

  it('relato de dor na dificuldade do exercício cria alerta SAFETY', async () => {
    const { worker, alertInsertValues } = makeWorker({
      notesCipher: Buffer.from('cipher'),
      decryptedNotes: { difficultExerciseDescription: 'sinto uma dor forte no ombro' },
    });
    await worker.process(job());
    expect(alertInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'SAFETY', reason: 'CHECKIN_DOR_ARTICULAR' }),
    );
  });

  it('sem dificuldade relatada: não chama identificação de substituição', async () => {
    const { worker, identifyFn } = makeWorker({});
    await worker.process(job());
    expect(identifyFn).not.toHaveBeenCalled();
  });
});
