/**
 * Working memory (camada 1 do ContextService, US-3.2) — janela recente da conversa no Redis.
 *
 * `session:{user_id}:{yyyy-mm-dd}` como LIST de turnos (JSON), janela das últimas ~15
 * mensagens, TTL 24h renovado a cada escrita. Namespaceada por `user_id` (Sato §7) — o
 * `RedisKeyBuilder` garante o prefixo por titular, então um usuário nunca lê a sessão de outro.
 */
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../../../core/redis/redis.constants';
import { REDIS_KEY_BUILDER, RedisKeyBuilder } from '../../../core/redis/redis-key.util';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

const WINDOW = 15;
const TTL_SECONDS = 24 * 3600;
const MAX_TURN_CHARS = 4000;

function isConversationTurn(value: unknown): value is ConversationTurn {
  if (!value || typeof value !== 'object') return false;
  const turn = value as Partial<ConversationTurn>;
  return (
    (turn.role === 'user' || turn.role === 'assistant') &&
    typeof turn.content === 'string' &&
    turn.content.length > 0 &&
    turn.content.length <= MAX_TURN_CHARS &&
    Number.isSafeInteger(turn.ts) &&
    (turn.ts ?? 0) > 0
  );
}

@Injectable()
export class WorkingMemory {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
  ) {}

  private key(userId: string, sessionDate: string): string {
    return this.keys.forUser(userId, 'session', sessionDate);
  }

  private summaryCounterKey(userId: string, sessionDate: string): string {
    return this.keys.forUser(userId, 'session', sessionDate, 'turns-since-summary');
  }

  /** Acrescenta um turno, mantém só a janela recente e renova o TTL. */
  async append(userId: string, sessionDate: string, turn: ConversationTurn): Promise<void> {
    const key = this.key(userId, sessionDate);
    const counter = this.summaryCounterKey(userId, sessionDate);
    await this.redis
      .multi()
      .rpush(key, JSON.stringify(turn))
      .ltrim(key, -WINDOW, -1)
      .expire(key, TTL_SECONDS)
      .incr(counter)
      .expire(counter, TTL_SECONDS)
      .exec();
  }

  /** Janela recente (ordem cronológica). Turno malformado é ignorado (defensivo). */
  async recent(userId: string, sessionDate: string): Promise<ConversationTurn[]> {
    const raw = await this.redis.lrange(this.key(userId, sessionDate), -WINDOW, -1);
    const turns: ConversationTurn[] = [];
    for (const item of raw) {
      try {
        const parsed: unknown = JSON.parse(item);
        if (isConversationTurn(parsed)) turns.push(parsed);
      } catch {
        // turno corrompido — ignora em vez de derrubar a montagem do contexto.
      }
    }
    return turns;
  }

  /** Nº de turnos desde o último resumo — gatilho incremental da condensação. */
  count(userId: string, sessionDate: string): Promise<number> {
    return this.redis
      .get(this.summaryCounterKey(userId, sessionDate))
      .then((value) => Number(value ?? 0));
  }

  /** Reinicia apenas o gatilho; a janela recente continua disponível para continuidade. */
  async markSummarized(userId: string, sessionDate: string): Promise<void> {
    await this.redis.set(this.summaryCounterKey(userId, sessionDate), '0', 'EX', TTL_SECONDS);
  }
}
