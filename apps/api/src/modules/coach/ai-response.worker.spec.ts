import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildHumanHandoffMessage, DEFAULT_AGENT_PERSONA, type AgentPersona } from '@movivo/shared';

import type { HealthConsentService } from '../../core/database/health-consent.service';
import type { FaqService, PublishedFaqMatch } from '../../core/agent-config/faq.service';
import {
  ForbiddenTopicsUnavailableError,
  type ForbiddenTopicHit,
} from '../../core/agent-config/forbidden-topics.service';
import type {
  L1GuardrailFlag,
  L1GuardrailService,
} from '../../core/agent-config/l1-guardrail.service';
import type { ContextService } from '../ai-coach/context/context.service';
import type { IntentClassifier } from '../ai-coach/intent/intent-classifier.service';
import type { Intent } from '../ai-coach/intent/intent.types';
import type { LlmAbuseGuard } from '../ai-coach/llm/llm-abuse-guard.service';
import type { LlmRouter } from '../ai-coach/llm/llm-router.service';
import type { EvidenceGroundingService } from '../ai-coach/rag/evidence-grounding.service';
import type { QueueManager } from '../jobs/queue-manager.service';
import type { WorkerFactory } from '../jobs/worker.factory';
import { findSafeCandidates, SUBSTITUTION_BATCH_SIZE } from '../protocol/exercise-substitution';
import { ExerciseCatalogProvider } from '../protocol/exercise-catalog-provider.service';
import type { ActiveProtocolForSubstitution } from '../protocol/protocol-substitution.repository';
import { ValidationService } from '../protocol/validation/validation.service';
import type { UserJobLock } from '../whatsapp/user-job-lock';
import type { AiResponseJob } from '../whatsapp/whatsapp-inbound.service';
import { AIResponseWorker } from './ai-response.worker';
import {
  DAILY_LIMIT_MESSAGE,
  DLQ_FALLBACK_MESSAGE,
  FORBIDDEN_TOPIC_RESPONSE,
  SAFETY_HANDOFF_MESSAGE,
  STANDARD_BLOCK_RESPONSE,
  SUBSTITUTION_ALREADY_PENDING_MESSAGE,
  SUBSTITUTION_CATALOG_GAP_MESSAGE,
  SUBSTITUTION_FALLBACK_MESSAGE,
  SUBSTITUTION_NOT_SAFE_TO_APPLY_MESSAGE,
  TECHNICAL_NO_EVIDENCE_MESSAGE,
} from './coach-messages';
import type { ConversationRepository } from './conversation.repository';
import { buildForaDeEscopoResponse, resolvePrompt } from '../ai-coach/intent/prompts';
import type { PromptResolverService } from '../ai-coach/intent/prompt-resolver.service';

const EXERCISE_CATALOG = new ExerciseCatalogProvider().getAll();
const FLEXAO_LOOKUP = EXERCISE_CATALOG.find((ex) => ex.id === 'flexao');
if (!FLEXAO_LOOKUP) throw new Error('fixture: exercício "flexao" ausente do catálogo');
const FLEXAO = FLEXAO_LOOKUP;
/** Candidato seguro real (nunca hardcoded — sempre o que `findSafeCandidates` de fato acha). */
const FLEXAO_CANDIDATE = findSafeCandidates(
  FLEXAO,
  { level: 'INICIANTE', location: 'HOME', equipment: [], injuryTags: [] },
  EXERCISE_CATALOG,
)[0];
if (!FLEXAO_CANDIDATE) throw new Error('fixture: nenhum candidato seguro para "flexao" em HOME');

/**
 * Fixture do bug reproduzido ao vivo (achado 2026-09-08): em `FULL_GYM`, a lista CURADA de
 * `caminhada_de_mala_halter` enche o 1º LOTE de exibição (`SUBSTITUTION_BATCH_SIZE`) sem
 * incluir "Esteira" — que só aparece mais adiante na curadoria completa (mesmo padrão
 * `CARDIO`, sem contraindicação). Achado 2026-09-09: a curadoria em si (`findSafeCandidates`)
 * deixou de ter teto — "capado" agora é só o 1º lote, fatiado pelo worker. Nunca hardcoded: os
 * dois asserts abaixo travam a fixture nesse estado exato caso o catálogo mude.
 */
const CAMALA_LOOKUP = EXERCISE_CATALOG.find((ex) => ex.id === 'caminhada_de_mala_halter');
if (!CAMALA_LOOKUP) throw new Error('fixture: exercício "caminhada_de_mala_halter" ausente do catálogo');
const CAMALA = CAMALA_LOOKUP;
const CAMALA_CONSTRAINTS = {
  level: 'INICIANTE' as const,
  location: 'FULL_GYM' as const,
  equipment: [],
  injuryTags: [],
};
const ESTEIRA_LOOKUP = EXERCISE_CATALOG.find((ex) => ex.id === 'esteira');
if (!ESTEIRA_LOOKUP) throw new Error('fixture: exercício "esteira" ausente do catálogo');
const ESTEIRA = ESTEIRA_LOOKUP;
const CAMALA_FULL_CURATION = findSafeCandidates(CAMALA, CAMALA_CONSTRAINTS, EXERCISE_CATALOG);
if (
  CAMALA_FULL_CURATION.slice(0, SUBSTITUTION_BATCH_SIZE).some((c) => c.id === ESTEIRA.id)
) {
  throw new Error('fixture desatualizada: "esteira" já está no 1º lote de caminhada_de_mala_halter');
}
if (!CAMALA_FULL_CURATION.some((c) => c.id === ESTEIRA.id)) {
  throw new Error('fixture: "esteira" precisa ser um candidato seguro (curadoria completa) de caminhada_de_mala_halter');
}

const DEFAULT_ACTIVE_PROTOCOL: ActiveProtocolForSubstitution = {
  protocolId: 'proto1',
  version: 3,
  content: {
    promptVersion: 'methodology-test',
    goal: 'GAIN_MUSCLE',
    phase: 'ADAPTACAO',
    phaseDurationWeeks: 3,
    weeklyFrequency: 1,
    sessions: [
      {
        dayLabel: 'Dia A',
        focus: 'Peito',
        exercises: [
          {
            exerciseId: FLEXAO.id,
            name: FLEXAO.name,
            sets: 3,
            reps: { min: 8, max: 12 },
            loadStrategy: 'BODYWEIGHT',
            restSeconds: 60,
          },
        ],
      },
    ],
  } as never,
  constraints: { level: 'INICIANTE', location: 'HOME', equipment: [], injuryTags: [] },
  validationConstraints: {
    goal: 'GAIN_MUSCLE',
    injuryTags: [],
    preferredDays: undefined,
    level: 'INICIANTE',
  },
  parQFlags: [],
  fromBlockingParq: false,
};

