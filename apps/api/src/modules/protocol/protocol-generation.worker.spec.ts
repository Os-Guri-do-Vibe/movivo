import { PARQ_QUESTION_IDS, PARQ_VERSION, type ProtocolStructure } from '@movivo/shared';
import type { Job } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { users } from '../../core/database/schema';
import type { HealthCipherService } from '../../core/database/health-cipher.service';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { QueueManager } from '../jobs/queue-manager.service';
import type { WorkerFactory } from '../jobs/worker.factory';
import { ProtocolGenerationWorker, type ProtocolGenerationJob } from './protocol-generation.worker';
import type {
  GenerateProtocolResult,
  ProtocolGeneratorService,
} from './protocol-generator.service';
import type { ProtocolRepository } from './protocol.repository';
import type { ValidationService, ValidationVerdict } from './validation/validation.service';

function structure(): ProtocolStructure {
  return {
    promptVersion: 'v1',
    goal: 'GAIN_MUSCLE',
    phase: 'ADAPTACAO',
    weeklyFrequency: 3,
    sessions: [
      {
        dayLabel: 'A',
        focus: 'Full',
        exercises: [
          {
            exerciseId: 'goblet_squat',
            name: 'Agachamento',
            sets: 3,
            reps: { min: 8, max: 12 },
            loadStrategy: 'DOUBLE_PROGRESSION',
            restSeconds: 90,
          },
        ],
      },
    ],
  };
}

const genResult: GenerateProtocolResult = {
  structure: structure(),
  provider: 'OPENAI_GPT41',
  model: 'gpt-4.1',
  attempt: 1,
  costBrl: 0.01,
  promptVersion: 'methodology+catalog',
  unknownExerciseIds: [],
};

function block2Json(injuries: string[] = ['joelho']) {
  return JSON.stringify({
    parq: {
      version: PARQ_VERSION,
      answers: PARQ_QUESTION_IDS.map((questionId) => ({ questionId, answer: false })),
    },
    injuries,
  });
}

function userRow(over: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    name: 'Fulano',
    phoneNumber: '+5541999999999',
    email: null,
    requiresProfessionalReview: false,
    ...over,
  };
}

function sessionRow(over: Record<string, unknown> = {}) {
  return {
    id: 's1',
    primaryGoal: 'GAIN_MUSCLE',
    submittedAt: new Date(Date.now() - 60_000),
    dataBlock2: Buffer.from('cipher'),
    dataBlock3: { daysPerWeek: 3, location: 'HOME', equipment: ['halteres'] },
    ...over,
  };
}

/** tx falso: distingue as tabelas pelo objeto passado em `.from()`. */
function makeTx(user: unknown, session: unknown) {
  let table: unknown;
  const chain = {
    select: () => chain,
    from: (t: unknown) => {
      table = t;
      return chain;
    },
    where: () => chain,
    limit: () => Promise.resolve(table === users ? (user ? [user] : []) : session ? [session] : []),
  };
  return chain;
}

function verdict(action: ValidationVerdict['action']): ValidationVerdict {
  const code = action === 'PASS' ? 'PASS' : action === 'BLOCK_FALLBACK' ? 'BLOCK' : 'FLAG';
  return { action, code, humanReviewRequired: action !== 'PASS', violations: [] };
}

interface Deps {
  user?: unknown;
  session?: unknown;
  exists?: boolean;
  action?: ValidationVerdict['action'];
  alreadyExisted?: boolean;
}

function makeWorker(deps: Deps = {}) {
  const workerListeners: Array<(job: Job | undefined, err: Error) => void> = [];
  const fakeWorker = {
    on: (_evt: string, cb: (job: Job | undefined, err: Error) => void) => workerListeners.push(cb),
  };
  const workers = { create: vi.fn(() => fakeWorker) } as unknown as WorkerFactory;

  const userValue = 'user' in deps ? deps.user : userRow();
  const sessionValue = 'session' in deps ? deps.session : sessionRow();
  const db = {
    runAsUser: vi.fn((_uid: string, _role: string, cb: (tx: unknown) => Promise<unknown>) =>
      cb(makeTx(userValue, sessionValue)),
    ),
  } as unknown as TenantDatabase;

  const cipher = {
    decryptHealth: vi.fn(() => Promise.resolve(block2Json())),
  } as unknown as HealthCipherService;

  const generator = {
    generate: vi.fn(() => Promise.resolve(genResult)),
  } as unknown as ProtocolGeneratorService;

  const validation = {
    validate: vi.fn(() => verdict(deps.action ?? 'PASS')),
  } as unknown as ValidationService;

  const repository = {
    existsForUser: vi.fn(() => Promise.resolve(deps.exists ?? false)),
    persist: vi.fn(() =>
      Promise.resolve({
        protocolId: 'p1',
        version: 1,
        alreadyExisted: deps.alreadyExisted ?? false,
      }),
    ),
  } as unknown as ProtocolRepository;

  const enqueue = vi.fn(() => Promise.resolve('job'));
  const queues = { enqueue } as unknown as QueueManager;

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() } as never;
  const worker = new ProtocolGenerationWorker(
    workers,
    queues,
    db,
    cipher,
    generator,
    validation,
    repository,
    logger,
  );
  return { worker, repository, queues, enqueue, generator, workers, workerListeners };
}

