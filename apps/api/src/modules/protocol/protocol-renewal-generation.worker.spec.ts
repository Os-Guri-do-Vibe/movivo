import type { ProtocolStructure } from '@movivo/shared';
import type { Job } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { protocolRenewalSessions, protocols, users } from '../../core/database/schema';
import type { HealthCipherService } from '../../core/database/health-cipher.service';
import type { HealthConsentService } from '../../core/database/health-consent.service';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import type { QueueManager } from '../jobs/queue-manager.service';
import type { WorkerFactory } from '../jobs/worker.factory';
import {
  ProtocolRenewalGenerationWorker,
  type ProtocolRenewalGenerationJob,
} from './protocol-renewal-generation.worker';
import type {
  GenerateProtocolResult,
  ProtocolGeneratorService,
} from './protocol-generator.service';
import type { UserConstraints } from './user-constraints';
import type { ProtocolRepository } from './protocol.repository';
import type { ValidationService, ValidationVerdict } from './validation/validation.service';

function structure(overrides: Partial<ProtocolStructure> = {}): ProtocolStructure {
  return {
    promptVersion: 'v1',
    goal: 'GAIN_MUSCLE',
    phase: 'ADAPTACAO',
    phaseDurationWeeks: 3,
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
    ...overrides,
  };
}

const genResult: GenerateProtocolResult = {
  structure: structure({ phase: 'HIPERTROFIA' }),
  provider: 'OPENAI_GPT41',
  model: 'gpt-4.1',
  attempt: 1,
  costBrl: 0.01,
  promptVersion: 'methodology+catalog',
  unknownExerciseIds: [],
};

const PREVIOUS_CONSTRAINTS: UserConstraints = {
  goal: 'GAIN_MUSCLE',
  level: 'INICIANTE',
  trainingStatus: 'NEVER',
  daysPerWeek: 3,
  preferredDays: ['MON', 'WED', 'FRI'],
  location: 'HOME',
  equipment: [],
  emphasis: [],
  avoid: [],
  injuryTags: [],
  injuriesRaw: [],
  requiresProfessionalReview: false,
  parqTags: [],
  parqTriggered: [],
};

function previousProtocolRow(over: Record<string, unknown> = {}) {
  return {
    content: structure({ phase: 'ADAPTACAO' }),
    constraints: PREVIOUS_CONSTRAINTS as unknown as UserConstraints,
    totalWeeks: 3,
    mesocycleNumber: 1,
    ...over,
  };
}

function renewalSessionRow(over: Record<string, unknown> = {}) {
  return {
    id: 'renewal-1',
    previousProtocolId: 'prev-1',
    dataBlock1: {
      completionRate: 'SEMPRE',
      actualFrequency: 'TODOS_OS_DIAS_PLANEJADOS',
      loadProgression: 'EVOLUI_NA_MAIORIA',
      perceivedEffort: 'SOBRAVA_UM_POUCO',
    },
    dataBlock2: {
      fatigueLevel: 'MODERADO',
      sleepQuality: 'BOA',
      stressLevel: 'BAIXO',
      muscleSoreness: 'NORMAL',
    },
    dataBlock3: Buffer.from('cipher'),
    dataBlock4: { currentWeightKg: 78, goalProgress: 'DENTRO_DO_ESPERADO', satisfaction: 8 },
    dataBlock5: {
      changes: ['NONE'],
      preferredDays: [],
      dislikedExercise: { has: false },
      barriers: [],
      goalChange: { changed: false },
    },
    ...over,
  };
}

function block3Json(changedToYes = false) {
  return JSON.stringify({
    newPain: { hasNewPain: false },
    parqRecheck: changedToYes
      ? { changedToYes: true, detail: 'nova medicação contínua' }
      : { changedToYes: false },
  });
}

function userRow(over: Record<string, unknown> = {}) {
  return { id: 'u1', name: 'Fulano', phoneNumber: '+5541999999999', email: null, ...over };
}

