import { BadRequestException, Injectable } from '@nestjs/common';
import {
  auditSearchQuerySchema,
  type AuditSearchQuery,
  type AuditSearchResponse,
} from '@movivo/shared';
import { and, asc, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { auditLogs, users } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { AuditService } from './audit.service';

const TIMEZONE = 'America/Sao_Paulo' as const;

@Injectable()
export class AuditQueryService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  async search(actor: AuthenticatedUser, raw: unknown): Promise<AuditSearchResponse> {
    const parsed = auditSearchQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_INPUT', issues: parsed.error.issues });
    }
    const input = parsed.data;
    if (input.from && input.to && input.from > input.to) {
      throw new BadRequestException('A data inicial não pode ser posterior à data final.');
    }

    const response = await this.db.runAsSystem(async (tx) => {
      const actorUser = alias(users, 'audit_actor');
      const where = this.filters(input);
      const offset = (input.page - 1) * input.pageSize;
      const [events, totals, actors, actions] = await Promise.all([
        tx
          .select({
            id: auditLogs.id,
            actorId: auditLogs.actorId,
            actorName: actorUser.name,
            subjectId: auditLogs.userId,
            action: auditLogs.action,
            entityType: auditLogs.entityType,
            entityId: auditLogs.entityId,
            createdAt: auditLogs.createdAt,
          })
          .from(auditLogs)
          .leftJoin(actorUser, eq(actorUser.id, auditLogs.actorId))
          .where(where)
          .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
          .limit(input.pageSize)
          .offset(offset),
        tx.select({ total: count() }).from(auditLogs).where(where),
        tx
          .selectDistinct({ id: auditLogs.actorId, name: actorUser.name })
          .from(auditLogs)
          .leftJoin(actorUser, eq(actorUser.id, auditLogs.actorId))
          .orderBy(asc(actorUser.name), asc(auditLogs.actorId)),
        tx
          .selectDistinct({ action: auditLogs.action })
          .from(auditLogs)
          .orderBy(asc(auditLogs.action)),
      ]);
      const total = Number(totals[0]?.total ?? 0);
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action: 'AUDIT_LOG_VIEWED',
        entityType: 'audit_search',
        entityId: actor.userId,
        changes: {
          actorId: input.actorId ?? null,
          action: input.action ?? null,
          from: input.from ?? null,
          to: input.to ?? null,
          page: input.page,
          pageSize: input.pageSize,
        },
      });
      return {
        events: events.map((event) => ({
          ...event,
          createdAt: event.createdAt.toISOString(),
        })),
        actors,
        actions: actions.map((item) => item.action),
        pagination: {
          page: input.page,
          pageSize: input.pageSize,
          total,
          totalPages: total === 0 ? 0 : Math.ceil(total / input.pageSize),
        },
      };
    });
    return {
      data: response,
      meta: { generatedAt: new Date().toISOString(), timezone: TIMEZONE, dataQuality: [] },
    };
  }

  private filters(input: AuditSearchQuery): SQL | undefined {
    const filters: SQL[] = [];
    if (input.actorId) filters.push(eq(auditLogs.actorId, input.actorId));
    if (input.action) filters.push(eq(auditLogs.action, input.action));
    if (input.from) {
      filters.push(sql`${auditLogs.createdAt} >= (${input.from}::date AT TIME ZONE ${TIMEZONE})`);
    }
    if (input.to) {
      filters.push(
        sql`${auditLogs.createdAt} < ((${input.to}::date + interval '1 day') AT TIME ZONE ${TIMEZONE})`,
      );
    }
    return filters.length === 0 ? undefined : and(...filters);
  }
}
