import { PARQ_QUESTION_IDS, PARQ_VERSION, type ProtocolStructure } from '@movivo/shared';
import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { qualityAssessment } from './contextual-quality.fixture';

import { anamnesisSessions, protocols, users } from '../../core/database/schema';
import type { HealthCipherService } from '../../core/database/health-cipher.service';
import type { HealthConsentService } from '../../core/database/health-consent.service';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import type { QueueManager } from '../jobs/queue-manager.service';
import type { WorkerFactory } from '../jobs/worker.factory';
import type {
  GenerateProtocolResult,
  ProtocolGeneratorService,
} from './protocol-generator.service';
import {
  ProtocolRegenerationWorker,
  regenerationJobId,
  type ProtocolRegenerationJob,
} from './protocol-regeneration.worker';
import type { ValidationService, ValidationVerdict } from './validation/validation.service';

const PROTOCOL_ID = 'p1';

function structure(): ProtocolStructure {
  return {
    promptVersion: 'v1',
    goal: 'GAIN_MUSCLE',
    phase: 'HIPERTROFIA',
    phaseDurationWeeks: 8,
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

function healthJson() {
  return JSON.stringify({
    pain: { hasPain: false, points: [] },
    freeText: {},
    parq: {
      version: PARQ_VERSION,
      answers: PARQ_QUESTION_IDS.map((questionId) => ({ questionId, answer: false })),
    },
    declarations: {
      version: 'parq-declaracoes-2026-08-v1',
      accepted: ['TRUTHFUL', 'WILL_REPORT_CHANGES', 'MAY_REQUIRE_REVIEW'],
      acceptedAt: '2026-08-10T12:00:00.000Z',
    },
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

const sessionRow = {
  id: 's1',
  submittedAt: new Date(Date.now() - 60_000),
  dataBlock2: Buffer.from('cipher'),
  dataBlock3: {
    primaryGoal: 'GAIN_MUSCLE',
    emphasis: [],
    hasImportantEvent: false,
    trainingStatus: 'REGULAR',
    experience: 'INTERMEDIATE',
    pastActivities: [],
    consistencyBarriers: [],
    daysPerWeek: 3,
    preferredDays: ['MON', 'WED', 'FRI'],
    sessionDuration: 'M45_TO_60',
    location: 'HOME',
    preferredPeriod: 'MORNING',
    practicesOtherSport: false,
    hasAvoidedExercise: false,
  },
};

/** Linha de `protocols` do titular: nasceu do template de fallback (MANDATORY). */
function protocolRow(over: Record<string, unknown> = {}) {
  return {
    status: 'PENDING_SIGNATURE',
    approvalStatus: 'PENDING_REVIEW',
    anamnesisSessionId: 's1',
    generatedBy: 'FALLBACK_TEMPLATE',
    mesocycleNumber: 1,
    content: structure(),
    ...over,
  };
}

function verdict(action: ValidationVerdict['action']): ValidationVerdict {
  const code = action === 'PASS' ? 'PASS' : action === 'BLOCK_FALLBACK' ? 'BLOCK' : 'FLAG';
  return { action, code, humanReviewRequired: action !== 'PASS', violations: [] };
}

interface Deps {
  user?: unknown;
  protocol?: Record<string, unknown> | null;
  /** Estado da linha ao gravar (depois da geração) — simula assinatura/edição no meio. */
  protocolAtWrite?: Record<string, unknown>;
  action?: ValidationVerdict['action'];
  consentActive?: boolean;
  /** Jobs de auto-liberação ainda agendados (`delayed`). */
  delayedAutoRelease?: Array<{ data: { protocolId: string }; remove: () => Promise<void> }>;
}

function makeWorker(deps: Deps = {}) {
  const workers = { create: vi.fn() } as unknown as WorkerFactory;
  const protocolValue = 'protocol' in deps ? deps.protocol : protocolRow();
  let protocolReads = 0;
  const updates: Array<Record<string, unknown>> = [];

  const makeTx = () => {
    let table: unknown;
    const chain: Record<string, unknown> = {
      select: () => chain,
      from: (t: unknown) => {
        table = t;
        return chain;
      },
      where: () => chain,
      for: () => chain,
      limit: () => {
        if (table === protocols) {
          protocolReads += 1;
          // 1ª leitura = `readPending`; 2ª = reconferência sob lock, depois da geração.
          const row = protocolReads === 1 ? protocolValue : (deps.protocolAtWrite ?? protocolValue);
          return Promise.resolve(row ? [row] : []);
        }
        if (table === users) return Promise.resolve([deps.user ?? userRow()]);
        if (table === anamnesisSessions) return Promise.resolve([sessionRow]);
        return Promise.resolve([]);
      },
      update: () => ({
        set: (values: Record<string, unknown>) => {
          updates.push(values);
          return { where: () => Promise.resolve() };
        },
      }),
    };
    return chain;
  };
  const db = {
    runAsUser: vi.fn((_uid: string, _role: string, cb: (tx: unknown) => Promise<unknown>) =>
      cb(makeTx()),
    ),
  } as unknown as TenantDatabase;

  const cipher = {
    decryptHealth: vi.fn(() => Promise.resolve(healthJson())),
  } as unknown as HealthCipherService;
  const generator = {
    assessQuality: vi.fn(async () => qualityAssessment()),
    generate: vi.fn(() => Promise.resolve(genResult)),
  } as unknown as ProtocolGeneratorService;
  const validation = {
    validate: vi.fn(() => verdict(deps.action ?? 'PASS')),
    exerciseById: vi.fn(() => undefined),
  } as unknown as ValidationService;

  const enqueue = vi.fn(() => Promise.resolve('job'));
  const getJobs = vi.fn(async () => deps.delayedAutoRelease ?? []);
  const queues = { enqueue, get: () => ({ getJobs }) } as unknown as QueueManager;
  const emit = vi.fn();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };

  const worker = new ProtocolRegenerationWorker(
    workers,
    queues,
    db,
    {
      hasActiveForUser: vi.fn(async () => deps.consentActive ?? true),
    } as unknown as HealthConsentService,
    cipher,
    generator,
    validation,
    { emit } as unknown as DashboardQueueEventsService,
    logger as never,
  );
  return { worker, updates, enqueue, generator, emit, logger };
}

function job(over: Partial<ProtocolRegenerationJob> = {}): Job<ProtocolRegenerationJob> {
  return {
    id: regenerationJobId(PROTOCOL_ID),
    data: { userId: 'u1', protocolId: PROTOCOL_ID, requestedBy: 'staff-1', ...over },
    opts: { attempts: 2 },
    attemptsMade: 0,
  } as unknown as Job<ProtocolRegenerationJob>;
}

describe('ProtocolRegenerationWorker', () => {
  it('fallback regerado com sucesso, aluno sem PAR-Q bloqueante → Revisão Humana Opcional com auto-liberação', async () => {
    const { worker, updates, enqueue, emit } = makeWorker();
    await expect(worker.process(job())).resolves.toEqual({ status: 'REGENERATED' });

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      reviewUrgency: 'OPTIONAL',
      generatedBy: 'OPENAI_GPT41',
      modelVersion: 'gpt-4.1',
      status: 'PENDING_SIGNATURE',
      approvalStatus: 'PENDING_REVIEW',
      humanReviewRequired: true,
      totalWeeks: 8,
      mesocycleName: 'Mesociclo 1: Hipertrofia',
    });
    // Constraints completas (com `daysPerWeek`) no lugar da forma mínima do fallback.
    expect(updates[0]?.constraints).toMatchObject({
      daysPerWeek: 3,
      requiresProfessionalReview: false,
    });
    expect(enqueue).toHaveBeenCalledWith(
      'protocol-auto-release',
      'auto-release',
      { userId: 'u1', protocolId: PROTOCOL_ID },
      expect.objectContaining({ delay: 24 * 60 * 60 * 1000 }),
    );
    expect(emit).toHaveBeenCalledWith('protocol');
  });

  it('PAR-Q bloqueante continua obrigatório e nunca agenda auto-liberação', async () => {
    const { worker, updates, enqueue } = makeWorker({
      user: userRow({ requiresProfessionalReview: true }),
    });
    await expect(worker.process(job())).resolves.toEqual({ status: 'REGENERATED' });
    expect(updates[0]).toMatchObject({ reviewUrgency: 'MANDATORY', generatedBy: 'OPENAI_GPT41' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('cai no fallback de novo → não grava nada, protocolo atual permanece', async () => {
    const { worker, updates, enqueue, emit } = makeWorker({ action: 'BLOCK_FALLBACK' });
    await expect(worker.process(job())).resolves.toEqual({ status: 'FALLBACK_AGAIN' });
    expect(updates).toHaveLength(0);
    expect(enqueue).not.toHaveBeenCalled();
    // O painel ainda é avisado para sair do "gerando…".
    expect(emit).toHaveBeenCalledWith('protocol');
  });

  it('remove a auto-liberação agendada da geração anterior antes de reagendar', async () => {
    const stale = { data: { protocolId: PROTOCOL_ID }, remove: vi.fn(async () => undefined) };
    const other = { data: { protocolId: 'outro' }, remove: vi.fn(async () => undefined) };
    const { worker } = makeWorker({
      protocol: protocolRow({ generatedBy: 'OPENAI_GPT41' }),
      delayedAutoRelease: [stale, other],
    });
    await worker.process(job());
    expect(stale.remove).toHaveBeenCalledOnce();
    expect(other.remove).not.toHaveBeenCalled();
  });

  it('protocolo assinado enquanto gerava → não sobrescreve', async () => {
    const { worker, updates, enqueue } = makeWorker({
      protocolAtWrite: protocolRow({ status: 'ACTIVE', approvalStatus: 'HUMAN_APPROVED' }),
    });
    await expect(worker.process(job())).resolves.toEqual({ status: 'NOT_PENDING' });
    expect(updates).toHaveLength(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('profissional editou enquanto gerava → preserva a edição, a menos que tenha confirmado', async () => {
    const edited = protocolRow({ generatedBy: 'PROFESSIONAL_EDIT' });
    const kept = makeWorker({ protocolAtWrite: edited });
    await expect(kept.worker.process(job())).resolves.toEqual({ status: 'EDITED_MEANWHILE' });
    expect(kept.updates).toHaveLength(0);

    const confirmed = makeWorker({ protocol: edited });
    await expect(
      confirmed.worker.process(job({ overrideProfessionalEdit: true })),
    ).resolves.toEqual({ status: 'REGENERATED' });
    expect(confirmed.updates[0]).toMatchObject({ generatedBy: 'OPENAI_GPT41' });
  });

  it('já assinado, sem anamnese de origem ou inexistente → nem chega a gerar', async () => {
    for (const protocol of [
      protocolRow({ status: 'ACTIVE', approvalStatus: 'HUMAN_APPROVED' }),
      protocolRow({ anamnesisSessionId: null }),
    ]) {
      const { worker, generator, updates } = makeWorker({ protocol });
      await expect(worker.process(job())).resolves.toEqual({ status: 'NOT_PENDING' });
      expect(generator.generate).not.toHaveBeenCalled();
      expect(updates).toHaveLength(0);
    }
    const missing = makeWorker({ protocol: null });
    await expect(missing.worker.process(job())).resolves.toEqual({ status: 'NOT_FOUND' });
  });

  it('consentimento revogado encerra sem ler saúde nem gerar', async () => {
    const { worker, generator, updates } = makeWorker({ consentActive: false });
    await expect(worker.process(job())).resolves.toEqual({ status: 'CONSENT_REVOKED' });
    expect(generator.generate).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });
});
