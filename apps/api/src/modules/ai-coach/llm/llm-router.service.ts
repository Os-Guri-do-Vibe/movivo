/**
 * LLMRouter — único ponto autorizado a falar com um provedor de LLM (US-2.2 · Victor §1).
 *
 * Fluxo de `complete(request)`:
 *   1. scrubPII sobre system + messages (PII Scrubber inescapável — a porta do router);
 *   2. teto anti-abuso (LLM10) incrementa o counter do dia;
 *   3. cascata GPT-4.1 → Claude Sonnet 4.5, pulando provedor com breaker OPEN;
 *   4. por provedor: timeout hard (8s), 1 retry só p/ erro de rede transitório, failover
 *      direto em 429/5xx/timeout/sem-chave; erro 4xx (CLIENT) aborta sem failover;
 *   5. grava um `ai_jobs` completo e pseudonimizado com custo BRL.
 *
 * `dataClass` tem fail-safe `default = HEALTH` (é otimização de custo, nunca autorização
 * para provedor de menor garantia). DeepSeek está ausente. SDK/HTTP confinado a providers.ts.
 */
import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { AppConfigService } from '../../../core/config';
import { AiJobRepository } from './ai-job.repository';
import { CircuitBreaker } from './circuit-breaker';
import { LlmAbuseGuard } from './llm-abuse-guard.service';
import {
  type ChatTurn,
  type DataClass,
  type LLMProvider,
  LLMProviderError,
  type LLMRequest,
  type LLMResult,
  LLMUnavailableError,
  type ProviderName,
} from './llm.types';
import { LLM_PROVIDER_CASCADE } from './providers';
import { scrubPII } from './pii-scrubber';

/** Preço por 1M tokens (USD). Fonte: Victor §8 (jul/2026). Fallback = rates do GPT-4.1. */
interface Pricing {
  input: number;
  cached: number;
  output: number;
}
const DEFAULT_PRICING: Pricing = { input: 2.0, cached: 0.5, output: 8.0 };
const PRICING: Record<string, Pricing> = {
  'gpt-4.1': DEFAULT_PRICING,
  'claude-sonnet-4-5': { input: 3.0, cached: 0.3, output: 15.0 },
};

export function costBrl(
  model: string,
  usage: { tokensInput: number; tokensCached: number; tokensOutput: number },
  usdBrlRate: number,
): number {
  const p = PRICING[model] ?? DEFAULT_PRICING;
  const usd =
    (usage.tokensInput * p.input + usage.tokensCached * p.cached + usage.tokensOutput * p.output) /
    1_000_000;
  return usd * usdBrlRate;
}

/** Erro de rede que justifica 1 retry no mesmo provedor antes do failover. */
function isTransient(error: unknown): boolean {
  return error instanceof LLMProviderError && error.kind === 'TRANSIENT';
}

@Injectable()
export class LlmRouter {
  private readonly breakers = new Map<ProviderName, CircuitBreaker>();

  constructor(
    @Inject(LLM_PROVIDER_CASCADE) private readonly cascade: readonly LLMProvider[],
    private readonly aiJobs: AiJobRepository,
    private readonly abuse: LlmAbuseGuard,
    private readonly config: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(LlmRouter.name);
    if (!this.cascade.some((p) => p.hasCredentials())) {
      this.logger.warn(
        'nenhum provedor de LLM tem chave configurada — chamadas reais vão falhar com erro claro (dev/CI sem segredo)',
      );
    }
  }

