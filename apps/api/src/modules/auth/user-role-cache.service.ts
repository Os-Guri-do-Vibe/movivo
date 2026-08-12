/**
 * `UserRoleCacheService` — cache curto do `users.role` usado pelo `JwtStrategy`.
 *
 * # Por que existe
 * O `JwtStrategy` revalida no banco o papel alegado pelo token a CADA request
 * autenticada. Sem cache isso é uma query extra por request — inclusive nas conexões
 * longas (SSE de `queue/events`) e no polling do Control Center.
 *
 * # A garantia que NÃO pode ser perdida
 * A revalidação existe justamente para revogar privilégio mais rápido do que os 15min
 * do access token. Por isso o TTL é de **60 segundos**: uma mudança de papel passa a
 * valer em no máximo ~1 minuto (contra os 15min do token), e imediatamente se
 * {@link invalidate} for chamado. Nunca aumente esse TTL sem revisar essa premissa.
 *
 * Falha do Redis **não** é silenciada: a exceção propaga e a request é recusada, o mesmo
 * fail-closed já adotado pelo `TokenDenylistService`.
 */
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';

import { TenantDatabase, type TenantRole } from '../../core/database';
import { users } from '../../core/database/schema';
import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import { REDIS_KEY_BUILDER, RedisKeyBuilder } from '../../core/redis/redis-key.util';

/** Teto da janela de propagação de uma mudança de papel (segundos). */
const TTL_SECONDS = 60;
/** Sentinela para conta inexistente — evita repetir a query em loop de token órfão. */
const ABSENT = '-';

@Injectable()
export class UserRoleCacheService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly db: TenantDatabase,
  ) {}

  private key(userId: string): string {
    return this.keys.forUser(userId, 'role');
  }

  /** Papel persistido do usuário, ou `null` se a conta não existe. */
  async get(userId: string): Promise<TenantRole | null> {
    const cached = await this.redis.get(this.key(userId));
    if (cached) return cached === ABSENT ? null : (cached as TenantRole);

    const [account] = await this.db.runAsSystem((tx) =>
      tx.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1),
    );
    await this.redis.set(this.key(userId), account?.role ?? ABSENT, 'EX', TTL_SECONDS);
    return account?.role ?? null;
  }

  /**
   * Descarta o papel cacheado. Chame ao alterar `users.role` para que a revogação valha
   * na próxima request em vez de esperar o TTL. Hoje o papel só muda por SQL fora da
   * aplicação (seed/DBA), então o TTL é o teto efetivo; este é o gancho para quando
   * existir um endpoint de gestão de papéis.
   */
  async invalidate(userId: string): Promise<void> {
    await this.redis.del(this.key(userId));
  }
}
