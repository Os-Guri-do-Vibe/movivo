/**
 * Tabela `checkins` — check-in semanal que realimenta o ajuste do protocolo.
 *
 * O check-in é disparado por job BullMQ repetível na janela de segunda-feira
 * 08–10h no fuso America/Sao_Paulo (`ARQUITETURA.md` §8). A constraint única por
 * (titular, protocolo, semana) é o que torna esse disparo **idempotente**: um
 * failover do scheduler não gera dois check-ins da mesma semana.
 */
import { index, jsonb, pgTable, smallint, unique, uuid } from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { protocols } from './protocols';
import { users } from './users';

export const checkins = pgTable(
  'checkins',
  {
    id: primaryKeyColumn(),

    /** `RESTRICT`: o check-in compõe o histórico de acompanhamento supervisionado. */
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    /** Protocolo avaliado neste check-in. */
    protocolId: uuid('protocol_id')
      .notNull()
      .references(() => protocols.id, { onDelete: 'restrict' }),

    /** Semana do protocolo (1..`protocols.total_weeks`). */
    weekNumber: smallint('week_number').notNull(),

    sentAt: eventTimestamp('sent_at'),
    respondedAt: eventTimestamp('responded_at'),

    /**
     * -- LGPD Art. 11 — DADO SENSÍVEL DE SAÚDE.
     * Respostas às perguntas do check-in: aderência, percepção de esforço e
     * **dor/desconforto**. A pergunta de dor é dado de saúde direto. Mesmo
     * escopo de cifra em repouso da anamnese; não cifrada nesta sprint.
     */
    responses: jsonb('responses'),

    /** Ajustes aplicados pelo Motor Determinístico a partir das respostas. */
    adjustments: jsonb('adjustments'),

    /**
     * Nova versão de protocolo gerada por este check-in, quando houve ajuste.
     * `SET NULL` para não travar a limpeza de um protocolo rascunho descartado.
     */
    newProtocolId: uuid('new_protocol_id').references(() => protocols.id, {
      onDelete: 'set null',
    }),

    ...timestampColumns,
  },
  (table) => [
    // Idempotência do disparo semanal — ver cabeçalho.
    unique('uq_checkins_user_protocol_week').on(table.userId, table.protocolId, table.weekNumber),
    index('idx_checkins_user_week').on(table.userId, table.weekNumber),
    // Fila do scheduler: check-ins enviados e ainda sem resposta.
    index('idx_checkins_sent_at').on(table.sentAt),
  ],
);

export type CheckinRow = typeof checkins.$inferSelect;
export type NewCheckinRow = typeof checkins.$inferInsert;