  private breakerFor(name: ProviderName): CircuitBreaker {
    let breaker = this.breakers.get(name);
    if (!breaker) {
      breaker = new CircuitBreaker();
      this.breakers.set(name, breaker);
    }
    return breaker;
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    const dataClass: DataClass = request.dataClass ?? 'HEALTH';
    const cfg = this.config.llm;

    // 1. PII Scrubber — a porta do router. O que sai e o que se loga é pseudonimizado.
    const system = scrubPII(request.system, request.user);
    const messages: ChatTurn[] = request.messages.map((m) => ({
      role: m.role,
      content: scrubPII(m.content, request.user),
    }));
    const snapshot = JSON.stringify({ system, messages }).slice(0, 4000);

    // 2. Anti-abuso (LLM10) — pode lançar LLMAbuseError.
    await this.abuse.check(request.userId);

    const maxTokens = Math.min(request.maxTokens ?? cfg.maxTokens, cfg.maxTokens);
    const temperature = request.temperature ?? 0.4;
    let lastError: unknown;

    for (const [i, provider] of this.cascade.entries()) {
      const breaker = this.breakerFor(provider.name);
      if (!breaker.allow()) {
        this.logger.warn({ provider: provider.name }, 'breaker OPEN — pulando provedor');
        continue;
      }

      const attempt = i + 1;
      const startedAt = Date.now();
      try {
        const result = await this.callWithRetry(provider, {
          system,
          messages,
          maxTokens,
          temperature,
          cache: request.cache ?? true,
        });
        breaker.recordSuccess();

        const latencyMs = Date.now() - startedAt;
        const cost = costBrl(result.model, result.usage, cfg.usdBrlRate);
        await this.abuse.recordCost(request.userId, cost);
        await this.aiJobs.record(request.userId, {
          jobType: request.purpose,
          status: 'COMPLETED',
          provider: provider.name,
          modelUsed: result.model,
          dataClass,
          tokensInput: result.usage.tokensInput,
          tokensOutput: result.usage.tokensOutput,
          tokensCached: result.usage.tokensCached,
          latencyMs,
          attempt,
          intent: request.intent ?? null,
          costBrl: cost,
          validationAction: null, // preenchido pela US-2.3 (ValidationService)
          inputSnapshot: snapshot,
          errorMessage: null,
        });

        return {
          text: result.text,
          provider: provider.name,
          model: result.model,
          tokensInput: result.usage.tokensInput,
          tokensOutput: result.usage.tokensOutput,
          tokensCached: result.usage.tokensCached,
          latencyMs,
          attempt,
          dataClass,
          costBrl: cost,
        };
      } catch (error) {
        lastError = error;
        // 4xx do chamador: não adianta failover; aborta e registra.
        if (error instanceof LLMProviderError && error.kind === 'CLIENT') {
          await this.recordFailure(request, dataClass, provider.name, attempt, snapshot, error);
          throw error;
        }
        breaker.recordFailure();
        this.logger.warn(
          { provider: provider.name, kind: (error as LLMProviderError)?.kind },
          'provedor falhou — failover para o próximo',
        );
      }
    }

    await this.recordFailure(request, dataClass, null, this.cascade.length, snapshot, lastError);
    throw new LLMUnavailableError('todos os provedores de LLM falharam', { cause: lastError });
  }

  /** 1 retry (200ms) só para erro de rede transitório; timeout hard por tentativa. */
  private async callWithRetry(
    provider: LLMProvider,
    req: Parameters<LLMProvider['complete']>[0],
  ): ReturnType<LLMProvider['complete']> {
    try {
      return await this.callOnce(provider, req);
    } catch (error) {
      if (!isTransient(error)) throw error;
      await new Promise((r) => setTimeout(r, 200));
      return this.callOnce(provider, req);
    }
  }

  private async callOnce(
    provider: LLMProvider,
    req: Parameters<LLMProvider['complete']>[0],
  ): ReturnType<LLMProvider['complete']> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.llm.timeoutMs);
    try {
      return await provider.complete(req, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private async recordFailure(
    request: LLMRequest,
    dataClass: DataClass,
    provider: ProviderName | null,
    attempt: number,
    snapshot: string,
    error: unknown,
  ): Promise<void> {
    await this.aiJobs.record(request.userId, {
      jobType: request.purpose,
      status: 'FAILED',
      provider,
      modelUsed: null,
      dataClass,
      tokensInput: 0,
      tokensOutput: 0,
      tokensCached: 0,
      latencyMs: 0,
      attempt,
      intent: request.intent ?? null,
      costBrl: 0,
      validationAction: null,
      inputSnapshot: snapshot,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}
