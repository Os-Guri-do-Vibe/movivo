/**
 * `AgentPersonaService` (US-7.6 / TASK-7.6.3) — resolução da persona vigente da IA, com
 * cache e fail-safe. Mora no CORE (DI global, §12.5): `whatsapp`, `subscription` e `coach`
 * precisam do nome/tom da agente sem poder importar módulo de domínio um do outro.
 *
 * ## A regra que manda em tudo aqui: fail-safe nunca é "sem guardrail"
 * Se o Redis cair, se o banco não responder, se não houver configuração publicada, ou se o
 * payload publicado não validar contra o Zod — o serviço devolve `DEFAULT_AGENT_PERSONA`
 * (`@movivo/shared`), o default **compilado**. Em nenhum caminho de erro este serviço
 * devolve persona vazia ou parcial. Toda queda para o default emite o evento observável
 * `agent_config_fallback` — não é silenciosa, porque "a IA está com a config errada"
 * precisa ser percebido.
 *
 * ## Cache
 * Memória local com TTL de 60s (o teto de propagação exigido pela US). A publicação faz
 * `SET` + `PUBLISH` no Redis; cada instância da API assina o canal e limpa o cache na hora,
 * o que na prática torna a propagação imediata. O `SET` é o snapshot compartilhado: uma
 * instância que suba com o banco lento ainda lê a config vigente do Redis.
 *
 * Lógica específica de intenção (`resolvePrompt`, `buildForaDeEscopoResponse`) fica em
 * `ai-coach/intent/prompt-resolver.service.ts`, que consome este serviço por `.persona()`.
 */
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { agentPersonaSchema, DEFAULT_AGENT_PERSONA, type AgentPersona } from '@movivo/shared';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { REDIS_CLIENT } from '../redis/redis.constants';
import { REDIS_KEY_BUILDER, RedisKeyBuilder } from '../redis/redis-key.util';
import { AgentConfigRepository } from './agent-config.repository';

/** TTL do cache em memória. Teto de propagação de uma publicação sem pub/sub. */
export const PERSONA_CACHE_TTL_MS = 60_000;

/** Segmentos da chave/canal — usados também pelo publicador (AdminModule). */
export const AGENT_CONFIG_KEY_SEGMENTS = ['agent-config', 'current'] as const;
export const AGENT_CONFIG_CHANNEL_SEGMENTS = ['agent-config', 'invalidate'] as const;

@Injectable()
export class AgentPersonaService implements OnModuleInit, OnModuleDestroy {
  private cached: { persona: AgentPersona; expiresAt: number } | null = null;
  private subscriber: Redis | null = null;

  constructor(
    private readonly repo: AgentConfigRepository,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AgentPersonaService.name);
  }

  get cacheKey(): string {
    return this.keys.global(...AGENT_CONFIG_KEY_SEGMENTS);
  }

  get channel(): string {
    return this.keys.global(...AGENT_CONFIG_CHANNEL_SEGMENTS);
  }

  onModuleInit(): void {
    // Conexão dedicada: um cliente ioredis em modo subscriber não aceita outros comandos.
    // Falha em assinar não é fatal — o TTL de 60s continua propagando a publicação.
    try {
      this.subscriber = this.redis.duplicate();
      void this.subscriber.subscribe(this.channel);
      this.subscriber.on('message', () => this.invalidate());
      this.subscriber.on('error', (err: Error) =>
        this.logger.warn({ event: 'agent_config_subscribe_error', err: err.message }, 'pub/sub'),
      );
    } catch (err) {
      this.subscriber = null;
      this.logger.warn(
        { event: 'agent_config_subscribe_error', err: err instanceof Error ? err.message : err },
        'sem pub/sub de configuração — propagação cai no TTL de 60s',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.quit().catch(() => undefined);
  }

  /** Limpa o cache local. Chamado pelo pub/sub e pelo publicador na mesma instância. */
  invalidate(): void {
    this.cached = null;
  }

  /** Persona vigente. **Nunca lança**: todo erro cai para o default de código. */
  async persona(): Promise<AgentPersona> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.persona;

    this.fallbackReason = 'CONFIG_ABSENT';
    const loaded = (await this.fromRedis()) ?? (await this.fromDatabase());
    const persona = loaded ?? this.fallback(this.fallbackReason);
    this.cached = { persona, expiresAt: Date.now() + PERSONA_CACHE_TTL_MS };
    return persona;
  }

  /** Nome da agente para superfícies fora do prompt (WhatsApp, copy, transcrição). */
  async agentName(): Promise<string> {
    return (await this.persona()).agentName;
  }

  /** Motivo da última queda, definido pela fonte que falhou e logado uma única vez. */
  private fallbackReason = 'CONFIG_ABSENT';

  private fallback(reason: string): AgentPersona {
    this.logger.warn(
      { event: 'agent_config_fallback', reason },
      'configuração da agente indisponível — usando o default de código (guardrail compilado)',
    );
    return DEFAULT_AGENT_PERSONA;
  }

  /** Snapshot compartilhado. Redis fora do ar ⇒ `null` ⇒ tenta o banco. */
  private async fromRedis(): Promise<AgentPersona | null> {
    try {
      const raw = await this.redis.get(this.cacheKey);
      if (!raw) return null;
      const parsed = agentPersonaSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        this.logger.warn(
          { event: 'agent_config_invalid_payload', source: 'redis' },
          'snapshot de configuração inválido — ignorado',
        );
        return null;
      }
      return parsed.data;
    } catch {
      return null;
    }
  }

  /** Fonte de verdade. Banco fora do ar ou payload inválido ⇒ `null` ⇒ default. */
  private async fromDatabase(): Promise<AgentPersona | null> {
    try {
      const row = await this.repo.activePayload();
      if (!row) return null;
      const parsed = agentPersonaSchema.safeParse(row.payload);
      if (!parsed.success) {
        this.fallbackReason = 'INVALID_PAYLOAD';
        return null;
      }
      return parsed.data;
    } catch {
      this.fallbackReason = 'DATABASE_UNAVAILABLE';
      return null;
    }
  }
}
