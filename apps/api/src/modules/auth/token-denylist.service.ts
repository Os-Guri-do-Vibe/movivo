/**
 * `TokenDenylistService` — revogação de access token por `jti` (US-1.4 / Sato §9.1).
 *
 * O access token é stateless (15min), então não dá para "apagá-lo": revoga-se pelo
 * `jti` numa denylist no Redis, com **TTL = validade restante** do token. Passado o
 * `exp`, a chave some sozinha e o token já seria recusado pela expiração — a denylist
 * só precisa cobrir a janela em que o token ainda seria aceito.
 *
 * A chave é global (não pertence a um titular): é um `jti`, não PII. Mesmo assim usa o
 * `RedisKeyBuilder` (única forma suportada de montar chave — namespacing da Sprint 0),
 * sob o namespace `g:` (global).
 */
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import { REDIS_KEY_BUILDER, RedisKeyBuilder } from '../../core/redis/redis-key.util';

@Injectable()
export class TokenDenylistService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
  ) {}

  private key(jti: string): string {
    // `jwt-denylist` é um segmento fixo; o `jti` é um UUID (passa no SEGMENT_PATTERN).
    return this.keys.global('jwt-denylist', jti);
  }

  /** Revoga um `jti` até `expiresAtEpoch` (segundos). No-op se o token já expirou. */
  async revoke(jti: string, expiresAtEpoch: number): Promise<void> {
    const ttlSeconds = expiresAtEpoch - Math.floor(Date.now() / 1000);
    if (ttlSeconds <= 0) return;
    await this.redis.set(this.key(jti), '1', 'EX', ttlSeconds);
  }

  /** `true` se o `jti` está na denylist (token revogado). */
  async isRevoked(jti: string): Promise<boolean> {
    return (await this.redis.exists(this.key(jti))) === 1;
  }
}
