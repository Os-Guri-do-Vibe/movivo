/**
 * `AiCoachModule` — camada de IA compartilhada (US-2.2).
 *
 * Preenche a fundação LGPD-safe de acesso ao LLM que a geração de treino (US-2.1) e o
 * Coach (Sprint 3) vão consumir: `LLMRouter` (cascata GPT-4.1→Claude, breaker, teto de
 * tokens, logging), `PIIScrubber` (porta do router), `LlmAbuseGuard` (LLM10) e a
 * persistência de `ai_jobs` sob RLS.
 *
 * Regras que valem aqui (ADR-005-R / §12.11-12.12):
 *  - LLM principal **GPT-4.1**, fallback **Claude Sonnet 4.5**, ambos ZDR. **DeepSeek proibido**.
 *  - O `LLMRouter` é o único ponto autorizado a falar com um provedor; o SDK/HTTP de
 *    provedor fica confinado a `llm/providers.ts` (teste estrutural garante).
 *  - Isolamento por titular: `ai_jobs` sob FORCE RLS; counter Redis namespaced por `user_id`.
 *
 * Depende só do CORE (config, banco, Redis, logger) por DI global — não importa outro
 * módulo de domínio (§12.5).
 */
import { Module } from '@nestjs/common';

import { AppConfigService } from '../../core/config';
import { ContextRepository } from './context/context.repository';
import { ContextService } from './context/context.service';
import { SEMANTIC_MEMORY } from './context/semantic-memory.port';
import { WorkingMemory } from './context/working-memory.service';
import { IntentClassifier } from './intent/intent-classifier.service';
import { IntentRepository } from './intent/intent.repository';
import { EMBEDDING_PORT, FakeEmbedding } from './rag/embedding.port';
import { RagService } from './rag/rag.service';
import { FakeReranker, RERANKER_PORT } from './rag/reranker.port';
import { AiJobRepository } from './llm/ai-job.repository';
import { LlmAbuseGuard } from './llm/llm-abuse-guard.service';
import { LlmRouter } from './llm/llm-router.service';
import {
  AnthropicProvider,
  LLM_FALLBACK_PROVIDER,
  LLM_PRIMARY_PROVIDER,
  LLM_PROVIDER_CASCADE,
  OpenAiProvider,
} from './llm/providers';
import type { LLMProvider } from './llm/llm.types';

@Module({
  providers: [
    {
      provide: LLM_PRIMARY_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): LLMProvider =>
        new OpenAiProvider('OPENAI_GPT41', config.llm.primaryModel, config.llm.openaiApiKey),
    },
    {
      provide: LLM_FALLBACK_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): LLMProvider =>
        new AnthropicProvider(
          'ANTHROPIC_SONNET45',
          config.llm.fallbackModel,
          config.llm.anthropicApiKey,
        ),
    },
    {
      provide: LLM_PROVIDER_CASCADE,
      inject: [LLM_PRIMARY_PROVIDER, LLM_FALLBACK_PROVIDER],
      useFactory: (primary: LLMProvider, fallback: LLMProvider): LLMProvider[] => [
        primary,
        fallback,
      ],
    },
    AiJobRepository,
    LlmAbuseGuard,
    LlmRouter,
    // Sprint 3 — memória da conversa (US-3.2) + RAG (US-3.3).
    WorkingMemory,
    ContextRepository,
    // Portas de embedding/rerank: fakes determinísticos no dev/CI; impl real (OpenAI /
    // bge-reranker) pluga atrás delas quando houver chave/infra.
    { provide: EMBEDDING_PORT, useClass: FakeEmbedding },
    { provide: RERANKER_PORT, useClass: FakeReranker },
    // US-3.3 substitui o no-op da US-3.2: a camada semantic agora é o RAG real (PGVector).
    { provide: SEMANTIC_MEMORY, useClass: RagService },
    ContextService,
    // US-3.4 — classificação de intenção (guardrail clínico + kNN + fallback nano).
    IntentRepository,
    IntentClassifier,
  ],
  // Exporta o que a geração (US-2.1), o Worker (US-2.4) e o AIResponseWorker (US-3.5) consomem.
  exports: [LlmRouter, AiJobRepository, ContextService, IntentClassifier],
})
export class AiCoachModule {}
