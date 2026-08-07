/**
 * Tabela `handoff_alerts` (US-3.6) — estado consultável de handoff/alerta ao painel CREF.
 *
 * Decisão do fundador (2026-07-30): dois níveis. `ALERT` (revisão assíncrona, SEM promessa de
 * retorno) e `SAFETY` (red flag clínica, prioritário). Nesta sprint só se **persiste o estado**
 * sob RLS FORCE; a UI, a notificação e a resolução humana são a **Sprint 5**, que lê esta tabela.
 *
 * É dado de titular (não global como `knowledge_base`/`intent_examples`): RLS por `user_id`.
 */
import { index, pgTable, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

import { primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { handoffLevelEnum, handoffStatusEnum } from './enums';
import { users } from './users';

export const handoffAlerts = pgTable(
  'handoff_alerts',
  {
    id: primaryKeyColumn(),

    /** `RESTRICT`: o alerta é parte da trilha de supervisão — não some com o titular. */
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    level: handoffLevelEnum('level').notNull(),

    /** Motivo curto e estável (ex.: `PEDIDO_HANDOFF`, `VALIDATOR_FLAG`, `RED_FLAG`). */
    reason: varchar('reason', { length: 60 }).notNull(),

    status: handoffStatusEnum('status').notNull().default('OPEN'),

    /** Conversa que originou o alerta (contexto para o profissional). Sem FK: escrita assíncrona. */
    conversationId: uuid('conversation_id'),

    /** Origem duravel para idempotencia de alertas de check-in. */
    sourceType: varchar('source_type', { length: 30 }),
    sourceId: uuid('source_id'),

    ...timestampColumns,
  },
  (table) => [
    // Fila do painel CREF (Sprint 5): pendentes por nível/tempo. `user_id` líder p/ RLS.
    index('idx_handoff_alerts_user').on(table.userId, table.createdAt),
    index('idx_handoff_alerts_queue').on(table.status, table.level, table.createdAt),
    uniqueIndex('uq_handoff_alerts_source').on(table.sourceType, table.sourceId),
  ],
);

export type HandoffAlertRow = typeof handoffAlerts.$inferSelect;
export type NewHandoffAlertRow = typeof handoffAlerts.$inferInsert;
