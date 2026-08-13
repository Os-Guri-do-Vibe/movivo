import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HealthConsentService } from '../../core/database/health-consent.service';
import type { ContextService } from '../ai-coach/context/context.service';
import type { IntentClassifier } from '../ai-coach/intent/intent-classifier.service';
import type { Intent } from '../ai-coach/intent/intent.types';
import type { LlmAbuseGuard } from '../ai-coach/llm/llm-abuse-guard.service';
import type { LlmRouter } from '../ai-coach/llm/llm-router.service';
import type { QueueManager } from '../jobs/queue-manager.service';
import type { WorkerFactory } from '../jobs/worker.factory';
import { ValidationService } from '../protocol/validation/validation.service';
import type { UserJobLock } from '../whatsapp/user-job-lock';
import type { AiResponseJob } from '../whatsapp/whatsapp-inbound.service';
import { AIResponseWorker } from './ai-response.worker';
import {
  DAILY_LIMIT_MESSAGE,
  STANDARD_BLOCK_RESPONSE,
  SUBSTITUTION_FALLBACK_MESSAGE,
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

  const prompts = {
    resolvePrompt: vi.fn(async (intent: Intent) => resolvePrompt(intent)),
    agentName: vi.fn(async () => 'MOVI'),
    foraDeEscopoResponse: vi.fn(async () => buildForaDeEscopoResponse('MOVI')),
  } as unknown as PromptResolverService;

  const context = {
    build: vi.fn(() =>
      Promise.resolve({
        cacheablePrefix: 'ESTADO',
        volatileSuffix: 'Aluno: oi',
        ragDocs: [],
        sessionDate: '2026-07-31',
        scrubUser: {},
      }),
    ),
    recordTurn: vi.fn(() => Promise.resolve()),
    summarizeIfNeeded: vi.fn(() => Promise.resolve()),
  } as unknown as ContextService;

  const complete = vi.fn((_req: { system: string }) =>
    Promise.resolve({ text: deps.llmText ?? 'Boa, continua firme!', model: 'gpt-4.1' }),
  );
  const llm = { complete } as unknown as LlmRouter;

  const abuse = {
    isOverDailyLimit: vi.fn(() => Promise.resolve(deps.overLimit ?? false)),
  } as unknown as LlmAbuseGuard;

  const validation = new ValidationService();

  const persistTurn = vi.fn(() => Promise.resolve());
  const persistHandoff = vi.fn(() => Promise.resolve());
  const repo = {
    persistTurn,
    persistHandoff,
    loadScrubUser: vi.fn(() => Promise.resolve({})),
    loadConstraints: vi.fn(() =>
      Promise.resolve(
        deps.constraints === undefined
          ? { level: 'INICIANTE', location: 'HOME', equipment: [], injuryTags: [] }
          : deps.constraints,
      ),
    ),
  } as unknown as ConversationRepository;

  const items = deps.batchItems ?? [JSON.stringify({ text: 'oi' })];
  const redis = {
    lrange: vi.fn(() => Promise.resolve(items)),
    del: vi.fn(() => Promise.resolve(1)),
  } as unknown as Redis;

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() } as never;
  const worker = new AIResponseWorker(
    workers,
    queues,
    lock,
    classifier,
    prompts,
    context,
    llm,
    abuse,
    validation,
    repo,
    {
      hasActiveForUser: vi.fn(async () => deps.consentActive ?? true),
    } as unknown as HealthConsentService,
    redis,
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
    const { worker, redis, persistTurn, complete } = makeWorker({ consentActive: false });
    await expect(worker.process(job())).resolves.toEqual({ status: 'CONSENT_REVOKED' });
    expect(redis.del).toHaveBeenCalledWith('bk');
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

  it('fora de escopo: recusa honesta SEM chamar o LLM', async () => {
    const { worker, complete, enqueue } = makeWorker({ intent: 'FORA_DE_ESCOPO' });
    await worker.process(job());
    expect(complete).not.toHaveBeenCalled();
    expect(sentText(enqueue)).toBe(buildForaDeEscopoResponse('MOVI'));
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
      intent: 'DUVIDA_TECNICA',
      llmText: 'Toma um ibuprofeno que resolve.',
    });
    const res = await worker.process(job());
    expect(res.status).toBe('BLOCKED');
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

  it('batch vazio → EMPTY, libera nada', async () => {
    const { worker, lock } = makeWorker({ batchItems: [] });
    const res = await worker.process(job());
    expect(res.status).toBe('EMPTY');
    expect(lock.acquire).not.toHaveBeenCalled();
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
