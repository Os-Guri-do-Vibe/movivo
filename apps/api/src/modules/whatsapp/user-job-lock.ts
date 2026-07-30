/**
 * Lock por usuário para a fila `ai-response` (US-3.1 TASK-3.1.2 · Rafael/Sato §9.4).
 *
 * Garante que **só um job de resposta do Coach roda por usuário por vez**: o webhook
 * coalesce a rajada num único job (debounce NX), e o worker de US-3.5 pega este lock
 * antes de processar. Mensagem que chega com job em curso já foi para o buffer Redis e
 * será drenada pelo job em execução — nunca há processamento paralelo do mesmo titular.
 *
 * SET NX PX (token aleatório) + release por compare-and-del via Lua (nunca apagar o lock
 * de outra execução que já o readquiriu depois do TTL). Provido aqui na US-3.1 e
 * **consumido pelo AIResponseWorker na US-3.5**.
 */
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import { REDIS_KEY_BUILDER, RedisKeyBuilder } from '../../core/redis/redis-key.util';

/** TTL do lock: cobre o orçamento de processamento (≤30s p95) com folga. */
export const DEFAULT_LOCK_TTL_MS = 60_000;

const RELEASE_SCRIPT = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

@Injectable()
export class UserJobLock {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
  ) {}

  private key(userId: string): string {
    return this.keys.forUser(userId, 'ai-response', 'lock');
  }

  /** Adquire o lock. Retorna o token (para o release) ou `null` se já há job em curso. */
  async acquire(userId: string, ttlMs: number = DEFAULT_LOCK_TTL_MS): Promise<string | null> {
    const token = randomUUID();
    const ok = await this.redis.set(this.key(userId), token, 'PX', ttlMs, 'NX');
    return ok === 'OK' ? token : null;
  }

  /** Libera o lock apenas se o token bater (compare-and-del atômico). */
  async release(userId: string, token: string): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, this.key(userId), token);
  }
}
