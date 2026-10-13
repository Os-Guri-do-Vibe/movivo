/**
 * Notificações do sino do dashboard: alertas do AI Coach + itens da Fila do Profissional,
 * com estado "lido" POR PROFISSIONAL (`dashboard_notification_reads`).
 *
 * Ler ≠ resolver: este serviço nunca altera alerta, protocolo ou substituição. Só registra
 * que a conta já abriu o item. Um item é não lido quando está pendente e a conta não tem
 * leitura registrada depois do momento em que ele nasceu (`read_at >= created_at`).
 */
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { and, count, eq, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';

import {
  dashboardNotificationReads,
  handoffAlerts,
  protocolSubstitutionRequests,
  protocols,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { strictSafeParse } from '../../core/validation/strict-input';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { DashboardService, type NotificationType, type QueueItem } from './dashboard.service';

export type { NotificationType };

export interface NotificationItem {
  type: NotificationType;
  id: string;
  read: boolean;
  createdAt: string;
  /** Só alertas. A Fila não tem nível: obrigatório e opcional têm a mesma urgência visual. */
  level: 'SAFETY' | 'ALERT' | null;
  /** Título pronto vindo da fila (protocolo/substituição/treino); alertas usam `reason`. */
  title: string | null;
  studentName: string | null;
  reason: string | null;
  sourceType: string | null;
  section: 'MANDATORY' | 'OPTIONAL' | null;
  origin: QueueItem['origin'];
  autoReleaseAt: string | null;
}

/** Quantos itens o popover do sino mostra; o restante fica nas listas completas. */
const POPOVER_LIMIT = 8;

const markReadSchema = z.object({
  type: z.enum(['alert', 'protocol', 'substitution']),
  id: z.uuid(),
});
const markAllSchema = z.object({ until: z.iso.datetime() });

@Injectable()
export class DashboardNotificationsService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly dashboard: DashboardService,
  ) {}

  /** Contagens para o badge: sem PII, barato o bastante para o polling do cabeçalho. */
  async summary(actor: AuthenticatedUser) {
    this.assertStaff(actor);
    return this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      const unreadAlerts = this.unreadClause(
        actor,
        'alert',
        handoffAlerts.id,
        handoffAlerts.createdAt,
      );
      const unreadProtocols = this.unreadClause(
        actor,
        'protocol',
        protocols.id,
        protocols.createdAt,
      );
      const unreadSubstitutions = this.unreadClause(
        actor,
        'substitution',
        protocolSubstitutionRequests.id,
        protocolSubstitutionRequests.createdAt,
      );
      const [[alerts], [safety], [protocolRows], [substitutions]] = await Promise.all([
        tx
          .select({ total: count() })
          .from(handoffAlerts)
          .where(and(eq(handoffAlerts.status, 'OPEN'), unreadAlerts)),
        tx
          .select({ total: count() })
          .from(handoffAlerts)
          .where(and(eq(handoffAlerts.status, 'OPEN'), eq(handoffAlerts.level, 'SAFETY'))),
        tx
          .select({ total: count() })
          .from(protocols)
          .where(and(eq(protocols.approvalStatus, 'PENDING_REVIEW'), unreadProtocols)),
        tx
          .select({ total: count() })
          .from(protocolSubstitutionRequests)
          .where(and(eq(protocolSubstitutionRequests.status, 'PENDING'), unreadSubstitutions)),
      ]);
      return {
        unread:
          Number(alerts?.total ?? 0) +
          Number(protocolRows?.total ?? 0) +
          Number(substitutions?.total ?? 0),
        openSafety: Number(safety?.total ?? 0),
      };
    });
  }

  /**
   * Itens do popover: não lidos primeiro, depois lidos, cada grupo do mais novo ao mais
   * antigo — assim o limite nunca empurra um não lido para fora da lista.
   */
  async list(actor: AuthenticatedUser) {
    this.assertStaff(actor);
    // Hora do servidor: é o corte do "marcar todas como lidas", sem depender do relógio do navegador.
    const snapshotAt = new Date().toISOString();
    const [alerts, queue] = await Promise.all([
      this.dashboard.alerts(actor),
      this.dashboard.queue(actor),
    ]);
    // Dor após o treino aparece nos Alertas e também na Fila: no sino, só uma vez.
    const alertIds = new Set(alerts.open.map((alert) => alert.id));
    const queueItems = [
      ...queue.mandatory.map((item) => ({ item, section: 'MANDATORY' as const })),
      ...queue.optional.map((item) => ({ item, section: 'OPTIONAL' as const })),
      ...queue.substitutionMandatory.map((item) => ({ item, section: 'MANDATORY' as const })),
      ...queue.substitutionOptional.map((item) => ({ item, section: 'OPTIONAL' as const })),
    ].filter(({ item }) => !(item.kind === 'HANDOFF' && alertIds.has(item.id)));

    const items: NotificationItem[] = [
      ...alerts.open.map((alert) => ({
        type: 'alert' as const,
        id: alert.id,
        read: alert.read,
        createdAt: alert.createdAt,
        level: alert.level,
        title: null,
        studentName: alert.studentName,
        reason: alert.reason,
        sourceType: alert.sourceType,
        section: null,
        origin: null,
        autoReleaseAt: null,
      })),
      ...queueItems.map(({ item, section }) => {
        // Handoff de treino mora na fila, mas é um alerta: a tela de detalhe é a do alerta.
        const isAlert = item.kind === 'HANDOFF';
        return {
          type: isAlert
            ? ('alert' as const)
            : item.kind === 'SUBSTITUTION'
              ? ('substitution' as const)
              : ('protocol' as const),
          id: item.id,
          read: item.read,
          createdAt: item.createdAt,
          level: isAlert
            ? item.severity === 'SAFETY'
              ? ('SAFETY' as const)
              : ('ALERT' as const)
            : null,
          title: item.title,
          studentName: null,
          reason: isAlert ? item.summary : null,
          sourceType: isAlert ? 'WORKOUT' : null,
          section: isAlert ? null : section,
          origin: item.origin,
          autoReleaseAt: item.autoReleaseAt,
        };
      }),
    ];

    items.sort(
      (a, b) =>
        Number(a.read) - Number(b.read) ||
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return {
      snapshotAt,
      items: items.slice(0, POPOVER_LIMIT),
      totalPending: items.length,
      unread: items.filter((item) => !item.read).length,
      openSafety: items.filter((item) => item.type === 'alert' && item.level === 'SAFETY').length,
    };
  }

  /** Idempotente: abrir o mesmo item de novo só renova `read_at`. */
  async markRead(actor: AuthenticatedUser, body: unknown) {
    this.assertStaff(actor);
    const input = this.parse(markReadSchema, body);
    await this.db.runAsUser(actor.userId, actor.role, (tx) =>
      tx
        .insert(dashboardNotificationReads)
        .values({ userId: actor.userId, kind: input.type, refId: input.id })
        .onConflictDoUpdate({
          target: [
            dashboardNotificationReads.userId,
            dashboardNotificationReads.kind,
            dashboardNotificationReads.refId,
          ],
          set: { readAt: sql`now()` },
        }),
    );
    return { ok: true as const };
  }

  /**
   * Marca como lido tudo o que está pendente e já existia em `until` (o instante do retrato
   * que a pessoa estava vendo): um item que chega durante o clique continua não lido.
   */
  async markAllRead(actor: AuthenticatedUser, body: unknown) {
    this.assertStaff(actor);
    const input = this.parse(markAllSchema, body);
    const until = new Date(Math.min(new Date(input.until).getTime(), Date.now()));
    await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      for (const source of this.pendingSources()) {
        await tx.execute(sql`
          INSERT INTO ${dashboardNotificationReads} (user_id, kind, ref_id, read_at)
          SELECT ${actor.userId}::uuid, ${source.kind}::varchar, ${source.id}, now()
          FROM ${source.table}
          WHERE ${source.pending} AND ${source.createdAt} <= ${until.toISOString()}::timestamptz
          ON CONFLICT (user_id, kind, ref_id) DO UPDATE SET read_at = EXCLUDED.read_at
        `);
      }
    });
    return { ok: true as const };
  }

  /** De onde vêm as pendências do sino; a mesma definição de "pendente" da fila e dos alertas. */
  private pendingSources() {
    return [
      {
        kind: 'alert',
        table: handoffAlerts,
        id: handoffAlerts.id,
        createdAt: handoffAlerts.createdAt,
        pending: sql`${handoffAlerts.status} = 'OPEN'`,
      },
      {
        kind: 'protocol',
        table: protocols,
        id: protocols.id,
        createdAt: protocols.createdAt,
        pending: sql`${protocols.approvalStatus} = 'PENDING_REVIEW'`,
      },
      {
        kind: 'substitution',
        table: protocolSubstitutionRequests,
        id: protocolSubstitutionRequests.id,
        createdAt: protocolSubstitutionRequests.createdAt,
        pending: sql`${protocolSubstitutionRequests.status} = 'PENDING'`,
      },
    ] as const;
  }

  /** Predicado "não lido" para as contagens: não existe leitura desta conta após a criação. */
  private unreadClause(
    actor: AuthenticatedUser,
    kind: NotificationType,
    idColumn: PgColumn,
    createdAtColumn: PgColumn,
  ): SQL {
    return sql`not exists (
      select 1 from ${dashboardNotificationReads} r
      where r.user_id = ${actor.userId}::uuid and r.kind = ${kind}
        and r.ref_id = ${idColumn} and r.read_at >= ${createdAtColumn}
    )`;
  }

  private assertStaff(actor: AuthenticatedUser): void {
    if (actor.role !== 'PROFESSIONAL' && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Acesso exclusivo ao CREF atribuído ou administrador.');
    }
  }

  private parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = strictSafeParse(schema, input);
    if (!result.success)
      throw new BadRequestException({ code: 'INVALID_INPUT', issues: result.error.issues });
    return result.data;
  }
}
