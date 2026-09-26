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

/** `yyyy-mm-dd` do dia civil anterior — puramente calendário, sem depender de fuso horário. */
function previousSessionDate(sessionDate: string): string {
  const date = new Date(`${sessionDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

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

  /**
   * Janela recente (ordem cronológica). Turno malformado é ignorado (defensivo).
   *
   * Achado 2026-09-26 (bug reportado pelo fundador, reproduzido ao vivo — pedido de
   * substituição de exercício virou recusa "fora de escopo"): a lista é particionada por
   * `sessionDate` (dia civil em America/Sao_Paulo), mas a virada da meia-noite acontece NO
   * MEIO de uma conversa em andamento — um aluno respondendo às 00:00:48 uma pergunta feita
   * às 23:56:24 do dia anterior caía numa chave NOVA e vazia, perdendo o turno que dava
   * sentido à resposta ("quero compressão de anilha" sem contexto é ambíguo até para o LLM
   * de fallback). A janela precisa ser rolante de verdade (mesmo espírito do TTL de 24h
   * renovado a cada escrita), não cortada no fuso — por isso sempre funde a cauda do dia
   * anterior com a cabeça do dia atual antes de aplicar a janela.
   */
  async recent(userId: string, sessionDate: string): Promise<ConversationTurn[]> {
    const [todayRaw, yesterdayRaw] = await Promise.all([
      this.redis.lrange(this.key(userId, sessionDate), -WINDOW, -1),
      this.redis.lrange(this.key(userId, previousSessionDate(sessionDate)), -WINDOW, -1),
    ]);
    const parse = (raw: string[]): ConversationTurn[] => {
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
    };
    return [...parse(yesterdayRaw), ...parse(todayRaw)].sort((a, b) => a.ts - b.ts).slice(-WINDOW);
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
