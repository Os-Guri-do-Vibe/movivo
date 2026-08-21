/**
 * `ForbiddenTopicsService` — avaliação determinística dos **temas proibidos** aprovados.
 *
 * Mora no CORE (DI global, §12.5) pelo mesmo motivo de `L1GuardrailService` e
 * `AgentPersonaService`: o worker do Coach e o painel de admin precisam da mesma lista sem
 * importar módulo de domínio um do outro.
 *
 * ## Fail-safe: last-known-good e cold start fechado
 * Se o banco falhar depois de uma leitura válida, a última lista conhecida continua valendo.
 * Num cold start sem cache, o serviço lança `ForbiddenTopicsUnavailableError`: o worker não
 * chama FAQ nem LLM, registra handoff operacional e entrega a resposta-padrão. Assim uma
 * dependência indisponível nunca reduz silenciosamente o perímetro publicado.
 *
 * ## Cache com pub/sub desde o nascimento
 * Cache local de 60s + canal de invalidação no Redis. O `L1GuardrailService` não tem pub/sub
 * (lacuna conhecida, fora do escopo desta entrega); este serviço nasce com ele porque uma
 * publicação de bloqueio que demora 60s para valer é exatamente o intervalo em que alguém
 * observa "o painel diz que está bloqueado e a agente respondeu assim mesmo".
 */
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { MAX_ACTIVE_FORBIDDEN_TOPICS } from '@movivo/shared';
import { desc } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { DRIZZLE } from '../database/database.constants';
import type { DrizzleClient } from '../database/database.module';
import { aiForbiddenTopics } from '../database/schema';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { REDIS_KEY_BUILDER, RedisKeyBuilder } from '../redis/redis-key.util';
import { matchesTerm, normalizeForMatch } from './text-normalize';

export const FORBIDDEN_TOPICS_CACHE_TTL_MS = 60_000;
export const FORBIDDEN_TOPICS_CHANNEL_SEGMENTS = ['forbidden-topics', 'invalidate'] as const;

/** Tema aprovado, na forma que o runtime usa. `phrases` nunca sai deste processo. */
export interface ActiveForbiddenTopic {
  topicKey: string;
  label: string;
  phrases: string[];
  version: number;
}

/** Resultado de um match. `label` serve ao log/auditoria — **nunca** à resposta do aluno. */
export interface ForbiddenTopicHit {
  topicKey: string;
  label: string;
  version: number;
}

/** Cold start sem banco/cache: o worker deve responder de forma segura, nunca gerar. */
export class ForbiddenTopicsUnavailableError extends Error {
  constructor() {
    super('A configuração de temas proibidos está indisponível.');
    this.name = 'ForbiddenTopicsUnavailableError';
  }
}

@Injectable()
export class ForbiddenTopicsService implements OnModuleInit, OnModuleDestroy {
  private cached: { topics: ActiveForbiddenTopic[]; expiresAt: number } | null = null;
  private subscriber: Redis | null = null;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleClient,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ForbiddenTopicsService.name);
  }

  get channel(): string {
    return this.keys.global(...FORBIDDEN_TOPICS_CHANNEL_SEGMENTS);
  }

  onModuleInit(): void {
    try {
      this.subscriber = this.redis.duplicate();
      void this.subscriber.subscribe(this.channel);
      this.subscriber.on('message', () => this.invalidate());
      this.subscriber.on('error', (err: Error) =>
        this.logger.warn(
          { event: 'forbidden_topics_subscribe_error', err: err.message },
          'pub/sub de temas proibidos',
        ),
      );
    } catch (err) {
      this.subscriber = null;
      this.logger.warn(
        {
          event: 'forbidden_topics_subscribe_error',
          err: err instanceof Error ? err.message : err,
        },
        'sem pub/sub de temas proibidos — propagação cai no TTL de 60s',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.quit().catch(() => undefined);
  }

  invalidate(): void {
    this.cached = null;
  }

  /** Avisa as demais instâncias que a lista mudou. Redis fora do ar não derruba a publicação. */
  async propagate(): Promise<void> {
    try {
      await this.redis.publish(this.channel, '1');
    } catch {
      // silêncio proposital: o TTL de 60s ainda propaga.
    }
    this.invalidate();
  }

  /**
   * Primeiro tema cujo termo casa na mensagem, ou `null`. O match é por
   * limite de palavra sobre texto normalizado (`text-normalize.ts`) — nunca substring crua,
   * nunca regex vinda do painel.
   */
  async evaluate(message: string): Promise<ForbiddenTopicHit | null> {
    const topics = await this.activeTopics();
    if (topics.length === 0) return null;
    const normalized = normalizeForMatch(message);
    for (const topic of topics) {
      if (topic.phrases.some((phrase) => matchesTerm(normalized, phrase))) {
        return { topicKey: topic.topicKey, label: topic.label, version: topic.version };
      }
    }
    return null;
  }

  /** Rótulos que entram no bloco de reforço do prompt. Só `label`, jamais `phrases`. */
  async activeLabels(): Promise<string[]> {
    return (await this.activeTopics()).map((topic) => topic.label);
  }

  /**
   * Temas vigentes: para cada `topic_key`, a maior `version`; entra na lista só se o status
   * dessa versão for `APPROVED`. Teto de `MAX_ACTIVE_FORBIDDEN_TOPICS` aplicado também na
   * leitura — se alguém contornar o gate de escrita, o custo de token do prompt não explode.
   */
  async activeTopics(): Promise<ActiveForbiddenTopic[]> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.topics;
    let topics: ActiveForbiddenTopic[] = [];
    try {
      const rows = await this.db
        .select({
          topicKey: aiForbiddenTopics.topicKey,
          label: aiForbiddenTopics.label,
          phrases: aiForbiddenTopics.phrases,
          version: aiForbiddenTopics.version,
          status: aiForbiddenTopics.status,
        })
        .from(aiForbiddenTopics)
        .orderBy(desc(aiForbiddenTopics.version), desc(aiForbiddenTopics.createdAt));

      const seen = new Set<string>();
      for (const row of rows) {
        if (seen.has(row.topicKey)) continue;
        seen.add(row.topicKey);
        if (row.status === 'APPROVED') {
          topics.push({
            topicKey: row.topicKey,
            label: row.label,
            phrases: row.phrases,
            version: row.version,
          });
        }
      }
      topics = topics.slice(0, MAX_ACTIVE_FORBIDDEN_TOPICS);
    } catch (err) {
      this.logger.warn(
        { event: 'forbidden_topics_fallback', err: err instanceof Error ? err.message : err },
        'lista de temas proibidos indisponível',
      );
      // Last-known-good continua valendo mesmo expirado. Só um cold start sem nenhuma
      // leitura válida interrompe a geração; falha de dependência nunca abre o perímetro.
      if (this.cached) {
        this.cached.expiresAt = Date.now() + 10_000;
        return this.cached.topics;
      }
      throw new ForbiddenTopicsUnavailableError();
    }
    this.cached = { topics, expiresAt: Date.now() + FORBIDDEN_TOPICS_CACHE_TTL_MS };
    return topics;
  }
}
