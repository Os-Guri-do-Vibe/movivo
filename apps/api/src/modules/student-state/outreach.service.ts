/**
 * Contatos que a MOVIVO inicia com o aluno (busca ativa, lembrete de compromisso, conversa dos
 * especialistas). Dois papéis:
 *  · porteiro: no máximo UM contato proativo por dia, qualquer que seja o fluxo, para o aluno
 *    sentir cuidado e não cobrança;
 *  · memória do que funcionou: cada contato guarda a abordagem e se o aluno respondeu, e os
 *    agentes leem isso para não repetir o que não deu certo.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';

import { agentOutreaches, type OutreachKind } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';

const GATE_TTL_SECONDS = 36 * 3_600;
/** A resposta conta como resposta ao contato se vier dentro de 72 horas. */
export const RESPONSE_WINDOW_MS = 72 * 3_600_000;

export interface OutreachView {
  kind: OutreachKind;
  level: number | null;
  strategy: string | null;
  sentAt: string;
  /** Horas até o aluno responder; `null` = ainda sem resposta. */
  respondedAfterHours: number | null;
}

@Injectable()
export class OutreachService {
  constructor(
    private readonly db: TenantDatabase,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
  ) {}

  /** `true` para o primeiro fluxo que pede o contato proativo do dia; os demais esperam. */
  async tryAcquireToday(userId: string, localDate: string): Promise<boolean> {
    const key = this.keys.forUser(userId, 'outreach', 'proactive', localDate);
    return (await this.redis.set(key, '1', 'EX', GATE_TTL_SECONDS, 'NX')) !== null;
  }

  /** O fluxo desistiu de falar (sem texto válido, por exemplo): o dia fica livre para outro. */
  async release(userId: string, localDate: string): Promise<void> {
    await this.redis.del(this.keys.forUser(userId, 'outreach', 'proactive', localDate));
  }

  async record(
    userId: string,
    kind: OutreachKind,
    detail: { level?: number; strategy?: string } = {},
  ): Promise<void> {
    await this.db.runAsUser(userId, 'USER', (tx) =>
      tx.insert(agentOutreaches).values({
        userId,
        kind,
        level: detail.level ?? null,
        strategy: detail.strategy?.slice(0, 32) ?? null,
      }),
    );
  }

  /** Chamado a cada mensagem do aluno: fecha os contatos recentes que ainda esperavam resposta. */
  async markResponded(userId: string, now: Date = new Date()): Promise<void> {
    await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .update(agentOutreaches)
        .set({ respondedAt: now })
        .where(
          and(
            eq(agentOutreaches.userId, userId),
            isNull(agentOutreaches.respondedAt),
            gte(agentOutreaches.sentAt, new Date(now.getTime() - RESPONSE_WINDOW_MS)),
          ),
        ),
    );
  }

  async recent(userId: string, limit = 8): Promise<OutreachView[]> {
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select()
        .from(agentOutreaches)
        .where(eq(agentOutreaches.userId, userId))
        .orderBy(desc(agentOutreaches.sentAt))
        .limit(limit),
    );
    return rows.map((r) => ({
      kind: r.kind as OutreachKind,
      level: r.level,
      strategy: r.strategy,
      sentAt: r.sentAt.toISOString(),
      respondedAfterHours: r.respondedAt
        ? Math.max(0, Math.round((r.respondedAt.getTime() - r.sentAt.getTime()) / 3_600_000))
        : null,
    }));
  }

  /** Taxa de resposta por tipo e abordagem (painel de qualidade). */
  async effectiveness(since: Date) {
    return this.db.runAsSystem((tx) =>
      tx
        .select({
          kind: agentOutreaches.kind,
          strategy: agentOutreaches.strategy,
          sent: sql<number>`count(*)::int`,
          responded: sql<number>`count(${agentOutreaches.respondedAt})::int`,
        })
        .from(agentOutreaches)
        .where(gte(agentOutreaches.sentAt, since))
        .groupBy(agentOutreaches.kind, agentOutreaches.strategy),
    );
  }
}