/**
 * tx falso: distingue tabelas por `.from()`; `protocols` responde diferente na 1ª
 * (idempotência) e 2ª chamada (previous). A partir da 3ª chamada a `protocols` (ADR-008:
 * `computeMesocycleSummary` sob demanda, quando `mesocycleSummary` vem `undefined` do
 * fixture) e qualquer tabela do diário/anamnese (`workout_*`, `checkins`,
 * `anamnesis_sessions`) respondem vazio — estes testes cobrem o pipeline de geração
 * central, não a memória longitudinal (que tem specs próprias em `mesocycle-summary`).
 * `then` faz `chain` funcionar tanto com `.limit()` quanto com `await` direto
 * (`loadLongitudinalContext` usa `.orderBy(...)` sem `.limit()` em algumas consultas).
 */
function makeTx(user: unknown, session: unknown, previousProtocol: unknown) {
  let table: unknown;
  let protocolsCalls = 0;
  const resolve = (): unknown[] => {
    if (table === users) return user ? [user] : [];
    if (table === protocolRenewalSessions) return session ? [session] : [];
    if (table === protocols) {
      protocolsCalls += 1;
      if (protocolsCalls === 1) return []; // alreadyGenerated(): nada ainda
      if (protocolsCalls === 2) return previousProtocol ? [previousProtocol] : [];
      return []; // ADR-008: qualquer leitura extra de `protocols` (compute sob demanda, carreira)
    }
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
  return chain;
}

function verdict(action: ValidationVerdict['action'] = 'PASS'): ValidationVerdict {
  const code = action === 'PASS' ? 'PASS' : 'BLOCK';
  return { action, code, humanReviewRequired: action !== 'PASS', violations: [] };
}

interface Deps {
  user?: unknown;
  session?: unknown;
  previousProtocol?: unknown;
  alreadyGenerated?: boolean;
  action?: ValidationVerdict['action'];
  consentActive?: boolean;
  changedToYes?: boolean;
}

function makeWorker(deps: Deps = {}) {
  const workerListeners: Array<(job: Job | undefined, err: Error) => void> = [];
  const fakeWorker = {
    on: (_evt: string, cb: (job: Job | undefined, err: Error) => void) => workerListeners.push(cb),
  };
  const workers = { create: vi.fn(() => fakeWorker) } as unknown as WorkerFactory;

  const userValue = 'user' in deps ? deps.user : userRow();
  const sessionValue = 'session' in deps ? deps.session : renewalSessionRow();
  const previousValue = 'previousProtocol' in deps ? deps.previousProtocol : previousProtocolRow();
  const tx = makeTx(userValue, sessionValue, previousValue);
  // `alreadyGenerated` responde na 1ª chamada de `.from(protocols)`; força isso quando pedido.
  if (deps.alreadyGenerated) {
    (tx as { limit: () => unknown }).limit = () => Promise.resolve([{ id: 'already-1' }]);
  }
  const db = {
    runAsUser: vi.fn((_uid: string, _role: string, cb: (tx: unknown) => Promise<unknown>) =>
      cb(tx),
    ),
  } as unknown as TenantDatabase;

  const cipher = {
    decryptHealth: vi.fn(() => Promise.resolve(block3Json(deps.changedToYes ?? false))),
  } as unknown as HealthCipherService;

  const generator = {
    generate: vi.fn(() => Promise.resolve(genResult)),
  } as unknown as ProtocolGeneratorService;
  const validation = {
    validate: vi.fn(() => verdict(deps.action ?? 'PASS')),
  } as unknown as ValidationService;

  const repository = {
    persist: vi.fn(() => Promise.resolve({ protocolId: 'p1', version: 1, alreadyExisted: false })),
  } as unknown as ProtocolRepository;

  const enqueue = vi.fn(() => Promise.resolve('job'));
  const queues = { enqueue } as unknown as QueueManager;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };

  const worker = new ProtocolRenewalGenerationWorker(
    workers,
    queues,
    db,
    {
      hasActiveForUser: vi.fn(async () => deps.consentActive ?? true),
    } as unknown as HealthConsentService,
    cipher,
    generator,
    validation,
    repository,
    { emit: vi.fn() } as unknown as DashboardQueueEventsService,
    logger as never,
  );
  return { worker, repository, queues, enqueue, generator };
}

