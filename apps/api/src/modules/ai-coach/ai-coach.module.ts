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
  ],
  // Exporta o que a geração (US-2.1) e o Worker (US-2.4) consomem.
  exports: [LlmRouter, AiJobRepository],
})
export class AiCoachModule {}
