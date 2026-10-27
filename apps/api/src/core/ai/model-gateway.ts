/**
 * ModelGateway — porta única dos agentes para os modelos de linguagem e visão.
 *
 * Fluxo de `complete(request)`:
 *   1. resolve as rotas do TIER pedido (`model_tiers` ou padrão), na ordem de failover;
 *   2. pseudonimiza as mensagens (o `system` é autorado em código e nunca carrega PII);
 *   3. por rota: pula fornecedor sem diligência para a classe de dado, sem chave, com circuito
 *      aberto ou sem visão quando há imagem; timeout por rota; 1 retry só em erro de rede;
 *      failover em 429/5xx/timeout/credencial; erro do chamador (4xx) aborta;
 *   4. grava `model_runs` (sucesso e falha) com custo, tokens e hashes do prompt.
 */
import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PinoLogger } from 'nestjs-pino';

import { AppConfigService } from '../config';
import { modelRuns } from '../database/schema';
import { TenantDatabase } from '../database/tenant-database.service';
import {
  type DataClass,
  type GatewayMessage,
  type GatewayRequest,
  type GatewayResult,
  type ModelVendor,
  type ModelVendorClient,
  type TierRoute,
  TierUnavailableError,
  VendorError,
} from './ai.types';
import { CircuitBreaker } from './circuit-breaker';
import { ModelTierConfig } from './model-tier-config';
import { scrubPII } from './pii-scrubber';
import { costBrl } from './pricing';

export const MODEL_VENDOR_CLIENTS = Symbol('MOVIVO_MODEL_VENDOR_CLIENTS');

/** Registro de uma chamada em `model_runs` — isolado para os testes trocarem por fake. */
export interface ModelRunRecord {
  userId: string | null;
  taskId: string;
  promptVersion: string;
  tier: string;
  vendor: ModelVendor | null;
  model: string | null;
  dataClass: DataClass;
  status: 'COMPLETED' | 'FAILED';
  attempt: number;
  tokensInput: number;
  tokensCached: number;
  tokensOutput: number;
  costBrl: number;
  latencyMs: number;
  errorCode: string | null;
  inputSnapshot: Record<string, string | number>;
}

@Injectable()
export class ModelRunRecorder {
  constructor(private readonly db: TenantDatabase) {}