interface Deps {
  intent?: Intent;
  llmText?: string;
  overLimit?: boolean;
  lockToken?: string | null;
  batchItems?: string[];
  constraints?: unknown;
  safetyHandoff?: boolean;
  consentActive?: boolean;
  faqMatch?: PublishedFaqMatch | null;
  faqUnavailable?: boolean;
  forbiddenHit?: ForbiddenTopicHit | null;
  forbiddenUnavailable?: boolean;
  l1Flags?: L1GuardrailFlag[];
  handoffMessage?: string;
  /** Sprint 11: slot da persona do titular (`null` = titular sem anamnese/coluna). */
  biologicalSex?: 'MALE' | 'FEMALE' | null;
  /** Persona que o slot resolve — o worker a resolve UMA vez e propaga. */
  persona?: AgentPersona;
  ragDocs?: Array<{
    chunkId: string;
    documentId: string | null;
    title: string;
    snippet: string;
    score: number;
  }>;
  /** `EvidenceGroundingService.answer()` status — default `VERIFIED` quando não informado. */
  groundingStatus?: 'VERIFIED' | 'INSUFFICIENT' | 'CONFLICT' | 'UNVERIFIED';
  /** Achado 2026-09-02 (fluxo de substituição via IA) — `undefined` cai no fixture padrão
   * (protocolo ativo com "Flexão"); `null` simula ausência de protocolo ativo. */
  activeProtocol?: ActiveProtocolForSubstitution | null;
  substitutionHasPending?: boolean;
  /** Confirmação de um candidato — default: nada resolvido, cai pra (re)oferta. */
  substitutionResolved?:
    | { resolved: true; chosenExerciseId: string }
    | { resolved: false; rejectedAll?: boolean };
  /** Pedido explícito de substituto NA MESMA mensagem (turno 1) — default: nada resolvido. */
  substitutionExplicitRequest?: { resolved: true; chosenExerciseId: string } | { resolved: false };
  /** Identificação do alvo — default: identifica "flexao" (o único do fixture). */
  substitutionTargetIdentified?: { identified: true; exerciseId: string } | { identified: false };
  substitutionCreateResult?:
    { created: true; id: string } | { created: false; alreadyPending: true };
  /** Achado 2026-09-09 — pedido de exercício fora da curadoria elegível. Default: nada
   * específico pedido (cai no fluxo de lote normal). */
  substitutionCatalogLookupResult?:
    | { requestedName: null; matchedExerciseId: null }
    | { requestedName: string; matchedExerciseId: string | null };
  substitutionCreateCatalogGapResult?:
    { created: true; id: string } | { created: false; alreadyPending: true };
  /** Offset já salvo em Redis pro lote de apresentação (achado 2026-09-09) — default: 0. */
  substitutionBatchOffset?: number;
}

function makeWorker(deps: Deps = {}) {
  const workerListeners: Array<(job: Job | undefined, err: Error) => void> = [];
  const fakeWorker = {
    on: (_e: string, cb: (j: Job | undefined, e: Error) => void) => workerListeners.push(cb),
  };
  const workers = { create: vi.fn(() => fakeWorker) } as unknown as WorkerFactory;

  const enqueue = vi.fn((_q: string, _name: string, _data: unknown, _opts?: unknown) =>
    Promise.resolve('job'),
  );
  const queues = { enqueue } as unknown as QueueManager;

  const lock = {
    acquire: vi.fn(() => Promise.resolve(deps.lockToken === undefined ? 'tok' : deps.lockToken)),
    release: vi.fn(() => Promise.resolve()),
  } as unknown as UserJobLock;

  const classify = vi.fn(() =>
    Promise.resolve({
      intent: deps.intent ?? 'MOTIVACAO',
      confidence: 1,
      stage: 'KNN',
      safetyHandoff: deps.safetyHandoff ?? false,
    }),
  );
  const classifier = { classify } as unknown as IntentClassifier;

  const resolvedPersona: AgentPersona = deps.persona ?? {
    ...DEFAULT_AGENT_PERSONA,
    agentName: 'MOVI',
  };
  // Sprint 11: `persona()` é o ÚNICO ponto de resolução e é chamado uma vez por job; as
  // demais variantes recebem a persona já resolvida.
  const personaResolve = vi.fn(async () => resolvedPersona);
  const prompts = {
    persona: personaResolve,
    resolvePromptFor: vi.fn(async (intent: Intent) => resolvePrompt(intent)),
    resolveRuntimeFor: vi.fn(async (intent: Intent) => ({
      system: resolvePrompt(intent),
      formatting: { blockSize: 'MEDIO', allowLists: true, boldPolicy: 'UMA_PALAVRA' },
    })),
    foraDeEscopoResponseFor: vi.fn((persona: AgentPersona) =>
      buildForaDeEscopoResponse(persona.agentName),
    ),
    humanHandoffMessageFor: vi.fn(
      () => deps.handoffMessage ?? 'Vou registrar para o profissional CREF.',
    ),
  } as unknown as PromptResolverService;

  const faqMatch = vi.fn(async () => {
    if (deps.faqUnavailable) throw new Error('faq offline');
    return deps.faqMatch ?? null;
  });
  const faq = { match: faqMatch } as unknown as FaqService;
  const evaluateForbidden = vi.fn(async () => {
    if (deps.forbiddenUnavailable) throw new ForbiddenTopicsUnavailableError();
    return deps.forbiddenHit ?? null;
  });
  const forbiddenTopics = { evaluate: evaluateForbidden };
  const evaluateL1 = vi.fn(async () => deps.l1Flags ?? []);
  const l1Guardrails = { evaluate: evaluateL1 } as unknown as L1GuardrailService;

  const context = {
    build: vi.fn(() =>
      Promise.resolve({
        authoritativeState: '{"temProtocoloAtivo":true}',
        cacheablePrefix: 'ESTADO',
        volatileSuffix: 'Aluno: oi',
        ragDocs: deps.ragDocs ?? [],
        sessionDate: '2026-07-31',
        scrubUser: {},
      }),
    ),
    recordTurn: vi.fn(() => Promise.resolve()),
    summarizeIfNeeded: vi.fn(() => Promise.resolve()),
  } as unknown as ContextService;

  const complete = vi.fn((_req: { system: string; messages?: unknown[] }) =>
    Promise.resolve({ text: deps.llmText ?? 'Boa, continua firme!', model: 'gpt-4.1' }),
  );
  const llm = { complete } as unknown as LlmRouter;
  const grounding = {
    answer: vi.fn(async () => {
      const status = deps.groundingStatus ?? 'VERIFIED';
      if (status !== 'VERIFIED') return { status, latencyMs: 10 };
      return {
        status: 'VERIFIED' as const,
        text: `${deps.llmText ?? 'Resposta sustentada.'} [E1: Fonte aprovada]`,
        model: 'deepseek-v4-pro',
        verifierModel: 'deepseek-v4-pro',
        latencyMs: 10,
        humanReview: false,
        sources: [],
      };
    }),
  } as unknown as EvidenceGroundingService;

  const abuse = {
    isOverDailyLimit: vi.fn(() => Promise.resolve(deps.overLimit ?? false)),
  } as unknown as LlmAbuseGuard;
  const isOverDailyLimit = abuse.isOverDailyLimit as ReturnType<typeof vi.fn>;

  const validation = new ValidationService();

  const persistTurn = vi.fn(() => Promise.resolve());
  const persistHandoff = vi.fn(() => Promise.resolve());
  const repo = {
    persistTurn,
    persistHandoff,
    loadRuntimeUser: vi.fn(() =>
      Promise.resolve({
        scrubUser: {},
        biologicalSex: deps.biologicalSex === undefined ? 'MALE' : deps.biologicalSex,
      }),
    ),
  } as unknown as ConversationRepository;

  const substitutionHasPending = vi.fn(() => Promise.resolve(deps.substitutionHasPending ?? false));
  const substitutionCreatePending = vi.fn((_input: unknown) =>
    Promise.resolve(deps.substitutionCreateResult ?? { created: true, id: 'sub1' }),
  );
  const substitutionCreateCatalogGapPending = vi.fn((_input: unknown) =>
    Promise.resolve(deps.substitutionCreateCatalogGapResult ?? { created: true, id: 'catgap1' }),
  );
  const substitutionRepo = {
    loadActiveProtocol: vi.fn(() =>
      Promise.resolve(
        deps.activeProtocol === undefined ? DEFAULT_ACTIVE_PROTOCOL : deps.activeProtocol,
      ),
    ),
    hasPending: substitutionHasPending,
    createPending: substitutionCreatePending,
    createCatalogGapPending: substitutionCreateCatalogGapPending,
  } as never;

  const substitutionResolve = vi.fn(() =>
    Promise.resolve(deps.substitutionResolved ?? { resolved: false }),
  );
  const substitutionResolveExplicit = vi.fn(() =>
    Promise.resolve(deps.substitutionExplicitRequest ?? { resolved: false }),
  );
  const substitutionResolution = {
    resolve: substitutionResolve,
    resolveExplicitRequest: substitutionResolveExplicit,
  } as never;

  const substitutionCatalogLookupIdentify = vi.fn(() =>
    Promise.resolve(
      deps.substitutionCatalogLookupResult ?? { requestedName: null, matchedExerciseId: null },
    ),
  );
  const substitutionCatalogLookup = { identify: substitutionCatalogLookupIdentify } as never;

  const substitutionIdentify = vi.fn(() =>
    Promise.resolve(
      deps.substitutionTargetIdentified ?? { identified: true, exerciseId: FLEXAO.id },
    ),
  );
  const substitutionTarget = { identify: substitutionIdentify } as never;

  const queueEventsEmit = vi.fn();
  const queueEvents = { emit: queueEventsEmit } as never;

  const items = deps.batchItems ?? [JSON.stringify({ text: 'oi' })];
  const batchLrange = vi.fn();
  const batchDel = vi.fn();
  const batchExec = vi.fn(() =>
    Promise.resolve([
      [null, items],
      [null, 1],
    ]),
  );
  const batchTransaction = {
    lrange: (key: string, start: number, end: number) => {
      batchLrange(key, start, end);
      return batchTransaction;
    },
    del: (key: string) => {
      batchDel(key);
      return batchTransaction;
    },
    exec: batchExec,
  };
  // Achado 2026-09-09: offset do lote de apresentação em Redis, por (aluno, alvo) — chave
  // constante no mock (`keys.forUser` sempre devolve 'bk'), então um Map simples basta.
  const redisData = new Map<string, string>();
  if (deps.substitutionBatchOffset !== undefined) {
    redisData.set('bk', String(deps.substitutionBatchOffset));
  }
  const redisGet = vi.fn((key: string) => Promise.resolve(redisData.get(key) ?? null));
  const redisSet = vi.fn((key: string, value: string) => {
    redisData.set(key, value);
    return Promise.resolve('OK');
  });
  const redisDel = vi.fn((key: string) => {
    const existed = redisData.delete(key);
    return Promise.resolve(existed ? 1 : 0);
  });
  const redis = {
    multi: vi.fn(() => batchTransaction),
    get: redisGet,
    set: redisSet,
    del: redisDel,
  } as unknown as Redis;
  const keys = { forUser: vi.fn(() => 'bk') };

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() } as never;
  const worker = new AIResponseWorker(
    workers,
    queues,
    lock,
    classifier,
    prompts,
    faq,
    forbiddenTopics as never,
    l1Guardrails,
    context,
    grounding,
    llm,
    abuse,
    validation,
    {
      current: vi.fn(async () => ({
        id: 'methodology-id',
        version: 1,
        versionLabel: 'methodology-v1',
        content: 'conteúdo',
        contentSha256: 'a'.repeat(64),
      })),
    } as never,
    new ExerciseCatalogProvider(),
    repo,
    {
      hasActiveForUser: vi.fn(async () => deps.consentActive ?? true),
    } as unknown as HealthConsentService,
    substitutionRepo,
    substitutionTarget,
    substitutionResolution,
    substitutionCatalogLookup,
    queueEvents,
    redis,
    keys as never,
    logger,
  );
  return {
    worker,
    enqueue,
    complete,
    lock,
    persistTurn,
    persistHandoff,
    workers,
    workerListeners,
    redis,
    classify,
    faqMatch,
    evaluateForbidden,
    evaluateL1,
    isOverDailyLimit,
    batchLrange,
    batchDel,
    prompts,
    personaResolve,
    context,
    grounding,
    substitutionHasPending,
    substitutionCreatePending,
    substitutionCreateCatalogGapPending,
    substitutionResolve,
    substitutionResolveExplicit,
    substitutionIdentify,
    substitutionCatalogLookupIdentify,
    queueEventsEmit,
    redisGet,
    redisSet,
    redisDel,
  };
}

