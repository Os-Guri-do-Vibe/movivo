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
import { ValidationService } from '../protocol/validation/validation.service';
import type { UserJobLock } from '../whatsapp/user-job-lock';
import type { AiResponseJob } from '../whatsapp/whatsapp-inbound.service';
import { AIResponseWorker } from './ai-response.worker';
import {
  DAILY_LIMIT_MESSAGE,
  FORBIDDEN_TOPIC_RESPONSE,
  SAFETY_HANDOFF_MESSAGE,
  STANDARD_BLOCK_RESPONSE,
  SUBSTITUTION_FALLBACK_MESSAGE,
  TECHNICAL_NO_EVIDENCE_MESSAGE,
} from './coach-messages';
import type { ConversationRepository } from './conversation.repository';
import { buildForaDeEscopoResponse, resolvePrompt } from '../ai-coach/intent/prompts';
import type { PromptResolverService } from '../ai-coach/intent/prompt-resolver.service';

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
  methodologySummary?: string | null;
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
    answer: vi.fn(async () => ({
      status: 'VERIFIED' as const,
      text: `${deps.llmText ?? 'Resposta sustentada.'} [E1: Fonte aprovada]`,
      model: 'deepseek-v4-pro',
      verifierModel: 'deepseek-v4-pro',
      latencyMs: 10,
      humanReview: false,
      sources: [],
    })),
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
    loadConstraints: vi.fn(() =>
      Promise.resolve(
        deps.constraints === undefined
          ? { level: 'INICIANTE', location: 'HOME', equipment: [], injuryTags: [] }
          : deps.constraints,
      ),
    ),
  } as unknown as ConversationRepository;

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
  const redis = {
    multi: vi.fn(() => batchTransaction),
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
        summary: deps.methodologySummary ?? null,
        contentSha256: 'a'.repeat(64),
      })),
    } as never,
    repo,
    {
      hasActiveForUser: vi.fn(async () => deps.consentActive ?? true),
    } as unknown as HealthConsentService,
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

  it('substituição: verbaliza o substituto da base (prompt injeta o aprovado)', async () => {
    const { worker, complete, enqueue } = makeWorker({
      intent: 'SUBSTITUICAO_EXERCICIO',
      batchItems: [JSON.stringify({ text: 'quero trocar a Flexão de braço' })],
      llmText: 'Pode trocar por Flexão de joelhos, mesmo movimento.',
    });
    const res = await worker.process(job());
    expect(res.status).toBe('SENT');
    const system = complete.mock.calls[0]?.[0]?.system ?? '';
    expect(system).toContain('SUBSTITUTO APROVADO DA BASE');
    expect(sentText(enqueue)).toContain('Flexão de joelhos');
  });

  it('substituição sem base viável → fallback pré-aprovado, sem LLM', async () => {
    const { worker, complete, enqueue } = makeWorker({
      intent: 'SUBSTITUICAO_EXERCICIO',
      batchItems: [JSON.stringify({ text: 'to sem ideia do que fazer' })],
    });
    await worker.process(job());
    expect(complete).not.toHaveBeenCalled();
    expect(sentText(enqueue)).toBe(SUBSTITUTION_FALLBACK_MESSAGE);
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

  it('dúvida técnica sem evidência se abstém antes do LLM', async () => {
    const { worker, enqueue, complete, persistHandoff } = makeWorker({
      intent: 'DUVIDA_TECNICA',
      methodologySummary: 'Método aprovado, mas sem resposta específica para esta dúvida.',
      ragDocs: [],
    });
    await expect(worker.process(job())).resolves.toEqual({ status: 'SENT' });
    expect(sentText(enqueue)).toBe(TECHNICAL_NO_EVIDENCE_MESSAGE);
    expect(complete).not.toHaveBeenCalled();
    expect(persistHandoff).toHaveBeenCalledWith('u1', 'ALERT', 'VALIDATOR_FLAG');
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
