import { PARQ_QUESTION_IDS, PARQ_VERSION, type ProtocolStructure } from '@movivo/shared';
import type { Job } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { users } from '../../core/database/schema';
import type { HealthCipherService } from '../../core/database/health-cipher.service';
import type { HealthConsentService } from '../../core/database/health-consent.service';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
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

/** Bloco cifrado da anamnese v2: seção 4 (dor), textos livres, PAR-Q e declarações. */
function block2Json(
  painRegion: 'KNEE' | 'SHOULDER' | null = 'KNEE',
  parqYes: Partial<Record<(typeof PARQ_QUESTION_IDS)[number], string | true>> = {},
) {
  return JSON.stringify({
    pain: painRegion
      ? { hasPain: true, trend: 'STABLE', points: [{ region: painRegion, intensity: 5 }] }
      : { hasPain: false, points: [] },
    freeText: {},
    parq: {
      version: PARQ_VERSION,
      answers: PARQ_QUESTION_IDS.map((questionId) => ({
        questionId,
        answer: parqYes[questionId] !== undefined,
        ...(typeof parqYes[questionId] === 'string' ? { detail: parqYes[questionId] } : {}),
      })),
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

function sessionRow(over: Record<string, unknown> = {}) {
  return {
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
      preferredDays: [],
      sessionDuration: 'M45_TO_60',
      location: 'HOME',
      preferredPeriod: 'MORNING',
      practicesOtherSport: false,
      hasAvoidedExercise: false,
    },
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

function verdict(
  action: ValidationVerdict['action'],
  violations: ValidationVerdict['violations'] = [],
): ValidationVerdict {
  const code = action === 'PASS' ? 'PASS' : action === 'BLOCK_FALLBACK' ? 'BLOCK' : 'FLAG';
  return { action, code, humanReviewRequired: action !== 'PASS', violations };
}

interface Deps {
  user?: unknown;
  session?: unknown;
  exists?: boolean;
  action?: ValidationVerdict['action'];
  violations?: ValidationVerdict['violations'];
  alreadyExisted?: boolean;
  consentActive?: boolean;
  /** Respostas "Sim" do PAR-Q; valor string vira o `detail` do follow-up. */
  parqYes?: Partial<Record<(typeof PARQ_QUESTION_IDS)[number], string | true>>;
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
    decryptHealth: vi.fn(() => Promise.resolve(block2Json('KNEE', deps.parqYes ?? {}))),
  } as unknown as HealthCipherService;

  const generator = {
    generate: vi.fn(() => Promise.resolve(genResult)),
  } as unknown as ProtocolGeneratorService;

  const validation = {
    validate: vi.fn(() => verdict(deps.action ?? 'PASS', deps.violations)),
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

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };
  const worker = new ProtocolGenerationWorker(
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
  return { worker, repository, queues, enqueue, generator, workers, workerListeners, logger };
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
  it('encerra job enfileirado antes da revogacao sem ler saude ou gerar', async () => {
    const { worker, generator, repository } = makeWorker({ consentActive: false });
    await expect(worker.process(job())).resolves.toEqual({ status: 'CONSENT_REVOKED' });
    expect(generator.generate).not.toHaveBeenCalled();
    expect(repository.persist).not.toHaveBeenCalled();
  });

  it('caminho limpo (PASS) → também entra em PENDING_REVIEW/OPTIONAL, sem entrega imediata', async () => {
    // Decisão do fundador (2026-08-18): nem PASS entrega sozinho na hora — todo protocolo
    // passa pela Fila do Profissional com janela de cortesia de 1h, PAR-Q à parte.
    const { worker, repository, enqueue, generator } = makeWorker({
      action: 'PASS',
      session: sessionRow({
        dataBlock3: { ...sessionRow().dataBlock3, preferredDays: ['MON', 'WED', 'FRI'] },
      }),
    });
    const res = await worker.process(job());
    expect(res.status).toBe('PENDING_REVIEW');
    // `toConstraints()` repassa os dias reais da anamnese pro gerador (achado 2026-08-18).
    expect(generator.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: expect.objectContaining({ preferredDays: ['MON', 'WED', 'FRI'] }),
      }),
    );
    expect(repository.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        signed: false,
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

  /**
   * Decisão do fundador (2026-08-24): o PAR-Q deixou de ser TRAVA. Antes deste bloco, o
   * caso equivalente esperava `BLOCKED_PENDING_CLEARANCE` sem geração nenhuma; hoje o
   * protocolo é gerado em modo conservador e para de pé na fila até um humano assinar.
   */
  it('PAR-Q bloqueado gera normalmente, mas MANDATORY e SEM auto-liberação agendada', async () => {
    const { worker, generator, repository, enqueue } = makeWorker({
      user: userRow({ requiresProfessionalReview: true }),
      parqYes: { Q1: true },
    });
    const res = await worker.process(job());
    expect(res.status).toBe('PENDING_REVIEW');
    expect(generator.generate).toHaveBeenCalledOnce();
    expect(repository.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewUrgency: 'MANDATORY',
        approvalStatus: 'PENDING_REVIEW',
        humanReviewRequired: true,
        anamnesisSessionId: 's1',
      }),
    );
    // A barreira que importa: MANDATORY nunca agenda `protocol-auto-release`.
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('PAR-Q Q1 (coração) vira tag CARDIAC no gerador e em par_q_flags', async () => {
    const { worker, generator, repository } = makeWorker({
      user: userRow({ requiresProfessionalReview: true }),
      parqYes: { Q1: true },
    });
    await worker.process(job());
    expect(generator.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: expect.objectContaining({
          requiresProfessionalReview: true,
          parqTags: ['CARDIAC'],
          parqTriggered: ['Q1'],
          // Mesclada em `injuryTags` (junto da dor no joelho da fixture): é assim que
          // gerador e validador de fato excluem exercício contraindicado.
          injuryTags: expect.arrayContaining(['KNEE', 'CARDIAC']),
        }),
      }),
    );
    // `parqFlags` guarda SÓ o que veio do PAR-Q — não as tags de dor/lesão (achado
    // 2026-08-24: a coluna recebia `injuryTags`, que é outra coisa).
    expect(repository.persist).toHaveBeenCalledWith(
      expect.objectContaining({ parqFlags: ['CARDIAC'] }),
    );
  });

  it('PAR-Q Q4 (tontura/desmaio) trava a fase em ADAPTACAO e rebaixa o nível', async () => {
    const { worker, generator } = makeWorker({
      user: userRow({ requiresProfessionalReview: true }),
      parqYes: { Q4: true },
    });
    await worker.process(job());
    expect(generator.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: expect.objectContaining({
          parqTags: ['BALANCE_FALL_RISK'],
          maxPhase: 'ADAPTACAO',
          // A fixture declara `experience: 'INTERMEDIATE'` → INTERMEDIARIO, rebaixado.
          level: 'INICIANTE',
        }),
      }),
    );
  });

  it('PAR-Q Q6 sem tag fixa: o detail do follow-up passa pela heurística de texto', async () => {
    const { worker, generator } = makeWorker({
      user: userRow({ requiresProfessionalReview: true }),
      parqYes: { Q6: 'hérnia de disco na lombar' },
    });
    await worker.process(job());
    expect(generator.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: expect.objectContaining({ parqTags: ['LOWER_BACK'] }),
      }),
    );
  });

  it('sem PAR-Q positivo: OPTIONAL, nível preservado, sem tag nem teto de fase', async () => {
    const { worker, generator, repository } = makeWorker({});
    await worker.process(job());
    expect(generator.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: expect.objectContaining({
          requiresProfessionalReview: false,
          parqTags: [],
          parqTriggered: [],
          level: 'INTERMEDIARIO',
        }),
      }),
    );
    const call = (generator.generate as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call.constraints.maxPhase).toBeUndefined();
    expect(repository.persist).toHaveBeenCalledWith(
      expect.objectContaining({ reviewUrgency: 'OPTIONAL', parqFlags: [] }),
    );
  });

  it('idempotência: protocolo já existe → não chama o LLM nem persiste', async () => {
    const { worker, generator, repository } = makeWorker({ exists: true });
    const res = await worker.process(job());
    expect(res.status).toBe('ALREADY_EXISTS');
    expect(generator.generate).not.toHaveBeenCalled();
    expect(repository.persist).not.toHaveBeenCalled();
  });

  it('validador bloqueou (template) → PENDING_REVIEW, sem entrega, mas agenda auto-liberação em 1h', async () => {
    const { worker, enqueue, repository } = makeWorker({ action: 'BLOCK_FALLBACK' });
    const res = await worker.process(job());
    expect(res.status).toBe('PENDING_REVIEW');
    expect(repository.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        signed: false,
        humanReviewRequired: true,
        // OPTIONAL, não MANDATORY (decisão do fundador, 2026-08-18): PAR-Q é o único
        // motivo pra travar sem prazo, e quem chega aqui já passou por esse gate.
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

  it('validador flagou (revisão opcional) → PENDING_REVIEW + agenda auto-liberação em 1h', async () => {
    const { worker, enqueue, repository } = makeWorker({ action: 'FLAG_HUMAN_REVIEW' });
    const res = await worker.process(job());
    expect(res.status).toBe('PENDING_REVIEW');
    expect(repository.persist).toHaveBeenCalledWith(
      expect.objectContaining({ signed: false, reviewUrgency: 'OPTIONAL' }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      'protocol-auto-release',
      'auto-release',
      { userId: 'u1', protocolId: 'p1' },
      { delay: 60 * 60 * 1000, jobId: 'auto-release-p1' },
    );
  });

  it('validador bloqueou: loga o motivo real (achado 2026-08-18 — antes não deixava rastro)', async () => {
    const violations = [
      { rule: 'STRUCTURE', detail: 'exercício fora da base: bogus_id', action: 'BLOCK' as const },
    ];
    const { worker, logger } = makeWorker({ action: 'BLOCK_FALLBACK', violations });
    await worker.process(job());
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        usedFallbackTemplate: true,
        // v1 e v2 usam o mesmo mock — as violações aparecem em dobro (uma por tentativa).
        violations: [...violations, ...violations],
      }),
      'geração de protocolo não passou limpa na validação',
    );
  });

  it('validador não bloqueou: não loga nada sobre violação', async () => {
    const { worker, logger } = makeWorker({ action: 'PASS' });
    await worker.process(job());
    expect(logger.warn).not.toHaveBeenCalled();
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
  it('registra o processor e, na falha terminal, persiste o template pendente', async () => {
    const { worker, workers, workerListeners, enqueue, repository } = makeWorker();
    worker.onModuleInit();
    expect(workers.create).toHaveBeenCalledWith('protocol-generation', expect.any(Function));

    const terminal = { ...job(), attemptsMade: 3 } as Job<ProtocolGenerationJob>;
    workerListeners[0]?.(terminal, new Error('LLM down'));
    await vi.waitFor(() => expect(repository.persist).toHaveBeenCalled());

    // A apresentação da agente ("estou analisando") NÃO é agendada aqui: ela passou a ser
    // agendada no submit do formulário, 30min depois dele, sempre. Agendar de novo daqui
    // duplicaria o job e faria o relógio partir da falha (depois de todos os retries),
    // não do submit.
    expect(enqueue).not.toHaveBeenCalledWith(
      'whatsapp-outbound',
      'protocol-waiting',
      expect.anything(),
      expect.anything(),
    );
    expect(repository.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        humanReviewRequired: true,
        generatedBy: 'FALLBACK_TEMPLATE',
        // OPTIONAL, não MANDATORY (decisão do fundador, 2026-08-18): DLQ é indisponibilidade
        // de infra (LLM fora do ar), não risco clínico — PAR-Q já filtrou antes de chegar
        // aqui, então a mesma janela de cortesia de 1h se aplica.
        reviewUrgency: 'OPTIONAL',
      }),
    );
    // Mesma janela de cortesia de 1h que o caminho normal agenda — antes do achado
    // 2026-08-18 o DLQ nunca agendava auto-liberação nenhuma (era sempre MANDATORY).
    expect(enqueue).toHaveBeenCalledWith(
      'protocol-auto-release',
      'auto-release',
      expect.objectContaining({ userId: 'u1' }),
      expect.objectContaining({ delay: 60 * 60 * 1000 }),
    );
  });

  // Achado 2026-08-18: o fallback de DLQ agora reflete os dias REAIS declarados na
  // anamnese, não 1 sessão genérica — prova que `preferredDays` chega até o template.
  it('fallback de DLQ gera uma sessão por dia real declarado (não mais 1 sessão genérica)', async () => {
    const { worker, workerListeners, repository } = makeWorker({
      session: sessionRow({
        dataBlock3: { ...sessionRow().dataBlock3, preferredDays: ['TUE', 'WED', 'THU'] },
      }),
    });
    worker.onModuleInit();
    const terminal = { ...job(), attemptsMade: 3 } as Job<ProtocolGenerationJob>;
    workerListeners[0]?.(terminal, new Error('LLM down'));
    await vi.waitFor(() => expect(repository.persist).toHaveBeenCalled());

    const call = (repository.persist as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call.content.sessions).toHaveLength(3);
    expect(call.content.sessions.map((s: { weekday?: string }) => s.weekday)).toEqual([
      'TUE',
      'WED',
      'THU',
    ]);
    expect(call.constraints.preferredDays).toEqual(['TUE', 'WED', 'THU']);
  });

  /**
   * Achado 2026-08-24: este caminho fixava `reviewUrgency: 'OPTIONAL'` no braço — correto
   * só enquanto o gate de PAR-Q travava a geração lá em `process()`. Sem o gate, fixar
   * significaria auto-liberar em 1h o treino de um titular com alerta clínico aberto,
   * justamente quando o LLM caiu e ninguém olhou o conteúdo.
   */
  it('DLQ de titular com PAR-Q bloqueado: MANDATORY, sem auto-liberação', async () => {
    const { worker, workerListeners, repository, enqueue } = makeWorker({
      user: userRow({ requiresProfessionalReview: true }),
      parqYes: { Q1: true },
    });
    worker.onModuleInit();
    const terminal = { ...job(), attemptsMade: 3 } as Job<ProtocolGenerationJob>;
    workerListeners[0]?.(terminal, new Error('LLM down'));
    await vi.waitFor(() => expect(repository.persist).toHaveBeenCalled());

    expect(repository.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        generatedBy: 'FALLBACK_TEMPLATE',
        reviewUrgency: 'MANDATORY',
        parqFlags: ['CARDIAC'],
        anamnesisSessionId: 's1',
      }),
    );
    expect(enqueue).not.toHaveBeenCalledWith(
      'protocol-auto-release',
      expect.anything(),
      expect.anything(),
      expect.anything(),
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