function job(): Job<AiResponseJob> {
  return {
    id: 'j1',
    data: { userId: 'u1', batchKey: 'bk', correlationId: 'c1', enqueuedAt: Date.now() },
    opts: { attempts: 2 },
    attemptsMade: 0,
  } as unknown as Job<AiResponseJob>;
}

type EnqueueCalls = { mock: { calls: unknown[][] } };

/** Texto do COACH_MESSAGE enfileirado (o que MOVI enviou). */
function sentText(enqueue: EnqueueCalls): string | undefined {
  const call = enqueue.mock.calls.find((c) => c[1] === 'coach-message');
  return (call?.[2] as { text?: string } | undefined)?.text;
}

afterEach(() => vi.restoreAllMocks());

describe('AIResponseWorker.process (US-3.5)', () => {
  it('descarta o batch sem persistir ou chamar LLM apos revogacao', async () => {
    const { worker, batchDel, persistTurn, complete } = makeWorker({ consentActive: false });
    await expect(worker.process(job())).resolves.toEqual({ status: 'CONSENT_REVOKED' });
    expect(batchDel).toHaveBeenCalledWith('bk');
    expect(persistTurn).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('motivação: intent→contexto→LLM→validação PASS→envia + "digitando…"', async () => {
    const { worker, enqueue, complete } = makeWorker({ intent: 'MOTIVACAO' });
    const res = await worker.process(job());
    expect(res.status).toBe('SENT');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls.some((c) => c[1] === 'coach-typing')).toBe(true);
    expect(sentText(enqueue)).toBe('Boa, continua firme!');
  });

  it('ignora batchKey adulterada e drena apenas a chave derivada do titular', async () => {
    const { worker, batchLrange } = makeWorker();
    const original = job();
    const forged = {
      ...original,
      data: { ...original.data, batchKey: 'movivo:u:outro:ai-response:batch' },
    } as Job<AiResponseJob>;

    await worker.process(forged);

    expect(batchLrange).toHaveBeenCalledWith('bk', 0, -1);
    expect(batchLrange).not.toHaveBeenCalledWith(forged.data.batchKey, 0, -1);
  });

  it('fora de escopo: recusa honesta SEM chamar o LLM', async () => {
    const { worker, complete, enqueue } = makeWorker({ intent: 'FORA_DE_ESCOPO' });
    await worker.process(job());
    expect(complete).not.toHaveBeenCalled();
    expect(sentText(enqueue)).toBe(buildForaDeEscopoResponse('MOVI'));
  });

  it('FAQ exato responde sem classificador nem LLM', async () => {
    const answer = 'O plano é acompanhado por profissional CREF e entregue no WhatsApp.';
    const { worker, complete, classify, faqMatch, enqueue } = makeWorker({
      batchItems: [JSON.stringify({ text: 'Como recebo meu plano?' })],
      faqMatch: { id: 'faq-1', faqKey: 'delivery', version: 3, answer },
    });
    await expect(worker.process(job())).resolves.toEqual({ status: 'FAQ' });
    expect(faqMatch).toHaveBeenCalledWith('Como recebo meu plano?');
    expect(classify).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(sentText(enqueue)).toBe(answer);
  });

  it('falha do FAQ degrada para classificação sem derrubar a conversa', async () => {
    const { worker, classify, complete } = makeWorker({ faqUnavailable: true });

    await expect(worker.process(job())).resolves.toEqual({ status: 'SENT' });
    expect(classify).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledOnce();
  });

  it('guardrail L1 apenas sinaliza para revisão sem bloquear a resposta', async () => {
    const answer = 'O plano chega pelo WhatsApp com acompanhamento do profissional CREF.';
    const { worker, enqueue, persistHandoff, evaluateL1 } = makeWorker({
      faqMatch: { id: 'faq-1', faqKey: 'delivery', version: 1, answer },
      l1Flags: [{ ruleKey: 'rule-1', label: 'Revisar menção', version: 2 }],
    });

    await expect(worker.process(job())).resolves.toEqual({ status: 'FAQ' });
    expect(evaluateL1).toHaveBeenCalledWith('oi', answer);
    expect(sentText(enqueue)).toBe(answer);
    expect(persistHandoff).toHaveBeenCalledWith('u1', 'ALERT', 'L1_GUARDRAIL_FLAG');
  });

  it('guardrail de segurança roda antes do FAQ', async () => {
    const { worker, faqMatch, classify, persistHandoff } = makeWorker({
      batchItems: [JSON.stringify({ text: 'estou com dor no peito agora' })],
      faqMatch: {
        id: 'faq-1',
        faqKey: 'unsafe',
        version: 1,
        answer: 'Resposta que não pode ser usada.',
      },
    });
    await expect(worker.process(job())).resolves.toEqual({ status: 'SAFETY_HANDOFF' });
    expect(faqMatch).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
    expect(persistHandoff).toHaveBeenCalledWith('u1', 'SAFETY', 'RED_FLAG');
  });

  it('emergência vence o limite diário e não consulta configuração dinâmica', async () => {
    const { worker, enqueue, isOverDailyLimit, evaluateForbidden } = makeWorker({
      overLimit: true,
      batchItems: [JSON.stringify({ text: 'estou com dor no peito agora' })],
    });

    await expect(worker.process(job())).resolves.toEqual({ status: 'SAFETY_HANDOFF' });
    expect(sentText(enqueue)).toBe(SAFETY_HANDOFF_MESSAGE);
    expect(isOverDailyLimit).not.toHaveBeenCalled();
    expect(evaluateForbidden).not.toHaveBeenCalled();
  });

  it('tema proibido aprovado vence FAQ, classificador e LLM', async () => {
    const { worker, enqueue, faqMatch, classify, complete } = makeWorker({
      batchItems: [JSON.stringify({ text: 'quero comparar preços do concorrente' })],
      forbiddenHit: { topicKey: 'concorrentes', label: 'Concorrentes', version: 3 },
      faqMatch: { id: 'faq-1', faqKey: 'unsafe', version: 1, answer: 'não usar' },
    });

    await expect(worker.process(job())).resolves.toEqual({ status: 'FORBIDDEN_TOPIC' });
    expect(sentText(enqueue)).toBe(FORBIDDEN_TOPIC_RESPONSE);
    expect(faqMatch).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('cold start sem configuração fecha a geração e registra handoff operacional', async () => {
    const { worker, enqueue, faqMatch, classify, complete, persistHandoff } = makeWorker({
      forbiddenUnavailable: true,
    });

    await expect(worker.process(job())).resolves.toEqual({ status: 'CONFIG_UNAVAILABLE' });
    expect(sentText(enqueue)).toBe(STANDARD_BLOCK_RESPONSE);
    expect(persistHandoff).toHaveBeenCalledWith('u1', 'ALERT', 'AGENT_CONFIG_UNAVAILABLE');
    expect(faqMatch).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('handoff de segurança (dor grave): persiste SAFETY e NÃO chama o LLM (US-3.6)', async () => {
    const { worker, complete, persistHandoff } = makeWorker({ safetyHandoff: true });
    await worker.process(job());
    expect(complete).not.toHaveBeenCalled();
    expect(persistHandoff).toHaveBeenCalledWith('u1', 'SAFETY', expect.any(String));
  });

  it('fora de escopo também registra alerta assíncrono ao painel (ALERT) (US-3.6)', async () => {
    const { worker, persistHandoff } = makeWorker({ intent: 'FORA_DE_ESCOPO' });
    await worker.process(job());
    expect(persistHandoff).toHaveBeenCalledWith('u1', 'ALERT', expect.any(String));
  });

  it('pedido de handoff usa copy determinística e não chama LLM', async () => {
    const { worker, enqueue, complete, persistHandoff } = makeWorker({ intent: 'PEDIDO_HANDOFF' });
    await expect(worker.process(job())).resolves.toEqual({ status: 'HANDOFF' });
    expect(sentText(enqueue)).toContain('profissional CREF');
    expect(persistHandoff).toHaveBeenCalledWith('u1', 'ALERT', 'PEDIDO_HANDOFF');
    expect(complete).not.toHaveBeenCalled();
  });

  it('pedido de handoff troca copy insegura pelo default compilado', async () => {
    const { worker, enqueue, complete } = makeWorker({
      intent: 'PEDIDO_HANDOFF',
      handoffMessage: 'Prometo responder imediatamente com seu diagnóstico e tratamento.',
    });

    await expect(worker.process(job())).resolves.toEqual({ status: 'HANDOFF' });
    expect(sentText(enqueue)).toBe(buildHumanHandoffMessage(DEFAULT_AGENT_PERSONA));
    expect(complete).not.toHaveBeenCalled();
  });

  // Achado 2026-09-02: motor determinístico de ESCOLHA removido — a IA identifica o alvo
  // (turno 1) e lê a confirmação (turno 2); `findSafeCandidates` continua determinístico e
  // é sempre RECOMPUTADO pelo worker, nunca confiado de uma chamada anterior.
  describe('substituição de exercício via IA (dois turnos, sem motor determinístico)', () => {
    it('turno 1 — identifica o alvo e oferece candidatos seguros da base, sem persistir nada', async () => {
      const { worker, complete, enqueue, substitutionCreatePending } = makeWorker({
        intent: 'SUBSTITUICAO_EXERCICIO',
        batchItems: [JSON.stringify({ text: 'não gosto de fazer flexão, me sinto insegura' })],
        llmText: `Pode ser ${FLEXAO_CANDIDATE.name}, mesmo movimento.`,
      });
      const res = await worker.process(job());
      expect(res.status).toBe('SENT');
      const system = complete.mock.calls[0]?.[0]?.system ?? '';
      expect(system).toContain('OPÇÕES SEGURAS DA BASE');
      expect(system).toContain(FLEXAO_CANDIDATE.name);
      expect(sentText(enqueue)).toContain(FLEXAO_CANDIDATE.name);
      expect(substitutionCreatePending).not.toHaveBeenCalled(); // nada persistido no turno 1
    });

    // Achado 2026-09-08 (bug reproduzido ao vivo pelo fundador): "posso trocar [X] por
    // esteira normal?" nomeia o substituto na MESMA mensagem que pede a troca. Antes desta
    // correção, `findSafeCandidates` capado nunca incluía "Esteira" (a lista curada de
    // "Caminhada de Mala" já enche o teto com 3 outras opções), a resposta do LLM citava
    // "esteira" de volta pro aluno, o `ValidationService` bloqueava por
    // `EXERCISE_NOT_ALLOWED` e a troca nunca chegava na fila de substituição — só um alerta
    // genérico (`VALIDATOR_BLOCK`) sem contexto nenhum.
    it('turno 1 — aluno já nomeia o substituto na mesma mensagem: resolve e persiste direto, sem passar pelo bloqueio do validador', async () => {
      const activeProtocol: ActiveProtocolForSubstitution = {
        ...DEFAULT_ACTIVE_PROTOCOL,
        content: {
          ...DEFAULT_ACTIVE_PROTOCOL.content,
          sessions: [
            {
              dayLabel: 'Dia A',
              focus: 'Cardio',
              exercises: [
                {
                  exerciseId: CAMALA.id,
                  name: CAMALA.name,
                  sets: 1,
                  reps: { min: 1, max: 1 },
                  loadStrategy: 'BODYWEIGHT',
                  restSeconds: 0,
                },
              ],
            },
          ],
        } as never,
        constraints: CAMALA_CONSTRAINTS,
      };
      const {
        worker,
        complete,
        enqueue,
        substitutionCreatePending,
        substitutionResolve,
        persistHandoff,
      } = makeWorker({
        intent: 'SUBSTITUICAO_EXERCICIO',
        activeProtocol,
        substitutionTargetIdentified: { identified: true, exerciseId: CAMALA.id },
        substitutionExplicitRequest: { resolved: true, chosenExerciseId: ESTEIRA.id },
        llmText: `Combinado! Troquei "${CAMALA.name}" por "${ESTEIRA.name}".`,
        batchItems: [
          JSON.stringify({
            text: 'Muito obrigado, mas, não gostei do Caminhada do Mala, posso trocar por esteira normal?',
          }),
        ],
      });
      const res = await worker.process(job());
      expect(res.status).toBe('SENT');
      expect(substitutionCreatePending).toHaveBeenCalledOnce();
      const created = substitutionCreatePending.mock.calls[0]?.[0] as {
        fromExerciseId: string;
        toExerciseId: string;
      };
      expect(created.fromExerciseId).toBe(CAMALA.id);
      expect(created.toExerciseId).toBe(ESTEIRA.id);
      const system = complete.mock.calls[0]?.[0]?.system ?? '';
      expect(system).toContain('CONFIRMADA');
      expect(system).toContain(ESTEIRA.name); // agora está no allowedExercises — não bloqueia
      expect(sentText(enqueue)).not.toBe(STANDARD_BLOCK_RESPONSE);
      expect(persistHandoff).not.toHaveBeenCalledWith(
        expect.anything(),
        'ALERT',
        'VALIDATOR_BLOCK',
      );
      // Turno 2 (`resolve`, contra a lista já capada e oferecida) nem chega a rodar — o
      // pedido explícito já resolveu tudo no turno 1.
      expect(substitutionResolve).not.toHaveBeenCalled();
    });

    it('turno 1 — sem alvo identificável, pergunta qual exercício sem oferecer nada', async () => {
      const { worker, complete } = makeWorker({
        intent: 'SUBSTITUICAO_EXERCICIO',
        batchItems: [JSON.stringify({ text: 'não gostei do treino de hoje' })],
        substitutionTargetIdentified: { identified: false },
      });
      await worker.process(job());
      const system = complete.mock.calls[0]?.[0]?.system ?? '';
      expect(system).toContain('não ficou claro qual exercício');
      expect(system).not.toContain('OPÇÕES SEGURAS DA BASE');
    });

    it('sem protocolo ativo → fallback pré-aprovado, sem LLM', async () => {
      const { worker, complete, enqueue } = makeWorker({
        intent: 'SUBSTITUICAO_EXERCICIO',
        activeProtocol: null,
      });
      await worker.process(job());
      expect(complete).not.toHaveBeenCalled();
      expect(sentText(enqueue)).toBe(SUBSTITUTION_FALLBACK_MESSAGE);
    });

    it('alvo identificado sem nenhum candidato seguro na base → fallback, sem LLM', async () => {
      const { worker, complete, enqueue } = makeWorker({
        intent: 'SUBSTITUICAO_EXERCICIO',
        // Lesões que zeram qualquer candidato do padrão HORIZONTAL_PUSH.
        activeProtocol: {
          ...DEFAULT_ACTIVE_PROTOCOL,
          constraints: {
            ...DEFAULT_ACTIVE_PROTOCOL.constraints,
            injuryTags: ['SHOULDER', 'ELBOW', 'WRIST'],
          },
        },
      });
      await worker.process(job());
      expect(complete).not.toHaveBeenCalled();
      expect(sentText(enqueue)).toBe(SUBSTITUTION_FALLBACK_MESSAGE);
    });

    it('já existe proposta pendente → avisa, sem tentar identificar/oferecer de novo', async () => {
      const { worker, complete, enqueue } = makeWorker({
        intent: 'SUBSTITUICAO_EXERCICIO',
        substitutionHasPending: true,
      });
      await worker.process(job());
      expect(complete).not.toHaveBeenCalled();
      expect(sentText(enqueue)).toBe(SUBSTITUTION_ALREADY_PENDING_MESSAGE);
    });

    it('turno 2 — confirmação de uma opção segura persiste em staging e agenda a liberação', async () => {
      const { worker, complete, enqueue, substitutionCreatePending } = makeWorker({
        intent: 'SUBSTITUICAO_EXERCICIO',
        batchItems: [JSON.stringify({ text: `pode ser ${FLEXAO_CANDIDATE.name} mesmo` })],
        llmText: `Perfeito, vou trocar por ${FLEXAO_CANDIDATE.name}.`,
        substitutionResolved: { resolved: true, chosenExerciseId: FLEXAO_CANDIDATE.id },
      });
      const res = await worker.process(job());
      expect(res.status).toBe('SENT');
      expect(substitutionCreatePending).toHaveBeenCalledOnce();
      const created = substitutionCreatePending.mock.calls[0]?.[0] as {
        fromExerciseId: string;
        toExerciseId: string;
        baseVersion: number;
      };
      expect(created.fromExerciseId).toBe(FLEXAO.id);
      expect(created.toExerciseId).toBe(FLEXAO_CANDIDATE.id);
      expect(created.baseVersion).toBe(DEFAULT_ACTIVE_PROTOCOL.version);
      const system = complete.mock.calls[0]?.[0]?.system ?? '';
      expect(system).toContain('CONFIRMADA');
      expect(sentText(enqueue)).toContain(FLEXAO_CANDIDATE.name);
    });

    it('turno 2 — enfileira a liberação automática com a janela de 30 min e emite o evento da fila', async () => {
      const { worker, enqueue, queueEventsEmit } = makeWorker({
        intent: 'SUBSTITUICAO_EXERCICIO',
        substitutionResolved: { resolved: true, chosenExerciseId: FLEXAO_CANDIDATE.id },
      });
      await worker.process(job());
      const releaseCall = enqueue.mock.calls.find((c) => c[0] === 'protocol-substitution-release');
      expect(releaseCall).toBeDefined();
      expect((releaseCall?.[3] as { delay?: number } | undefined)?.delay).toBe(30 * 60 * 1000);
      expect(queueEventsEmit).toHaveBeenCalledWith('protocol');
    });

    it('turno 2 — origem em PAR-Q bloqueante: persiste mas NÃO agenda liberação automática', async () => {
      const { worker, enqueue, queueEventsEmit, substitutionCreatePending } = makeWorker({
        intent: 'SUBSTITUICAO_EXERCICIO',
        substitutionResolved: { resolved: true, chosenExerciseId: FLEXAO_CANDIDATE.id },
        activeProtocol: { ...DEFAULT_ACTIVE_PROTOCOL, fromBlockingParq: true },
      });
      await worker.process(job());
      expect(substitutionCreatePending).toHaveBeenCalledOnce();
      const releaseCall = enqueue.mock.calls.find((c) => c[0] === 'protocol-substitution-release');
      expect(releaseCall).toBeUndefined();
      // A fila do RT ainda precisa ser avisada — só o job de auto-liberação some.
      expect(queueEventsEmit).toHaveBeenCalledWith('protocol');
    });

    it('turno 2 — escolha fora do conjunto seguro recém-recomputado cai pro fluxo de oferta, não persiste', async () => {
      const { worker, substitutionCreatePending, complete } = makeWorker({
        intent: 'SUBSTITUICAO_EXERCICIO',
        llmText: `Que tal ${FLEXAO_CANDIDATE.name}?`,
        // Defesa em profundidade: mesmo que a resolução afirme um id, o worker SEMPRE
        // recomputa `findSafeCandidates` do zero antes de aceitar — um id real mas fora do
        // padrão/segurança de "flexao" (ex.: um agachamento) nunca deve ser aceito só porque
        // a resolução (mockada aqui) devolveu ele.
        substitutionResolved: { resolved: true, chosenExerciseId: 'agachamento_barra' },
      });
      await worker.process(job());
      expect(substitutionCreatePending).not.toHaveBeenCalled();
      const system = complete.mock.calls[0]?.[0]?.system ?? '';
      expect(system).toContain('OPÇÕES SEGURAS DA BASE'); // reofereceu, não inventou a troca
    });

    // Achado 2026-09-09 (pedido do fundador, "supino reto máquina"): o aluno insiste num
    // exercício que não existe em NENHUM lugar do catálogo. Antes disso (achado 2026-09-08),
    // caía num caminho generativo livre e a IA chegava a dizer "vou registrar/encaminhar pro
    // profissional" sem que NENHUM registro real fosse criado. Agora vira uma proposta REAL
    // em `protocol_substitution_requests` (Revisão Obrigatória, `catalogGap: true`), visível
    // na Fila do Profissional de verdade — resposta FIXA, sem LLM.
    it('aluno pede exercício que não existe no catálogo: cria proposta catalogGap MANDATORY, sem LLM', async () => {
      const { worker, complete, enqueue, substitutionCreateCatalogGapPending, queueEventsEmit } =
        makeWorker({
          intent: 'SUBSTITUICAO_EXERCICIO',
          batchItems: [
            JSON.stringify({ text: 'Nenhuma, queria o supino reto na máquina mesmo' }),
          ],
          substitutionResolved: { resolved: false, rejectedAll: true },
          substitutionCatalogLookupResult: {
            requestedName: 'supino reto na máquina',
            matchedExerciseId: null,
          },
        });
      const res = await worker.process(job());
      expect(res.status).toBe('SENT');
      expect(complete).not.toHaveBeenCalled(); // resposta fixa, não gerada
      expect(substitutionCreateCatalogGapPending).toHaveBeenCalledOnce();
      const created = substitutionCreateCatalogGapPending.mock.calls[0]?.[0] as {
        fromExerciseId: string;
        requestedExerciseName: string;
      };
      expect(created.fromExerciseId).toBe(FLEXAO.id);
      expect(created.requestedExerciseName).toBe('supino reto na máquina');
      expect(sentText(enqueue)).toBe(SUBSTITUTION_CATALOG_GAP_MESSAGE);
      expect(queueEventsEmit).toHaveBeenCalledWith('protocol');
    });

    // Achado 2026-09-09 (bug reportado pelo fundador, conversa real: "Supino Reto (Máquina)"
    // → "Remada Curvada" foi registrado como Revisão Obrigatória, como se fosse uma dúvida
    // clínica legítima — a IA chegou a sugerir depois um exercício de OUTRO grupo muscular
    // como alternativa). `agachamento_barra` (SQUAT, pernas) não tem nexo fisiológico nenhum
    // como substituto de "flexao" (HORIZONTAL_PUSH, peito) — a IA agora orienta na hora, sem
    // criar NENHUMA pendência na fila do profissional, e reoferece a curadoria segura real.
    it('aluno pede exercício que existe no catálogo mas não tem nexo fisiológico (grupo muscular/padrão diferente): orienta na hora, sem registrar na fila', async () => {
      const { worker, complete, enqueue, substitutionCreatePending, redisDel } = makeWorker({
        intent: 'SUBSTITUICAO_EXERCICIO',
        batchItems: [JSON.stringify({ text: 'Nenhuma, quero o agachamento com barra mesmo' })],
        substitutionResolved: { resolved: false, rejectedAll: true },
        substitutionCatalogLookupResult: {
          requestedName: 'agachamento com barra',
          matchedExerciseId: 'agachamento_barra',
        },
      });
      const res = await worker.process(job());
      expect(res.status).toBe('SENT');
      expect(substitutionCreatePending).not.toHaveBeenCalled(); // nada registrado na fila
      const system = complete.mock.calls[0]?.[0]?.system ?? '';
      expect(system).toContain('não é possível');
      expect(system).toContain('Agachamento (Barra)');
      expect(system).toContain('OPÇÕES SEGURAS DA BASE');
      expect(system).toContain(FLEXAO_CANDIDATE.name);
      expect(sentText(enqueue)).not.toBe(SUBSTITUTION_NOT_SAFE_TO_APPLY_MESSAGE);
      expect(redisDel).toHaveBeenCalled(); // limpa o offset do lote deste alvo
    });

    // Contraste do teste acima: `supino_sentado_maquina` É plausível pra "flexao" (mesmo
    // padrão HORIZONTAL_PUSH, mesmo grupo muscular "peito") — só não é elegível pra ESTE
    // aluno porque exige `FULL_GYM` e o protocolo dele é `HOME`. Essa É uma dúvida clínica
    // real (pode fazer sentido liberar se as condições do aluno mudarem) — continua indo
    // pra Revisão Obrigatória de verdade (`reviewUrgency: MANDATORY`), sem auto-liberação e
    // sem a IA dizer "confirmada" antes da revisão real.
    it('aluno pede exercício plausível (mesmo padrão/grupo muscular) mas inelegível por local: persiste MANDATORY, sem auto-liberação, sem "confirmada"', async () => {
      const { worker, complete, enqueue, substitutionCreatePending, redisDel } = makeWorker({
        intent: 'SUBSTITUICAO_EXERCICIO',
        batchItems: [JSON.stringify({ text: 'Nenhuma, quero o supino sentado na máquina mesmo' })],
        substitutionResolved: { resolved: false, rejectedAll: true },
        substitutionCatalogLookupResult: {
          requestedName: 'supino sentado na máquina',
          matchedExerciseId: 'supino_sentado_maquina',
        },
      });
      const res = await worker.process(job());
      expect(res.status).toBe('SENT');
      expect(complete).not.toHaveBeenCalled(); // resposta fixa, não gerada
      expect(substitutionCreatePending).toHaveBeenCalledOnce();
      const created = substitutionCreatePending.mock.calls[0]?.[0] as {
        toExerciseId: string;
        reviewUrgency: string;
      };
      expect(created.toExerciseId).toBe('supino_sentado_maquina');
      expect(created.reviewUrgency).toBe('MANDATORY');
      expect(sentText(enqueue)).toBe(SUBSTITUTION_NOT_SAFE_TO_APPLY_MESSAGE);
      expect(redisDel).toHaveBeenCalled(); // limpa o offset do lote deste alvo
    });

    // Achado 2026-09-09 (pedido do fundador): "curadoria ilimitada, apresentação em blocos de
    // 3" — se ainda há candidatos elegíveis não apresentados, uma rejeição explícita avança
    // pro PRÓXIMO lote (não cai direto no fallback genérico).
    it('lote rejeitado com mais candidatos elegíveis disponíveis: oferece o PRÓXIMO lote de 3', async () => {
      const activeProtocol: ActiveProtocolForSubstitution = {
        ...DEFAULT_ACTIVE_PROTOCOL,
        content: {
          ...DEFAULT_ACTIVE_PROTOCOL.content,
          sessions: [
            {
              dayLabel: 'Dia A',
              focus: 'Cardio',
              exercises: [
                {
                  exerciseId: CAMALA.id,
                  name: CAMALA.name,
                  sets: 1,
                  reps: { min: 1, max: 1 },
                  loadStrategy: 'BODYWEIGHT',
                  restSeconds: 0,
                },
              ],
            },
          ],
        } as never,
        constraints: CAMALA_CONSTRAINTS,
      };
      const { worker, complete, redisSet } = makeWorker({
        intent: 'SUBSTITUICAO_EXERCICIO',
        activeProtocol,
        substitutionTargetIdentified: { identified: true, exerciseId: CAMALA.id },
        substitutionResolved: { resolved: false, rejectedAll: true },
        substitutionBatchOffset: 0,
      });
      await worker.process(job());
      const system = complete.mock.calls[0]?.[0]?.system ?? '';
      // O 2º lote (offset 3) nomeia candidatos que NÃO estavam no 1º lote (offset 0..2).
      const firstBatchNames = CAMALA_FULL_CURATION.slice(0, SUBSTITUTION_BATCH_SIZE).map(
        (c) => c.name,
      );
      const secondBatchNames = CAMALA_FULL_CURATION.slice(
        SUBSTITUTION_BATCH_SIZE,
        SUBSTITUTION_BATCH_SIZE * 2,
      ).map((c) => c.name);
      expect(system).toContain('OPÇÕES SEGURAS DA BASE');
      for (const name of secondBatchNames) expect(system).toContain(name);
      for (const name of firstBatchNames) expect(system).not.toContain(name);
      expect(redisSet).toHaveBeenCalledWith(
        'bk',
        String(SUBSTITUTION_BATCH_SIZE),
        'EX',
        expect.any(Number),
      );
    });

    // Achado 2026-09-09: quando a curadoria inteira já foi oferecida (nenhum lote sobrando) e
    // o aluno ainda não escolheu nem pediu nada específico, cai no fallback honesto de sempre
    // — não fica repetindo o último lote pra sempre.
    it('lote rejeitado e curadoria esgotada: cai no fallback honesto, sem LLM', async () => {
      const activeProtocol: ActiveProtocolForSubstitution = {
        ...DEFAULT_ACTIVE_PROTOCOL,
        content: {
          ...DEFAULT_ACTIVE_PROTOCOL.content,
          sessions: [
            {
              dayLabel: 'Dia A',
              focus: 'Cardio',
              exercises: [
                {
                  exerciseId: CAMALA.id,
                  name: CAMALA.name,
                  sets: 1,
                  reps: { min: 1, max: 1 },
                  loadStrategy: 'BODYWEIGHT',
                  restSeconds: 0,
                },
              ],
            },
          ],
        } as never,
        constraints: CAMALA_CONSTRAINTS,
      };
      const lastOffset =
        Math.floor((CAMALA_FULL_CURATION.length - 1) / SUBSTITUTION_BATCH_SIZE) *
        SUBSTITUTION_BATCH_SIZE;
      const { worker, complete, enqueue, redisDel } = makeWorker({
        intent: 'SUBSTITUICAO_EXERCICIO',
        activeProtocol,
        substitutionTargetIdentified: { identified: true, exerciseId: CAMALA.id },
        substitutionResolved: { resolved: false, rejectedAll: true },
        substitutionBatchOffset: lastOffset,
      });
      const res = await worker.process(job());
      expect(res.status).toBe('SENT');
      expect(complete).not.toHaveBeenCalled();
      expect(sentText(enqueue)).toBe(SUBSTITUTION_FALLBACK_MESSAGE);
      expect(redisDel).toHaveBeenCalled();
    });

    it('troca confirmada que quebraria a validação do protocolo inteiro não é aplicada sozinha', async () => {
      const { worker, complete, enqueue, substitutionCreatePending } = makeWorker({
        intent: 'SUBSTITUICAO_EXERCICIO',
        substitutionResolved: { resolved: true, chosenExerciseId: FLEXAO_CANDIDATE.id },
        // Decisão do fundador (2026-09-04): faixa de reps por objetivo não bloqueia mais
        // (removida do `ValidationService` — ver validation-rules.ts). Força BLOCK
        // determinístico por outra regra que continua existindo: duração de mesociclo
        // fora da faixa de evidência da fase (`PHASE_DURATION_OUT_OF_RANGE`), sem relação
        // nenhuma com o exercício sendo trocado — o que importa aqui é só provar que UM
        // BLOCK qualquer no protocolo inteiro impede a troca de ser aplicada sozinha.
        activeProtocol: {
          ...DEFAULT_ACTIVE_PROTOCOL,
          content: {
            ...DEFAULT_ACTIVE_PROTOCOL.content,
            phaseDurationWeeks: 1, // ADAPTACAO exige 2-4 semanas
          } as never,
        },
      });
      await worker.process(job());
      expect(complete).not.toHaveBeenCalled();
      expect(substitutionCreatePending).not.toHaveBeenCalled();
      expect(sentText(enqueue)).toBe(SUBSTITUTION_NOT_SAFE_TO_APPLY_MESSAGE);
    });

    it('corrida na criação (já existe pendência) → avisa em vez de falhar', async () => {
      const { worker, enqueue } = makeWorker({
        intent: 'SUBSTITUICAO_EXERCICIO',
        substitutionResolved: { resolved: true, chosenExerciseId: FLEXAO_CANDIDATE.id },
        substitutionCreateResult: { created: false, alreadyPending: true },
      });
      await worker.process(job());
      expect(sentText(enqueue)).toBe(SUBSTITUTION_ALREADY_PENDING_MESSAGE);
    });
  });

  it('BLOCK do validador → resposta-padrão + status BLOCKED', async () => {
    const { worker, enqueue } = makeWorker({
      intent: 'MOTIVACAO',
      llmText: 'Toma um ibuprofeno que resolve.',
    });
    const res = await worker.process(job());
    expect(res.status).toBe('BLOCKED');
    expect(sentText(enqueue)).toBe(STANDARD_BLOCK_RESPONSE);
  });

  // Achado 2026-09-02 (correção do fundador): a MOVIVO é uma proposta CONVERSACIONAL — a
  // ausência de referência na Base de Conhecimento deixou de ser recusa automática (o
  // agente virava um FAQ que só repetia o que estava cadastrado). Sem evidência, o coach
  // agora responde com conhecimento geral de educação física (mesmo caminho generativo dos
  // outros intents, com uma instrução extra de responsabilidade), sinalizado para
  // acompanhamento assíncrono do profissional CREF — mas SEM travar a entrega.
  it('dúvida técnica sem evidência responde com conhecimento geral (não trava mais no FAQ)', async () => {
    const { worker, enqueue, complete, persistHandoff } = makeWorker({
      intent: 'DUVIDA_TECNICA',
      ragDocs: [],
    });
    await expect(worker.process(job())).resolves.toEqual({ status: 'SENT' });
    expect(sentText(enqueue)).toBe('Boa, continua firme!');
    expect(complete).toHaveBeenCalledOnce();
    // Instrução extra de responsabilidade chega ao modelo mesmo sem base de conhecimento.
    expect(complete.mock.calls[0]?.[0]?.system).toContain('conhecimento amplamente aceito');
    expect(persistHandoff).toHaveBeenCalledWith('u1', 'ALERT', 'VALIDATOR_FLAG');
  });

  // A abstenção com o texto pré-aprovado (`TECHNICAL_NO_EVIDENCE_MESSAGE`) continua existindo,
  // só que restrita a CONFLICT: a base recuperada contradiz o ESTADO_AUTORITATIVO do próprio
  // aluno (ex.: uma restrição de PAR-Q/lesão) — aí a IA responder por conta própria ignoraria
  // uma restrição de segurança já registrada, e isso vale mais que soar natural.
  it('dúvida técnica com CONFLITO entre a base e o estado do aluno continua abstendo', async () => {
    const { worker, enqueue, complete, persistHandoff } = makeWorker({
      intent: 'DUVIDA_TECNICA',
      ragDocs: [
        {
          chunkId: 'c1',
          documentId: 'd1',
          title: 'Metodologia aprovada',
          snippet: 'Recomenda-se sobrecarga progressiva sem restrição.',
          score: 0.9,
        },
      ],
      groundingStatus: 'CONFLICT',
    });
    await expect(worker.process(job())).resolves.toEqual({ status: 'SENT' });
    expect(sentText(enqueue)).toBe(TECHNICAL_NO_EVIDENCE_MESSAGE);
    expect(complete).not.toHaveBeenCalled();
    expect(persistHandoff).toHaveBeenCalledWith('u1', 'ALERT', 'VALIDATOR_FLAG');
  });

  // Havia base pra tentar fundamentar, mas a verificação de entailment não sustentou a
  // alegação (`UNVERIFIED`) — mesmo destino de `INSUFFICIENT`: cai pro conhecimento geral em
  // vez de recusar, porque não é um CONFLITO com o estado do aluno, só falta de sustentação.
  it('dúvida técnica com evidência insuficiente pra sustentar a alegação (UNVERIFIED) também cai pro conhecimento geral', async () => {
    const { worker, enqueue, grounding, complete } = makeWorker({
      intent: 'DUVIDA_TECNICA',
      ragDocs: [
        {
          chunkId: 'c1',
          documentId: 'd1',
          title: 'Metodologia aprovada',
          snippet: 'Trecho que não cobre a pergunta específica do aluno.',
          score: 0.4,
        },
      ],
      groundingStatus: 'UNVERIFIED',
    });
    await expect(worker.process(job())).resolves.toEqual({ status: 'SENT' });
    expect(grounding.answer).toHaveBeenCalledOnce();
    expect(sentText(enqueue)).toBe('Boa, continua firme!');
    expect(complete).toHaveBeenCalledOnce();
  });

  it('dúvida técnica com evidência usa grounding, não o caminho generativo livre', async () => {
    const { worker, enqueue, grounding, complete } = makeWorker({
      intent: 'DUVIDA_TECNICA',
      ragDocs: [
        {
          chunkId: 'c1',
          documentId: 'd1',
          title: 'Metodologia aprovada',
          snippet: 'O descanso recomendado está definido na metodologia.',
          score: 0.9,
        },
      ],
    });

    await expect(worker.process(job())).resolves.toEqual({ status: 'SENT' });
    expect(grounding.answer).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'c1',
        authoritativeState: '{"temProtocoloAtivo":true}',
        documents: [expect.objectContaining({ chunkId: 'c1' })],
      }),
    );
    expect(complete).not.toHaveBeenCalled();
    expect(sentText(enqueue)).toContain('[E1: Fonte aprovada]');
  });

  // Achado 2026-09-02 (correção do fundador): esta era a única saída generativa que
  // devolvia o texto do modelo sem passar por `applyResponseFormatting` — travessão que
  // escapasse do prompt chegava intacto ao aluno. Agora passa pelo mesmo teto determinístico
  // do caminho ungrounded.
  it('dúvida técnica com evidência também passa pelo teto determinístico (travessão vira vírgula)', async () => {
    const { worker, enqueue } = makeWorker({
      intent: 'DUVIDA_TECNICA',
      llmText: 'A barra dá mais carga — o halter dá mais amplitude',
      ragDocs: [
        {
          chunkId: 'c1',
          documentId: 'd1',
          title: 'Metodologia aprovada',
          snippet: 'O descanso recomendado está definido na metodologia.',
          score: 0.9,
        },
      ],
    });

    await expect(worker.process(job())).resolves.toEqual({ status: 'SENT' });
    expect(sentText(enqueue)).toBe(
      'A barra dá mais carga, o halter dá mais amplitude [E1: Fonte aprovada]',
    );
    expect(sentText(enqueue)).not.toContain('—');
  });

  it('valida a saída bruta antes de truncar parágrafos', async () => {
    const { worker, enqueue } = makeWorker({
      intent: 'MOTIVACAO',
      llmText: 'Continue firme.\n\nRespire e faça o próximo passo.\n\nTome ibuprofeno.',
    });
    await expect(worker.process(job())).resolves.toEqual({ status: 'BLOCKED' });
    expect(sentText(enqueue)).toBe(STANDARD_BLOCK_RESPONSE);
  });

  it('51ª msg/dia: aviso de limite SEM custo de LLM', async () => {
    const { worker, complete, enqueue } = makeWorker({ overLimit: true });
    const res = await worker.process(job());
    expect(res.status).toBe('LIMIT');
    expect(complete).not.toHaveBeenCalled();
    expect(sentText(enqueue)).toBe(DAILY_LIMIT_MESSAGE);
  });

  it('lock ocupado → não processa', async () => {
    const { worker, complete } = makeWorker({ lockToken: null });
    const res = await worker.process(job());
    expect(res.status).toBe('LOCKED');
    expect(complete).not.toHaveBeenCalled();
  });

  it('batch vazio → EMPTY após adquirir e liberar o lock', async () => {
    const { worker, lock } = makeWorker({ batchItems: [] });
    const res = await worker.process(job());
    expect(res.status).toBe('EMPTY');
    expect(lock.acquire).toHaveBeenCalledWith('u1');
    expect(lock.release).toHaveBeenCalledWith('u1', 'tok');
  });

  // `job.attemptsMade` só é incrementado pelo BullMQ DEPOIS que o processor retorna/lança
  // (`Job.moveToCompleted`/`moveToFailed`, dist/cjs/classes/job.js) — na 1ª chamada real o
  // valor é `0`, não `1`. `job()` já devolve `attemptsMade: 0` por padrão (1ª tentativa).
  it('batch vazio na 1ª tentativa não avisa o aluno (coalescimento normal de triggers)', async () => {
    const { worker, enqueue } = makeWorker({ batchItems: [] });
    const res = await worker.process(job());
    expect(res.status).toBe('EMPTY');
    expect(sentText(enqueue)).toBeUndefined();
  });

  // Achado 2026-09-02 (reproduzido ao vivo — aluno viu "digitando…" e depois silêncio
  // permanente; e reproduzido de novo depois do fix, com um bug de off-by-one na 1ª
  // versão): uma 1ª tentativa que drena a mensagem e trava DEPOIS disso (embedding/LLM
  // indisponível) faz o BullMQ retentar; a retry acha o lote já vazio e "termina com
  // sucesso" sem nunca responder, e o handler de DLQ nunca dispara (BullMQ não vê isso como
  // falha). Na 2ª chamada (a retry em si) `job.attemptsMade` já é `1` — ainda não foi
  // incrementado pra esta tentativa em curso —, então `> 0` (não `> 1`) é o teste certo pra
  // "já houve uma tentativa anterior".
  it('batch vazio numa RETRY avisa o aluno (tentativa anterior perdeu a mensagem após travar)', async () => {
    const { worker, enqueue } = makeWorker({ batchItems: [] });
    const res = await worker.process({ ...job(), attemptsMade: 1 } as Job<AiResponseJob>);
    expect(res.status).toBe('EMPTY');
    expect(sentText(enqueue)).toBe(DLQ_FALLBACK_MESSAGE);
  });
});

/* ------------------------------------------------------------------------- *
 * Sprint 11 — persona por slot dentro do job
 * ------------------------------------------------------------------------- */

/** Shape do turno persistido — o mock de `persistTurn` não carrega tipo de argumento. */
interface PersistedTurn {
  direction: string;
  content: string;
}

describe('AIResponseWorker — persona por titular (Sprint 11)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('resolve a persona UMA vez por job e propaga o objeto para todos os pontos', async () => {
    const { worker, personaResolve, prompts, context } = makeWorker({ intent: 'MOTIVACAO' });

    await worker.process(job());

    // Uma resolução por job — é isso que impede que uma publicação no meio do job faça a
    // mesma resposta sair com duas versões da persona.
    expect(personaResolve).toHaveBeenCalledTimes(1);
    expect(personaResolve).toHaveBeenCalledWith('MALE');
    // E os consumidores recebem a persona/nome já resolvidos, sem resolver de novo.
    const persona = await personaResolve.mock.results[0]?.value;
    expect(prompts.resolveRuntimeFor).toHaveBeenCalledWith('MOTIVACAO', persona);
    expect(context.build).toHaveBeenCalledWith('u1', 'MOTIVACAO', 'oi', 'MOVI');
    expect(context.summarizeIfNeeded).toHaveBeenCalledWith('u1', 'MOVI');
  });

  it('titular com `biological_sex` NULL não derruba a mensagem — resolve com null', async () => {
    const { worker, personaResolve, enqueue } = makeWorker({
      biologicalSex: null,
      intent: 'MOTIVACAO',
    });

    const res = await worker.process(job());

    expect(res.status).toBe('SENT');
    expect(personaResolve).toHaveBeenCalledWith(null);
    expect((enqueue as EnqueueCalls).mock.calls.some((c) => c[1] === 'coach-message')).toBe(true);
  });

  it('a persona resolvida assina a recusa de fora-de-escopo do titular', async () => {
    const { worker, persistTurn } = makeWorker({
      intent: 'FORA_DE_ESCOPO',
      biologicalSex: 'FEMALE',
      persona: { ...DEFAULT_AGENT_PERSONA, agentName: 'Marina' },
    });

    await worker.process(job());

    const outbound = (persistTurn.mock.calls as unknown as Array<[PersistedTurn]>)
      .map(([input]) => input)
      .find((input) => input.direction === 'OUTBOUND');
    expect(outbound?.content).toContain('Marina');
  });

  it('o slot vai para a telemetria de token do LlmRouter', async () => {
    const { worker, complete } = makeWorker({ intent: 'MOTIVACAO', biologicalSex: 'FEMALE' });
    await worker.process(job());
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ personaSlot: 'FEMALE' }));
  });
});

describe('AIResponseWorker DLQ (US-3.5)', () => {
  it('falha terminal → fallback "já te respondo"', async () => {
    const { worker, workers, workerListeners, enqueue } = makeWorker();
    worker.onModuleInit();
    expect(workers.create).toHaveBeenCalledWith('ai-response', expect.any(Function));
    const terminal = { ...job(), attemptsMade: 2 } as Job<AiResponseJob>;
    workerListeners[0]?.(terminal, new Error('LLM down'));
    await vi.waitFor(() =>
      expect((enqueue as EnqueueCalls).mock.calls.some((c) => c[1] === 'coach-message')).toBe(true),
    );
  });
});
