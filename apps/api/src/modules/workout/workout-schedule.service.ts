/**
 * `WorkoutScheduleService` — a camada de banco da agenda flexível.
 *
 * Carrega os ajustes ativos (`workout_schedule_adjustments`), monta a semana efetiva do aluno
 * para o planejador (`schedule-planner.ts`), grava um ajuste e o desfaz. O arranjo em si sai
 * do planejador puro; aqui só há leitura, escrita atômica e a limpeza do que o ajuste invalida.
 *
 * ## O que um ajuste invalida
 * O diário cria a linha `workout_sessions` do dia quando o link é aberto (ou enviado), com um
 * snapshot da prescrição daquele dia. Se o dia muda de sessão, essa linha `PLANNED` fica velha
 * — e o `dayStatus` trataria uma linha `PLANNED` de dia passado como treino sem registro. Por
 * isso o ajuste apaga as linhas `PLANNED` das datas afetadas (nunca `IN_PROGRESS`/`COMPLETED`,
 * que o planejador já trava), revoga os links que apontavam para elas e desanexa as pendências
 * de conversa. O diário recria a linha certa quando o novo link é aberto.
 */
import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { protocolStructureSchema, type ProtocolStructure } from '@movivo/shared';

import {
  conversationFollowups,
  protocols,
  subscriptions,
  users,
  workoutAccessTokens,
  workoutScheduleAdjustments,
  workoutSessions,
  type ScheduleAdjustmentKind,
  type ScheduleAdjustmentSource,
  type ScheduleAssignment,
} from '../../core/database/schema';
import {
  TenantDatabase,
  type TenantTransaction,
} from '../../core/database/tenant-database.service';
import {
  buildWeekSlots,
  type PlanSuccess,
  type ScheduleOverrides,
  type SessionRowSummary,
  type WeekSlot,
  weekDates,
  weekStartMonday,
} from './schedule-planner';
import { loadScheduleOverrides } from './schedule-overrides';
import { localParts } from './workout-eligibility';

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/** Fotografia da semana do aluno que o fluxo de conversa usa para planejar e responder. */
export interface ScheduleContext {
  userId: string;
  name: string | null;
  timezone: string;
  today: string;
  /** Hora local `HH:mm`, para a saudação. */
  localTime: string;
  protocolId: string;
  structure: ProtocolStructure;
  /** Treinos por semana contratados. */
  quota: number;
  firstProtocolDate: string;
  slots: WeekSlot[];
  /** Ajustes ativos (data → sessão), para quem precisa do calendário efetivo de um dia travado. */
  overrides?: ScheduleOverrides;
}

export type UndoResult =
  | { status: 'UNDONE'; restored: Array<{ date: string; sessionKey: string | null }> }
  | { status: 'NOTHING_TO_UNDO' }
  | { status: 'ALREADY_USED' };

function localDateOf(instant: Date, timezone: string): string {
  return localParts(instant, timezone)?.date ?? instant.toISOString().slice(0, 10);
}

