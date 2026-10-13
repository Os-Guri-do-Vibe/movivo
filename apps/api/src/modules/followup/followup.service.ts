/**
 * `FollowupService` — pendências de conversa do Coach (ver `conversation-followups.ts`).
 *
 * Módulo sem LLM e sem regra de treino: só guarda e transita o estado de "o Coach fez uma
 * pergunta e espera resposta". Quem decide quando perguntar é o `WorkoutModule`; quem decide
 * se uma mensagem do aluno responde é o `CoachModule`. Todas as transições são `UPDATE ...
 * WHERE status = <origem>`, então retry de fila ou duas execuções simultâneas são inofensivos.
 */
import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, gte, lte } from 'drizzle-orm';

import {
  conversationFollowups,
  type ConversationFollowupRow,
  type FollowupKind,
} from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';

/** Reserva sem envio confirmado: depois disso vira `NOT_SENT` (só métrica). */
export const FOLLOWUP_RESERVATION_TTL_MS = 24 * 3_600_000;
/** Quanto tempo uma pergunta entregue continua valendo para interpretar a resposta. */
export const FOLLOWUP_OPEN_TTL_MS = 72 * 3_600_000;
/** Janela lida por `recentSummary` (uma semana de teto + folga para o fuso). */
const RECENT_WINDOW_MS = 8 * 24 * 3_600_000;
const WEEK_MS = 7 * 24 * 3_600_000;
/** Teto de pendências levadas ao contexto do Coach. */
const CONTEXT_LIMIT = 3;

export interface ReserveFollowupInput {
  kind: FollowupKind;
  /** Dia civil (`YYYY-MM-DD`, fuso do aluno) do treino sobre o qual a pergunta trata. */
  subjectDate: string;
  sessionKey: string | null;
  workoutSessionId: string | null;
  protocolId: string | null;
  topicLabel: string;
}

@Injectable()
export class FollowupService {
  constructor(private readonly db: TenantDatabase) {}