function job(over: Partial<ProtocolGenerationJob> = {}): Job<ProtocolGenerationJob> {
  return {
    id: 'j1',
    data: { userId: 'u1', anamnesisSessionId: 's1', ...over },
    opts: { attempts: 3 },
    attemptsMade: 0,
  } as unknown as Job<ProtocolGenerationJob>;
}

afterEach(() => vi.restoreAllMocks());

describe('ProtocolGenerationWorker.process (US-2.4)', () => {
  it('caminho limpo → persiste AUTO_APPROVED assinado e enfileira a entrega', async () => {
    const { worker, repository, enqueue } = makeWorker({ action: 'PASS' });
    const res = await worker.process(job());
    expect(res.status).toBe('AUTO_APPROVED');
    expect(repository.persist).toHaveBeenCalledWith(
      expect.objectContaining({ signed: true, approvalStatus: 'AUTO_APPROVED', status: 'ACTIVE' }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'protocol-delivery',
      expect.objectContaining({ userId: 'u1', protocolId: 'p1' }),
      expect.objectContaining({ jobId: 'protocol-delivery_u1_1' }),
    );
  });

  it('gate PAR-Q é trava: sessão de risco não gera nada', async () => {
    const { worker, generator, repository } = makeWorker({
      user: userRow({ requiresProfessionalReview: true }),
    });
    const res = await worker.process(job());
    expect(res.status).toBe('BLOCKED_PENDING_CLEARANCE');
    expect(generator.generate).not.toHaveBeenCalled();
    expect(repository.persist).not.toHaveBeenCalled();
  });

  it('idempotência: protocolo já existe → não chama o LLM nem persiste', async () => {
    const { worker, generator, repository } = makeWorker({ exists: true });
    const res = await worker.process(job());
    expect(res.status).toBe('ALREADY_EXISTS');
    expect(generator.generate).not.toHaveBeenCalled();
    expect(repository.persist).not.toHaveBeenCalled();
  });

  it('validador bloqueou (template) → PENDING_REVIEW, sem entrega', async () => {
    const { worker, enqueue, repository } = makeWorker({ action: 'BLOCK_FALLBACK' });
    const res = await worker.process(job());
    expect(res.status).toBe('PENDING_REVIEW');
    expect(repository.persist).toHaveBeenCalledWith(
      expect.objectContaining({ signed: false, humanReviewRequired: true }),
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('corrida de persistência (alreadyExisted) → não entrega', async () => {
    const { worker, enqueue } = makeWorker({ action: 'PASS', alreadyExisted: true });
    const res = await worker.process(job());
    expect(res.status).toBe('ALREADY_EXISTS');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('usuário/sessão ausentes → NOT_FOUND sem gerar', async () => {
    const { worker, generator } = makeWorker({ user: null });
    const res = await worker.process(job());
    expect(res.status).toBe('NOT_FOUND');
    expect(generator.generate).not.toHaveBeenCalled();
  });
});

describe('ProtocolGenerationWorker.onModuleInit + DLQ fallback (US-2.4)', () => {
  it('registra o processor e, na falha terminal, enfileira espera + template pendente', async () => {
    const { worker, workers, workerListeners, enqueue, repository } = makeWorker();
    worker.onModuleInit();
    expect(workers.create).toHaveBeenCalledWith('protocol-generation', expect.any(Function));

    const terminal = { ...job(), attemptsMade: 3 } as Job<ProtocolGenerationJob>;
    workerListeners[0]?.(terminal, new Error('LLM down'));
    await vi.waitFor(() => expect(repository.persist).toHaveBeenCalled());

    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'protocol-waiting',
      expect.objectContaining({ userId: 'u1' }),
      expect.objectContaining({ jobId: 'protocol-waiting_u1' }),
    );
    expect(repository.persist).toHaveBeenCalledWith(
      expect.objectContaining({ humanReviewRequired: true, generatedBy: 'FALLBACK_TEMPLATE' }),
    );
  });

  it('não aciona fallback quando a falha não é terminal', async () => {
    const { worker, workerListeners, repository } = makeWorker();
    worker.onModuleInit();
    const nonTerminal = { ...job(), attemptsMade: 1 } as Job<ProtocolGenerationJob>;
    workerListeners[0]?.(nonTerminal, new Error('transient'));
    await new Promise((r) => setTimeout(r, 10));
    expect(repository.persist).not.toHaveBeenCalled();
  });
});