  async record(run: ModelRunRecord): Promise<string> {
    const [row] = await this.db.runAsSystem((tx) =>
      tx.insert(modelRuns).values(run).returning({ id: modelRuns.id }),
    );
    if (!row) throw new Error('falha ao registrar model_run');
    return row.id;
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hasImage(messages: GatewayMessage[]): boolean {
  return messages.some(
    (message) =>
      typeof message.content !== 'string' && message.content.some((p) => p.type === 'image'),
  );
}

function scrubMessages(request: GatewayRequest): GatewayMessage[] {
  const user = request.scrubUser ?? {};
  return request.messages.map((message) => ({
    role: message.role,
    content:
      typeof message.content === 'string'
        ? scrubPII(message.content, user)
        : message.content.map((part) =>
            part.type === 'text' ? { type: 'text', text: scrubPII(part.text, user) } : part,
          ),
  }));
}

/** Hashes e tamanhos — correlação sem duplicar prompt, imagem ou dado de saúde. */
function snapshotOf(system: string, messages: GatewayMessage[]): Record<string, string | number> {
  const text = JSON.stringify(
    messages.map((m) =>
      typeof m.content === 'string'
        ? m.content
        : m.content.map((p) => (p.type === 'text' ? p.text : `[imagem:${p.base64.length}]`)),
    ),
  );
  return {
    systemSha256: sha256(system),
    messagesSha256: sha256(text),
    systemChars: system.length,
    messageCount: messages.length,
  };
}

function errorCode(error: unknown): string {
  if (error instanceof VendorError) return `VENDOR_${error.kind}`;
  return error instanceof Error ? error.name.slice(0, 40) : 'UNKNOWN_ERROR';
}

@Injectable()
export class ModelGateway {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly clients: Map<ModelVendor, ModelVendorClient>;

  constructor(
    @Inject(MODEL_VENDOR_CLIENTS) clients: readonly ModelVendorClient[],
    private readonly tiers: ModelTierConfig,
    private readonly runs: ModelRunRecorder,
    private readonly config: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.clients = new Map(clients.map((client) => [client.vendor, client]));
    this.logger.setContext(ModelGateway.name);
  }

  async complete(request: GatewayRequest): Promise<GatewayResult> {
    const dataClass: DataClass = request.dataClass ?? 'HEALTH';
    const needsVision = hasImage(request.messages);
    const messages = scrubMessages(request);
    const snapshot = snapshotOf(request.system, messages);
    const routes = request.routeOverride
      ? [request.routeOverride]
      : await this.tiers.routesFor(request.tier);
    let lastError: unknown = new Error('nenhuma rota elegível');

    for (const [index, route] of routes.entries()) {
      const client = this.clients.get(route.vendor);
      const skip = this.skipReason(client, route, dataClass, needsVision);
      if (skip || !client) {
        this.logger.debug({ tier: request.tier, vendor: route.vendor, skip }, 'rota pulada');
        continue;
      }
      const breaker = this.breakerFor(route);
      const attempt = index + 1;
      const startedAt = Date.now();
      try {
        const result = await this.callWithRetry(client, route, request, messages);
        breaker.recordSuccess();
        const latencyMs = Date.now() - startedAt;
        const cost = costBrl(route.model, result.usage, this.config.llm.usdBrlRate);
        const modelRunId = await this.runs.record({
          userId: request.userId,
          taskId: request.taskId,
          promptVersion: request.promptVersion,
          tier: request.tier,
          vendor: route.vendor,
          model: route.model,
          dataClass,
          status: 'COMPLETED',
          attempt,
          ...result.usage,
          costBrl: cost,
          latencyMs,
          errorCode: null,
          inputSnapshot: snapshot,
        });
        return {
          text: result.text,
          vendor: route.vendor,
          model: route.model,
          usage: result.usage,
          latencyMs,
          costBrl: cost,
          modelRunId,
        };
      } catch (error) {
        lastError = error;
        if (error instanceof VendorError && error.kind === 'CLIENT') {
          await this.recordFailure(request, dataClass, route, attempt, snapshot, error);
          throw error;
        }
        breaker.recordFailure();
        this.logger.warn(
          { tier: request.tier, vendor: route.vendor, model: route.model, err: errorCode(error) },
          'rota falhou — failover para a próxima',
        );
      }
    }

    await this.recordFailure(request, dataClass, null, routes.length, snapshot, lastError);
    throw new TierUnavailableError(request.tier, `tier ${request.tier} indisponível`, {
      cause: lastError,
    });
  }

  private skipReason(
    client: ModelVendorClient | undefined,
    route: TierRoute,
    dataClass: DataClass,
    needsVision: boolean,
  ): string | null {
    if (!client) return 'fornecedor sem adaptador';
    if (!client.canProcess(dataClass)) return 'sem diligência para a classe de dado';
    if (!client.hasCredentials()) return 'sem chave';
    if (needsVision && !route.vision) return 'modelo sem visão';
    if (!this.breakerFor(route).allow()) return 'circuito aberto';
    return null;
  }

  private breakerFor(route: TierRoute): CircuitBreaker {
    const key = `${route.vendor}:${route.model}`;
    let breaker = this.breakers.get(key);
    if (!breaker) {
      breaker = new CircuitBreaker();
      this.breakers.set(key, breaker);
    }
    return breaker;
  }

  private async callWithRetry(
    client: ModelVendorClient,
    route: TierRoute,
    request: GatewayRequest,
    messages: GatewayMessage[],
  ) {
    const call = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), route.timeoutMs);
      try {
        return await client.complete(
          {
            model: route.model,
            system: request.system,
            messages,
            maxOutputTokens: route.maxOutputTokens,
            temperature: route.temperature,
            json: request.json,
          },
          controller.signal,
        );
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof VendorError && error.kind === 'TRANSIENT')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
      return call();
    }
  }

  private async recordFailure(
    request: GatewayRequest,
    dataClass: DataClass,
    route: TierRoute | null,
    attempt: number,
    snapshot: Record<string, string | number>,
    error: unknown,
  ): Promise<void> {
    await this.runs.record({
      userId: request.userId,
      taskId: request.taskId,
      promptVersion: request.promptVersion,
      tier: request.tier,
      vendor: route?.vendor ?? null,
      model: route?.model ?? null,
      dataClass,
      status: 'FAILED',
      attempt,
      tokensInput: 0,
      tokensCached: 0,
      tokensOutput: 0,
      costBrl: 0,
      latencyMs: 0,
      errorCode: errorCode(error),
      inputSnapshot: snapshot,
    });
  }
}
