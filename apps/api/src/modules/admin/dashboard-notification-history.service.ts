/**
 * Registro de notificações do profissional (tela "Notificações"): alertas do AI Coach e itens da
 * Fila do Profissional, lidos ou não, pendentes ou já decididos.
 *
 * Janela: tudo que ainda está PENDENTE (sem limite de idade) + o que já foi decidido e foi criado
 * nos últimos 30 dias. Um item decidido nunca aparece como não lido. Paginação por cursor
 * `(createdAt desc, tipo desc, id desc)`; o cursor trabalha em milissegundos porque é o que
 * sobrevive ao ciclo ISO → JSON → ISO.
 */
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import {
  anamnesisSessions,
  dashboardNotificationReads,
  handoffAlerts,
  protocolSubstitutionRequests,
  protocols,
  users,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { strictSafeParse } from '../../core/validation/strict-input';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { PROTOCOL_OPTIONAL_REVIEW_WINDOW_MS } from '../protocol/review-hold.service';
import { AI_SUBSTITUTION_REVIEW_WINDOW_MS } from '../protocol/protocol-substitution-release.worker';
import {
  DashboardNotificationsService,
  type NotificationItem,
} from './dashboard-notifications.service';
import {
  DashboardService,
  protocolTitle,
  substitutionTitle,
  type NotificationType,
} from './dashboard.service';

export type HistoryOutcome = 'RESOLVED' | 'SIGNED' | 'AUTO_RELEASED' | 'RELEASED' | 'DISCARDED';

export interface NotificationHistoryItem extends NotificationItem {
  status: 'PENDING' | 'SETTLED';
  outcome: HistoryOutcome | null;
  settledAt: string | null;
}

const HISTORY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Ordem alfabética dos tipos = ordem do desempate do cursor. */
const TYPES: ReadonlyArray<NotificationType> = ['alert', 'protocol', 'substitution'];

const querySchema = z.object({
  state: z.enum(['all', 'unread']).default('all'),
  type: z.enum(['all', 'alert', 'queue']).default('all'),
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
const cursorSchema = z.object({
  c: z.iso.datetime(),
  t: z.enum(['alert', 'protocol', 'substitution']),
  i: z.uuid(),
});
type Cursor = z.infer<typeof cursorSchema>;

type Candidate = NotificationHistoryItem & { userId: string; sortMs: number };

@Injectable()
export class DashboardNotificationHistoryService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly dashboard: DashboardService,
    private readonly notifications: DashboardNotificationsService,
  ) {}

  async history(actor: AuthenticatedUser, rawQuery: unknown) {
    if (actor.role !== 'PROFESSIONAL' && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Acesso exclusivo ao CREF atribuído ou administrador.');
    }
    const query = this.parse(querySchema, rawQuery ?? {});
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null;
    const snapshotAt = new Date().toISOString();
    const windowStart = new Date(Date.now() - HISTORY_WINDOW_MS).toISOString();
    const wanted = (type: NotificationType) =>
      query.type === 'all' || (query.type === 'alert' ? type === 'alert' : type !== 'alert');

    const { page, hasMore } = await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      const candidates: Candidate[] = [];
      const ctx = { actor, cursor, windowStart, unreadOnly: query.state === 'unread' };
      const fetchLimit = query.limit + 1;
      if (wanted('alert')) candidates.push(...(await this.alerts(tx, ctx, fetchLimit)));
      if (wanted('protocol')) candidates.push(...(await this.protocols(tx, ctx, fetchLimit)));
      if (wanted('substitution')) {
        candidates.push(...(await this.substitutions(tx, ctx, fetchLimit)));
      }
      candidates.sort(
        (a, b) =>
          b.sortMs - a.sortMs ||
          TYPES.indexOf(b.type) - TYPES.indexOf(a.type) ||
          (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
      );
      const kept = candidates.slice(0, query.limit);

      const readKeys = await this.dashboard.readKeys(
        tx,
        actor,
        kept.map((item) => ({ type: item.type, id: item.id, createdAt: new Date(item.createdAt) })),
      );
      for (const item of kept) {
        // Decidido nunca é "não lido": só pendência pode estar esperando atenção.
        item.read = item.status === 'SETTLED' || readKeys.has(`${item.type}:${item.id}`);
      }
      // A lista revela o aluno ligado a um evento de saúde: leitura auditada por item.
      await Promise.all(
        kept.map((item) =>
          this.dashboard.auditRead(tx, actor, item.userId, AUDIT_ENTITY[item.type], item.id),
        ),
      );
      return { page: kept, hasMore: candidates.length > query.limit };
    });

    const last = page.at(-1);
    const counts = await this.notifications.summary(actor);
    return {
      snapshotAt,
      items: page.map(({ userId: _userId, sortMs: _sortMs, ...item }) => item),
      nextCursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({ c: new Date(last.sortMs).toISOString(), t: last.type, i: last.id }),
            ).toString('base64url')
          : null,
      unread: counts.unread,
      openSafety: counts.openSafety,
    };
  }

  private async alerts(tx: Tx, ctx: Ctx, limit: number): Promise<Candidate[]> {
    const created = this.truncated(handoffAlerts.createdAt);
    const pending = sql`${handoffAlerts.status} = 'OPEN'`;
    const rows = await tx
      .select({
        id: handoffAlerts.id,
        userId: handoffAlerts.userId,
        studentName: users.name,
        level: handoffAlerts.level,
        reason: handoffAlerts.reason,
        sourceType: handoffAlerts.sourceType,
        status: handoffAlerts.status,
        createdAt: handoffAlerts.createdAt,
        updatedAt: handoffAlerts.updatedAt,
      })
      .from(handoffAlerts)
      .innerJoin(users, eq(users.id, handoffAlerts.userId))
      .where(
        and(
          or(eq(handoffAlerts.status, 'OPEN'), eq(handoffAlerts.status, 'RESOLVED')),
          this.inWindow(pending, handoffAlerts.createdAt, ctx),
          ctx.unreadOnly
            ? and(pending, this.unread(ctx, 'alert', handoffAlerts.id, handoffAlerts.createdAt))
            : undefined,
          this.afterCursor(ctx.cursor, 'alert', created, handoffAlerts.id),
        ),
      )
      .orderBy(desc(created), desc(handoffAlerts.id))
      .limit(limit);
    return rows.map((row) => {
      const isPending = row.status === 'OPEN';
      return {
        ...this.base('alert', row.id, row.userId, row.createdAt),
        level: row.level,
        title: null,
        studentName: row.studentName ?? null,
        reason: row.reason,
        sourceType: row.sourceType ?? null,
        section: null,
        origin: null,
        autoReleaseAt: null,
        status: isPending ? 'PENDING' : 'SETTLED',
        outcome: isPending ? null : 'RESOLVED',
        settledAt: isPending ? null : row.updatedAt.toISOString(),
      };
    });
  }

  private async protocols(tx: Tx, ctx: Ctx, limit: number): Promise<Candidate[]> {
    const created = this.truncated(protocols.createdAt);
    const pending = sql`${protocols.approvalStatus} = 'PENDING_REVIEW'`;
    const rows = await tx
      .select({
        id: protocols.id,
        userId: protocols.userId,
        name: users.name,
        createdAt: protocols.createdAt,
        updatedAt: protocols.updatedAt,
        signedAt: protocols.signedAt,
        approvalStatus: protocols.approvalStatus,
        reviewUrgency: protocols.reviewUrgency,
        generatedBy: protocols.generatedBy,
        parqState: anamnesisSessions.parqState,
      })
      .from(protocols)
      .innerJoin(users, eq(users.id, protocols.userId))
      .leftJoin(anamnesisSessions, eq(anamnesisSessions.id, protocols.anamnesisSessionId))
      .where(
        and(
          // Só protocolo que passou pela fila: `review_urgency` nulo é aprovação automática de origem.
          isNotNull(protocols.reviewUrgency),
          inArray(protocols.approvalStatus, ['PENDING_REVIEW', 'HUMAN_APPROVED', 'AUTO_APPROVED']),
          this.inWindow(pending, protocols.createdAt, ctx),
          ctx.unreadOnly
            ? and(pending, this.unread(ctx, 'protocol', protocols.id, protocols.createdAt))
            : undefined,
          this.afterCursor(ctx.cursor, 'protocol', created, protocols.id),
        ),
      )
      .orderBy(desc(created), desc(protocols.id))
      .limit(limit);
    return rows.map((row) => {
      const isPending = row.approvalStatus === 'PENDING_REVIEW';
      const optional = row.reviewUrgency === 'OPTIONAL';
      const fromParq = row.parqState === 'BLOQUEADO_AGUARDANDO_CLEARANCE';
      const signed = row.approvalStatus === 'HUMAN_APPROVED';
      return {
        ...this.base('protocol', row.id, row.userId, row.createdAt),
        level: null,
        title: protocolTitle(row.name),
        studentName: row.name ?? null,
        reason: null,
        sourceType: null,
        section: optional ? 'OPTIONAL' : 'MANDATORY',
        origin:
          isPending && !optional
            ? fromParq
              ? 'PARQ'
              : row.generatedBy === 'FALLBACK_TEMPLATE'
                ? 'FALLBACK'
                : 'EDIT'
            : null,
        autoReleaseAt:
          isPending && optional
            ? new Date(row.createdAt.getTime() + PROTOCOL_OPTIONAL_REVIEW_WINDOW_MS).toISOString()
            : null,
        status: isPending ? 'PENDING' : 'SETTLED',
        outcome: isPending ? null : signed ? 'SIGNED' : 'AUTO_RELEASED',
        settledAt: isPending ? null : (row.signedAt ?? row.updatedAt).toISOString(),
      };
    });
  }

  private async substitutions(tx: Tx, ctx: Ctx, limit: number): Promise<Candidate[]> {
    const created = this.truncated(protocolSubstitutionRequests.createdAt);
    const pending = sql`${protocolSubstitutionRequests.status} = 'PENDING'`;
    const rows = await tx
      .select({
        id: protocolSubstitutionRequests.id,
        userId: protocolSubstitutionRequests.userId,
        name: users.name,
        createdAt: protocolSubstitutionRequests.createdAt,
        updatedAt: protocolSubstitutionRequests.updatedAt,
        decidedAt: protocolSubstitutionRequests.decidedAt,
        status: protocolSubstitutionRequests.status,
        reviewUrgency: protocolSubstitutionRequests.reviewUrgency,
        catalogGap: protocolSubstitutionRequests.catalogGap,
        parqState: anamnesisSessions.parqState,
      })
      .from(protocolSubstitutionRequests)
      .innerJoin(users, eq(users.id, protocolSubstitutionRequests.userId))
      .leftJoin(protocols, eq(protocols.id, protocolSubstitutionRequests.protocolId))
      .leftJoin(anamnesisSessions, eq(anamnesisSessions.id, protocols.anamnesisSessionId))
      .where(
        and(
          this.inWindow(pending, protocolSubstitutionRequests.createdAt, ctx),
          ctx.unreadOnly
            ? and(
                pending,
                this.unread(
                  ctx,
                  'substitution',
                  protocolSubstitutionRequests.id,
                  protocolSubstitutionRequests.createdAt,
                ),
              )
            : undefined,
          this.afterCursor(ctx.cursor, 'substitution', created, protocolSubstitutionRequests.id),
        ),
      )
      .orderBy(desc(created), desc(protocolSubstitutionRequests.id))
      .limit(limit);
    return rows.map((row) => {
      const isPending = row.status === 'PENDING';
      const mandatory =
        row.parqState === 'BLOQUEADO_AGUARDANDO_CLEARANCE' || row.reviewUrgency === 'MANDATORY';
      return {
        ...this.base('substitution', row.id, row.userId, row.createdAt),
        level: null,
        title: substitutionTitle(row.name),
        studentName: row.name ?? null,
        reason: null,
        sourceType: null,
        section: mandatory ? 'MANDATORY' : 'OPTIONAL',
        origin: isPending ? (row.catalogGap ? 'CATALOG_GAP' : 'AI_SUBSTITUTION') : null,
        autoReleaseAt:
          isPending && !mandatory
            ? new Date(row.createdAt.getTime() + AI_SUBSTITUTION_REVIEW_WINDOW_MS).toISOString()
            : null,
        status: isPending ? 'PENDING' : 'SETTLED',
        outcome: isPending ? null : row.status === 'RELEASED' ? 'RELEASED' : 'DISCARDED',
        settledAt: isPending ? null : (row.decidedAt ?? row.updatedAt).toISOString(),
      };
    });
  }

  private base(type: NotificationType, id: string, userId: string, createdAt: Date) {
    return {
      type,
      id,
      userId,
      read: false,
      createdAt: createdAt.toISOString(),
      // `Date` já tem precisão de milissegundo, a mesma do `date_trunc` usado na consulta.
      sortMs: createdAt.getTime(),
    };
  }

  /** `created_at` em milissegundos, a precisão que o cursor consegue carregar. */
  private truncated(column: PgColumn): SQL<Date> {
    return sql<Date>`date_trunc('milliseconds', ${column})`;
  }

  /** Pendente (sem limite de idade) ou criado dentro da janela de 30 dias. */
  private inWindow(pending: SQL, createdAt: PgColumn, ctx: Ctx): SQL {
    return sql`(${pending} OR ${createdAt} >= ${ctx.windowStart}::timestamptz)`;
  }

  private unread(ctx: Ctx, kind: NotificationType, idColumn: PgColumn, createdAt: PgColumn): SQL {
    return sql`not exists (
      select 1 from ${dashboardNotificationReads} r
      where r.user_id = ${ctx.actor.userId}::uuid and r.kind = ${kind}
        and r.ref_id = ${idColumn} and r.read_at >= ${createdAt}
    )`;
  }

  /** Itens depois do cursor na ordem `(createdAt, tipo, id)` decrescente. */
  private afterCursor(
    cursor: Cursor | null,
    type: NotificationType,
    created: SQL,
    idColumn: PgColumn,
  ): SQL | undefined {
    if (!cursor) return undefined;
    const at = sql`${cursor.c}::timestamptz`;
    if (type === cursor.t) {
      return sql`(${created} < ${at} OR (${created} = ${at} AND ${idColumn} < ${cursor.i}::uuid))`;
    }
    return TYPES.indexOf(type) < TYPES.indexOf(cursor.t)
      ? sql`${created} <= ${at}`
      : sql`${created} < ${at}`;
  }

  private decodeCursor(raw: string): Cursor {
    try {
      const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(raw, 'base64url').toString()));
      if (parsed.success) return parsed.data;
    } catch {
      // cai no erro abaixo
    }
    throw new BadRequestException({ code: 'INVALID_INPUT', message: 'Cursor inválido.' });
  }

  private parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = strictSafeParse(schema, input);
    if (!result.success)
      throw new BadRequestException({ code: 'INVALID_INPUT', issues: result.error.issues });
    return result.data;
  }
}

const AUDIT_ENTITY: Record<NotificationType, string> = {
  alert: 'handoff_alert',
  protocol: 'protocol',
  substitution: 'protocol_substitution_request',
};

interface Ctx {
  actor: AuthenticatedUser;
  cursor: Cursor | null;
  windowStart: string;
  unreadOnly: boolean;
}
type Tx = Parameters<Parameters<TenantDatabase['runAsUser']>[2]>[0];