function job(over: Partial<ProtocolRenewalGenerationJob> = {}): Job<ProtocolRenewalGenerationJob> {
  return {
    id: 'j1',
    data: { userId: 'u1', renewalSessionId: 'renewal-1', ...over },
    opts: { attempts: 3 },
    attemptsMade: 0,
  } as unknown as Job<ProtocolRenewalGenerationJob>;
}

afterEach(() => vi.restoreAllMocks());

describe('ProtocolRenewalGenerationWorker.process', () => {
  it('consentimento revogado encerra sem gerar nem persistir', async () => {
    const { worker, generator, repository } = makeWorker({ consentActive: false });
    await expect(worker.process(job())).resolves.toEqual({ status: 'CONSENT_REVOKED' });
    expect(generator.generate).not.toHaveBeenCalled();
    expect(repository.persist).not.toHaveBeenCalled();
  });

  it('idempotente: se já existe protocolo para esta renewalSessionId, não gera de novo', async () => {
    const { worker, generator, repository } = makeWorker({ alreadyGenerated: true });
    await expect(worker.process(job())).resolves.toEqual({ status: 'ALREADY_EXISTS' });
    expect(generator.generate).not.toHaveBeenCalled();
    expect(repository.persist).not.toHaveBeenCalled();
  });

  it('caminho limpo (repescagem PAR-Q negativa): PENDING_REVIEW/OPTIONAL + contexto de continuação', async () => {
    const { worker, repository, generator, enqueue } = makeWorker({ changedToYes: false });
    const res = await worker.process(job());
    expect(res.status).toBe('PENDING_REVIEW');

    expect(generator.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: expect.objectContaining({
          requiresProfessionalReview: false,
          continuation: expect.objectContaining({
            previousMesocycleNumber: 1,
            previousPhase: 'ADAPTACAO',
            previousPhaseDurationWeeks: 3,
          }),
        }),
      }),
    );
    expect(repository.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        anamnesisSessionId: null,
        renewalSessionId: 'renewal-1',
        approvalStatus: 'PENDING_REVIEW',
        status: 'PENDING_SIGNATURE',
        reviewUrgency: 'OPTIONAL',
      }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      'protocol-auto-release',
      'auto-release',
      { userId: 'u1', protocolId: 'p1' },
      { delay: 60 * 60 * 1000, jobId: 'auto-release-p1' },
    );
  });

  it('pergunta 10 (repescagem PAR-Q) "mudou para Sim": MANDATORY, sem auto-liberação, maxPhase ADAPTACAO', async () => {
    const { worker, repository, generator, enqueue } = makeWorker({ changedToYes: true });
    const res = await worker.process(job());
    expect(res.status).toBe('PENDING_REVIEW');
    expect(generator.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: expect.objectContaining({
          requiresProfessionalReview: true,
          maxPhase: 'ADAPTACAO',
        }),
      }),
    );
    expect(repository.persist).toHaveBeenCalledWith(
      expect.objectContaining({ reviewUrgency: 'MANDATORY' }),
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('conteúdo cai no fallback (BLOCK persistente): MANDATORY mesmo com PAR-Q liberado', async () => {
    const { worker, repository, enqueue } = makeWorker({
      action: 'BLOCK_FALLBACK',
      changedToYes: false,
    });
    const res = await worker.process(job());
    expect(res.status).toBe('PENDING_REVIEW');
    expect(repository.persist).toHaveBeenCalledWith(
      expect.objectContaining({ reviewUrgency: 'MANDATORY' }),
    );
    expect(enqueue).not.toHaveBeenCalled();
  });
});