@Injectable()
export class WorkoutScheduleService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WorkoutScheduleService.name);
  }

  /** Ver `loadScheduleOverrides`; mantido aqui para quem já injeta o serviço. */
  loadOverrides(
    tx: TenantTransaction,
    userId: string,
    protocolId: string,
    now = new Date(),
  ): Promise<Map<string, string | null>> {
    return loadScheduleOverrides(tx, userId, protocolId, now);
  }

  /**
   * A semana (segunda a domingo) de `now` com o calendário efetivo; `null` sem protocolo/assinatura
   * ativos. Com `anchorDate`, a semana é a que contém essa data (registro tardio de um dia que
   * pode estar na semana anterior); `today` segue sendo o dia de hoje do aluno.
   */
  async weekContext(
    userId: string,
    now = new Date(),
    anchorDate?: string,
  ): Promise<ScheduleContext | null> {
    return this.db.runAsSystem(async (tx) => {
      const [owner] = await tx
        .select({
          name: users.name,
          timezone: users.timezone,
          protocolId: protocols.id,
          content: protocols.content,
          startDate: protocols.startDate,
          firstStartDate: sql<
            string | null
          >`(select to_char(min(p.start_date) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from protocols p where p.user_id = ${users.id})`.mapWith(
            (value: string | null) => (value ? new Date(value) : null),
          ),
        })
        .from(users)
        .innerJoin(protocols, eq(protocols.userId, users.id))
        .innerJoin(subscriptions, eq(subscriptions.userId, users.id))
        .where(
          and(
            eq(users.id, userId),
            eq(protocols.status, 'ACTIVE'),
            inArray(subscriptions.status, ['ACTIVE', 'TRIALING']),
          ),
        )
        .orderBy(desc(protocols.createdAt))
        .limit(1);
      if (!owner) return null;
      const parsed = protocolStructureSchema.safeParse(owner.content);
      if (!parsed.success) return null;

      const timezone = owner.timezone || DEFAULT_TIMEZONE;
      const local = localParts(now, timezone) ?? localParts(now, DEFAULT_TIMEZONE);
      if (!local) return null;
      const dates = weekDates(anchorDate ?? local.date);
      const rows = await tx
        .select({
          date: workoutSessions.scheduledDate,
          status: workoutSessions.status,
          sessionKey: workoutSessions.sessionKey,
          createdAt: workoutSessions.createdAt,
        })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.userId, userId),
            gte(workoutSessions.scheduledDate, dates[0] as string),
            lte(workoutSessions.scheduledDate, dates[6] as string),
          ),
        )
        .orderBy(desc(workoutSessions.createdAt));
      const sessionsByDate = new Map<string, SessionRowSummary>();
      const rank = { COMPLETED: 2, IN_PROGRESS: 1, PLANNED: 0 } as const;
      for (const row of rows) {
        const current = sessionsByDate.get(row.date);
        if (!current || rank[row.status] > rank[current.status]) {
          sessionsByDate.set(row.date, { status: row.status, sessionKey: row.sessionKey });
        }
      }
      const overrides: ScheduleOverrides = await this.loadOverrides(
        tx,
        userId,
        owner.protocolId,
        now,
      );
      const firstProtocolDate = localDateOf(owner.firstStartDate ?? owner.startDate, timezone);
      return {
        userId,
        name: owner.name,
        timezone,
        today: local.date,
        localTime: local.time,
        protocolId: owner.protocolId,
        structure: parsed.data,
        quota: parsed.data.weeklyFrequency,
        firstProtocolDate,
        overrides,
        slots: buildWeekSlots({
          today: local.date,
          anchor: anchorDate,
          firstProtocolDate,
          structure: parsed.data,
          overrides,
          sessionsByDate,
        }),
      };
    });
  }

  /**
   * Grava o ajuste e limpa o que ele invalida, numa transação, sob lock por aluno. Idempotente
   * por `idempotencyKey` (o retry do job de resposta não aplica duas vezes). Devolve o id e se
   * esta chamada de fato gravou algo.
   */
  async apply(
    userId: string,
    context: Pick<ScheduleContext, 'protocolId'>,
    plan: PlanSuccess,
    meta: {
      kind: ScheduleAdjustmentKind;
      source?: ScheduleAdjustmentSource;
      idempotencyKey?: string;
    },
  ): Promise<{ adjustmentId: string | null; created: boolean }> {
    if (plan.changes.length === 0 && plan.dropped.length === 0) {
      return { adjustmentId: null, created: false };
    }
    return this.db.runAsSystem(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`schedule:${userId}`}, 0))`,
      );
      if (meta.idempotencyKey) {
        const [existing] = await tx
          .select({ id: workoutScheduleAdjustments.id })
          .from(workoutScheduleAdjustments)
          .where(
            and(
              eq(workoutScheduleAdjustments.userId, userId),
              eq(workoutScheduleAdjustments.idempotencyKey, meta.idempotencyKey),
            ),
          )
          .limit(1);
        if (existing) return { adjustmentId: existing.id, created: false };
      }
      const assignments: ScheduleAssignment[] = plan.changes.map((change) => ({
        date: change.date,
        sessionKey: change.to,
        from: change.from,
      }));
      const [row] = await tx
        .insert(workoutScheduleAdjustments)
        .values({
          userId,
          protocolId: context.protocolId,
          kind: meta.kind,
          source: meta.source ?? 'CHAT',
          assignments,
          dropped: plan.dropped,
          idempotencyKey: meta.idempotencyKey ?? null,
        })
        .returning({ id: workoutScheduleAdjustments.id });
      await this.discardPlannedSessions(
        tx,
        userId,
        assignments.map((assignment) => assignment.date),
      );
      this.logger.info(
        {
          event: 'schedule_adjustment_applied',
          userId,
          kind: meta.kind,
          dates: assignments.length,
          dropped: plan.dropped.length,
        },
        'ajuste de agenda aplicado',
      );
      return { adjustmentId: row?.id ?? null, created: true };
    });
  }

  /**
   * Desfaz o último ajuste ativo DA SEMANA CORRENTE. O ajuste vale até domingo e expira sozinho: na
   * segunda seguinte "desfazer" não tem o que desfazer, e nunca reescreve a semana que já passou.
   * Também só enquanto nenhuma das datas dele já virou treino (concluído ou em andamento).
   */
  async undoLast(userId: string, now = new Date()): Promise<UndoResult> {
    return this.db.runAsSystem(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`schedule:${userId}`}, 0))`,
      );
      const [owner] = await tx
        .select({ timezone: users.timezone })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const currentWeekStart = weekStartMonday(
        localDateOf(now, owner?.timezone || DEFAULT_TIMEZONE),
      );
      const [last] = await tx
        .select()
        .from(workoutScheduleAdjustments)
        .where(
          and(
            eq(workoutScheduleAdjustments.userId, userId),
            isNull(workoutScheduleAdjustments.undoneAt),
            eq(workoutScheduleAdjustments.source, 'CHAT'),
          ),
        )
        .orderBy(desc(workoutScheduleAdjustments.createdAt))
        .limit(1);
      if (!last) return { status: 'NOTHING_TO_UNDO' };
      const dates = last.assignments.map((assignment) => assignment.date);
      if (dates.some((date) => date < currentWeekStart)) return { status: 'NOTHING_TO_UNDO' };
      const used = await tx
        .select({ id: workoutSessions.id })
        .from(workoutSessions)
        .where(
          and(
            eq(workoutSessions.userId, userId),
            inArray(workoutSessions.scheduledDate, dates),
            inArray(workoutSessions.status, ['IN_PROGRESS', 'COMPLETED']),
          ),
        )
        .limit(1);
      if (used.length > 0) {
        return { status: 'ALREADY_USED' };
      }
      await tx
        .update(workoutScheduleAdjustments)
        .set({ undoneAt: new Date() })
        .where(eq(workoutScheduleAdjustments.id, last.id));
      await this.discardPlannedSessions(tx, userId, dates);
      return {
        status: 'UNDONE',
        restored: last.assignments.map((assignment) => ({
          date: assignment.date,
          sessionKey: assignment.from,
        })),
      };
    });
  }

  /**
   * Apaga as linhas `PLANNED` das datas (sem série nenhuma: `saveSets` exige treino em
   * andamento), revoga os links que apontavam para elas e solta as pendências de conversa.
   */
  async discardPlannedSessions(
    tx: TenantTransaction,
    userId: string,
    dates: readonly string[],
  ): Promise<void> {
    if (dates.length === 0) return;
    const planned = await tx
      .select({ id: workoutSessions.id })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.userId, userId),
          inArray(workoutSessions.scheduledDate, [...dates]),
          eq(workoutSessions.status, 'PLANNED'),
        ),
      );
    if (planned.length === 0) return;
    const ids = planned.map((row) => row.id);
    await tx
      .update(workoutAccessTokens)
      .set({ revokedAt: new Date(), workoutSessionId: null })
      .where(
        and(
          eq(workoutAccessTokens.userId, userId),
          inArray(workoutAccessTokens.workoutSessionId, ids),
        ),
      );
    await tx
      .update(conversationFollowups)
      .set({ workoutSessionId: null })
      .where(
        and(
          eq(conversationFollowups.userId, userId),
          inArray(conversationFollowups.workoutSessionId, ids),
        ),
      );
    await tx.delete(workoutSessions).where(inArray(workoutSessions.id, ids));
  }
}
