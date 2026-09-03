/**
 * LLMRouter — único ponto autorizado a falar com um provedor de LLM (US-2.2 · Victor §1).
 *
 * Fluxo de `complete(request)`:
 *   1. scrubPII sobre system + messages (PII Scrubber inescapável — a porta do router);
 *   2. teto anti-abuso (LLM10) incrementa o counter do dia;
 *   3. cascata DeepSeek V4 Pro → GPT-4.1 → Claude Sonnet 4.5, pulando provedor bloqueado;
 *   4. por provedor: timeout hard (8s), 1 retry só p/ erro de rede transitório, failover
 *      direto em 429/5xx/timeout/sem-chave; erro 4xx (CLIENT) aborta sem failover;
 *   5. grava um `ai_jobs` completo e pseudonimizado com custo BRL.
 *
 * `dataClass` tem fail-safe `default = HEALTH` (é otimização de custo, nunca autorização
 * para provedor de menor garantia). O gate de HEALTH é neutro por provedor e fail-closed.
 */
import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { createHash } from 'node:crypto';

import { AppConfigService } from '../../../core/config';
import { AiJobRepository } from './ai-job.repository';
import { CircuitBreaker } from './circuit-breaker';
import { LlmAbuseGuard } from './llm-abuse-guard.service';
import {
  type ChatTurn,
  type DataClass,
  type LLMProvider,
  LLMProviderError,
  type LLMPurpose,
  type LLMRequest,
  type LLMResult,
  LLMUnavailableError,
  type ProviderName,
} from './llm.types';
import { LLM_PROVIDER_CASCADE } from './providers';
import { scrubPII } from './pii-scrubber';

/** Preço por 1M tokens (USD), snapshot das páginas oficiais em 2026-08-27. */
interface Pricing {
  input: number;
  cached: number;
  output: number;
}
const DEFAULT_PRICING: Pricing = { input: 2.0, cached: 0.5, output: 8.0 };
const PRICING: Record<string, Pricing> = {
  'deepseek-v4-pro': { input: 0.435, cached: 0.003625, output: 0.87 },
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

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Metadados suficientes para correlação sem duplicar prompt, RAG ou fatos de saúde. */
function auditSnapshot(system: string, messages: readonly ChatTurn[]): string {
  return JSON.stringify({
    version: 2,
    systemSha256: sha256(system),
    messagesSha256: sha256(JSON.stringify(messages)),
    systemChars: system.length,
    messageCount: messages.length,
    messageChars: messages.reduce((total, message) => total + message.content.length, 0),
  });
}

function safeErrorCode(error: unknown): string {
  if (error instanceof LLMProviderError) return `LLM_PROVIDER_${error.kind}`;
  return error instanceof Error ? error.name : 'UNKNOWN_ERROR';
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
    const snapshot = auditSnapshot(system, messages);

    // 2. Anti-abuso (LLM10) — pode lançar LLMAbuseError.
    await this.abuse.check(request.userId, request.operationId);

    // Achado 2026-09-02: `Math.min(request.maxTokens ?? cfg.maxTokens, cfg.maxTokens)` clampava
    // TODO caller de volta ao teto genérico de chat (`LLM_MAX_TOKENS`, 4096) — inclusive quando o
    // caller passava um teto MAIOR de propósito (ex: `protocolMaxTokens`, 6000, porque um
    // protocolo é um JSON bem maior que uma resposta de chat). Efeito: toda geração de protocolo
    // truncava aos 4096 tokens, saía com JSON cortado no meio e caía em retry/fallback sempre —
    // reproduzido ao vivo tentando regerar o protocolo do Rodrigo (`tokensOutput: 4096` idêntico
    // em toda tentativa, seguido de "saída de geração malformada"). `cfg.maxTokens` agora só serve
    // de default quando o caller não pede nada — nunca mais de teto por cima do que ele pediu.
    const maxTokens = request.maxTokens ?? cfg.maxTokens;
    const temperature = request.temperature ?? 0.4;
    let lastError: unknown;

    for (const [i, provider] of this.cascade.entries()) {
      if (!provider.canProcess(dataClass)) {
        this.logger.warn(
          { provider: provider.name, dataClass, event: 'llm_provider_data_class_blocked' },
          'provedor não aprovado para a classe de dado; pulando antes do envio',
        );
        continue;
      }
      const breaker = this.breakerFor(provider.name);
      if (!breaker.allow()) {
        this.logger.warn({ provider: provider.name }, 'breaker OPEN — pulando provedor');
        continue;
      }

      const attempt = i + 1;
      const startedAt = Date.now();
      try {
        const result = await this.callWithRetry(
          provider,
          {
            system,
            messages,
            maxTokens,
            temperature,
            cache: request.cache ?? true,
            json: request.json ?? false,
          },
          request.purpose,
        );
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

        // Telemetria de uso de token com o slot da persona (Sprint 11): o prefixo cacheável
        // muda com a persona, então hit-rate agregado sem separar os slots soma duas
        // populações de prompt distintas. `personaSlot` está em `PII_FIELDS` e o pino o
        // redige — combinado com `userId` ele revelaria o sexo do titular, e o Sato foi
        // explícito de que redigir a origem e deixar o derivado em claro não fecha nada.
        // O campo fica no evento assim mesmo: é o ponto de instrumentação, e o corte real
        // por slot sai de `ai_jobs` ⋈ `users.biological_sex` no banco, sob acesso controlado.
        this.logger.info(
          {
            event: 'llm_token_usage',
            provider: provider.name,
            model: result.model,
            intent: request.intent ?? null,
            personaSlot: request.personaSlot ?? null,
            tokensInput: result.usage.tokensInput,
            tokensCached: result.usage.tokensCached,
            tokensOutput: result.usage.tokensOutput,
          },
          'llm_token_usage',
        );

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
    purpose: LLMPurpose,
  ): ReturnType<LLMProvider['complete']> {
    try {
      return await this.callOnce(provider, req, purpose);
    } catch (error) {
      if (!isTransient(error)) throw error;
      await new Promise((r) => setTimeout(r, 200));
      return this.callOnce(provider, req, purpose);
    }
  }

  /**
   * `PROTOCOL_GENERATION` roda em job de fila, sem pressão de UX em tempo real — usa o
   * timeout generoso dedicado. Achado 2026-08-18: com o timeout único de 8s (calibrado
   * pro chat), toda chamada real ao GPT-4.1 pra gerar um protocolo completo estourava,
   * esgotava os 3 retries e caía sempre no fallback de segurança — mascarado como se
   * fosse a validação de conteúdo rejeitando a saída da IA, quando na verdade a IA nunca
   * chegava a responder a tempo. `AI_RESPONSE`/`CHECKIN_ADJUSTMENT` continuam no timeout
   * curto — ali, sim, latência é uma conversa de WhatsApp acontecendo ao vivo.
   */
  private timeoutMsFor(purpose: LLMPurpose): number {
    return purpose === 'PROTOCOL_GENERATION'
      ? this.config.llm.protocolTimeoutMs
      : this.config.llm.timeoutMs;
  }

  private async callOnce(
    provider: LLMProvider,
    req: Parameters<LLMProvider['complete']>[0],
    purpose: LLMPurpose,
  ): ReturnType<LLMProvider['complete']> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMsFor(purpose));
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
      errorMessage: safeErrorCode(error),
    });
  }
}