  /**
   * Cria a pendência ANTES do envio. A chave única (aluno, tipo, dia) é a idempotência:
   * uma segunda chamada devolve a linha que já existe, sem criar outra.
   */
  async reserve(
    userId: string,
    input: ReserveFollowupInput,
    now = new Date(),
  ): Promise<ConversationFollowupRow> {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      await tx
        .insert(conversationFollowups)
        .values({
          userId,
          ...input,
          expiresAt: new Date(now.getTime() + FOLLOWUP_RESERVATION_TTL_MS),
        })
        .onConflictDoNothing();
      const [row] = await tx
        .select()
        .from(conversationFollowups)
        .where(
          and(
            eq(conversationFollowups.userId, userId),
            eq(conversationFollowups.kind, input.kind),
            eq(conversationFollowups.subjectDate, input.subjectDate),
          ),
        )
        .limit(1);
      if (!row) throw new Error('followup: linha não encontrada logo após a reserva');
      return row;
    });
  }

  /**
   * Resumo das perguntas recentes de um tipo, numa consulta só (a decisão das 04:00 precisa de
   * três fatos: há pergunta aberta?, quantas foram entregues na última semana?, quando foi a
   * última?). A expiração é avaliada aqui, sem cron: `OPEN` vencida não conta como aberta.
   */
  async recentSummary(
    userId: string,
    kind: FollowupKind,
    now = new Date(),
  ): Promise<{ hasOpen: boolean; deliveredLast7d: number; lastDeliveredAt: Date | null }> {
    const since = new Date(now.getTime() - RECENT_WINDOW_MS);
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({
          status: conversationFollowups.status,
          deliveredAt: conversationFollowups.deliveredAt,
          expiresAt: conversationFollowups.expiresAt,
        })
        .from(conversationFollowups)
        .where(
          and(
            eq(conversationFollowups.userId, userId),
            eq(conversationFollowups.kind, kind),
            gte(conversationFollowups.createdAt, since),
          ),
        ),
    );
    const weekAgo = now.getTime() - WEEK_MS;
    let deliveredLast7d = 0;
    let lastDeliveredAt: Date | null = null;
    let hasOpen = false;
    for (const row of rows) {
      if (row.status === 'OPEN' && row.expiresAt.getTime() > now.getTime()) hasOpen = true;
      if (!row.deliveredAt) continue;
      if (row.deliveredAt.getTime() >= weekAgo) deliveredLast7d += 1;
      if (!lastDeliveredAt || row.deliveredAt > lastDeliveredAt) lastDeliveredAt = row.deliveredAt;
    }
    return { hasOpen, deliveredLast7d, lastDeliveredAt };
  }

  /** O worker de saída só envia se a reserva continua `PENDING_SEND` (não foi cancelada). */
  async isSendable(userId: string, id: string): Promise<boolean> {
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select({ status: conversationFollowups.status })
        .from(conversationFollowups)
        .where(and(eq(conversationFollowups.id, id), eq(conversationFollowups.userId, userId)))
        .limit(1),
    );
    return rows[0]?.status === 'PENDING_SEND';
  }

  /** Envio confirmado pelo WhatsApp: a pergunta passa a valer por 72h. */
  async markDelivered(userId: string, id: string, now = new Date()): Promise<boolean> {
    return this.transition(userId, id, 'PENDING_SEND', {
      status: 'OPEN',
      deliveredAt: now,
      expiresAt: new Date(now.getTime() + FOLLOWUP_OPEN_TTL_MS),
    });
  }

  /** O envio não vai acontecer (consentimento revogado, sem telefone). */
  async markNotSent(userId: string, id: string, now = new Date()): Promise<boolean> {
    return this.transition(userId, id, 'PENDING_SEND', { status: 'NOT_SENT', resolvedAt: now });
  }

  /** O Coach respondeu à mensagem do aluno com a pendência no contexto. */
  async markAnswered(userId: string, id: string, now = new Date()): Promise<boolean> {
    return this.transition(userId, id, 'OPEN', { status: 'ANSWERED', resolvedAt: now });
  }

  /**
   * O aluno registrou o treino do dia `workoutDate`: ele VOLTOU. Toda pergunta sobre um dia
   * até essa data deixa de fazer sentido. Reserva ainda não enviada é cancelada (o link
   * atrasado sai sem a pergunta); pergunta já entregue vira `RESUMED`.
   */
  async resolveForWorkout(
    userId: string,
    workoutDate: string,
    now = new Date(),
  ): Promise<{ cancelled: number; resumed: number }> {
    return this.db.runAsUser(userId, 'USER', async (tx) => {
      const where = (status: 'PENDING_SEND' | 'OPEN') =>
        and(
          eq(conversationFollowups.userId, userId),
          lte(conversationFollowups.subjectDate, workoutDate),
          eq(conversationFollowups.status, status),
        );
      const cancelled = await tx
        .update(conversationFollowups)
        .set({ status: 'CANCELLED', resolvedAt: now })
        .where(where('PENDING_SEND'))
        .returning({ id: conversationFollowups.id });
      const resumed = await tx
        .update(conversationFollowups)
        .set({ status: 'RESUMED', resolvedAt: now })
        .where(where('OPEN'))
        .returning({ id: conversationFollowups.id });
      return { cancelled: cancelled.length, resumed: resumed.length };
    });
  }

  /** Perguntas entregues e ainda válidas, da mais antiga à mais recente, para o contexto. */
  async listForContext(userId: string, now = new Date()): Promise<ConversationFollowupRow[]> {
    return this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .select()
        .from(conversationFollowups)
        .where(
          and(
            eq(conversationFollowups.userId, userId),
            eq(conversationFollowups.status, 'OPEN'),
            gt(conversationFollowups.expiresAt, now),
          ),
        )
        .orderBy(asc(conversationFollowups.subjectDate))
        .limit(CONTEXT_LIMIT),
    );
  }

  /**
   * Materializa a expiração para métrica: `OPEN` vencida → `EXPIRED`; reserva velha que
   * nunca foi enviada → `NOT_SENT`. A leitura já ignora linhas vencidas, então rodar (ou
   * não) este varredor não muda o comportamento do Coach.
   */
  async sweep(now = new Date()): Promise<{ expired: number; notSent: number }> {
    return this.db.runAsSystem(async (tx) => {
      const expired = await tx
        .update(conversationFollowups)
        .set({ status: 'EXPIRED', resolvedAt: now })
        .where(
          and(eq(conversationFollowups.status, 'OPEN'), lte(conversationFollowups.expiresAt, now)),
        )
        .returning({ id: conversationFollowups.id });
      const notSent = await tx
        .update(conversationFollowups)
        .set({ status: 'NOT_SENT', resolvedAt: now })
        .where(
          and(
            eq(conversationFollowups.status, 'PENDING_SEND'),
            lte(conversationFollowups.expiresAt, now),
          ),
        )
        .returning({ id: conversationFollowups.id });
      return { expired: expired.length, notSent: notSent.length };
    });
  }

  private async transition(
    userId: string,
    id: string,
    from: 'PENDING_SEND' | 'OPEN',
    patch: Partial<typeof conversationFollowups.$inferInsert>,
  ): Promise<boolean> {
    const rows = await this.db.runAsUser(userId, 'USER', (tx) =>
      tx
        .update(conversationFollowups)
        .set(patch)
        .where(
          and(
            eq(conversationFollowups.id, id),
            eq(conversationFollowups.userId, userId),
            eq(conversationFollowups.status, from),
          ),
        )
        .returning({ id: conversationFollowups.id }),
    );
    return rows.length > 0;
  }
}
