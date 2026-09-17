/**
 * Tabela `checkins` — check-in semanal.
 *
 * Achado 2026-09-13 (pedido do fundador): o fluxo por botão de WhatsApp (3 perguntas,
 * `current_question` como state machine) foi substituído por um formulário web de 8
 * perguntas, no mesmo molde de `protocol_renewal_sessions` — token opaco na URL (por trás
 * do alias curto do `ShortLinkService`), TTL de 7 dias (cobre a semana inteira até o
 * próximo disparo), sem retomada por etapa (o aluno responde tudo numa visita e envia de
 * uma vez, diferente da renovação de mesociclo).
 *
 * `sentAt`/`weekNumber`/a unicidade `(user, protocolo, semana)` continuam de pé — ainda é
 * o que torna o disparo do `CheckinScheduler` idempotente.
 */
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, smallint, unique, uuid, varchar } from 'drizzle-orm/pg-core';

import { bytea, eventTimestamp, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { checkinWeeklyStatusEnum } from './enums';
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

    /** Token opaco CSPRNG (256 bits) — mesmo racional de `protocol_renewal_sessions.token`. */
    token: varchar('token', { length: 64 }).notNull().unique(),

    status: checkinWeeklyStatusEnum('status').notNull().default('PENDING'),

    /** TTL de 7 dias aplicado pela aplicação — cobre até o próximo check-in semanal. */
    expiresAt: eventTimestamp('expires_at').notNull(),

    sentAt: eventTimestamp('sent_at'),
    submittedAt: eventTimestamp('submitted_at'),

    /**
     * Respostas estruturadas (sono, humor, alimentação/aderência 0-10, mudanças percebidas,
     * adequação da duração) — dado comum, em claro. Mesmo tratamento que os blocos 1/2/4/5
     * da renovação de mesociclo dão a perguntas equivalentes (ex.: qualidade do sono).
     */
    answers: jsonb('answers'),

    /**
     * -- LGPD Art. 11 — dado sensível de saúde quando menciona dor/desconforto.
     * Só os DOIS campos de texto livre do formulário (explicação do exercício difícil +
     * feedback aberto final) — cifrados com `HealthCipherService`, mesmo tratamento que
     * `workout_sessions.feedback_cipher` dá a texto livre do diário de treino.
     */
    notesCipher: bytea('notes_cipher'),

    ...timestampColumns,
  },
  (table) => [
    // Idempotência do disparo semanal — ver cabeçalho.
    unique('uq_checkins_user_protocol_week').on(table.userId, table.protocolId, table.weekNumber),
    index('idx_checkins_user_week').on(table.userId, table.weekNumber),
    // Fila do scheduler: check-ins enviados e ainda sem resposta.
    index('idx_checkins_sent_at').on(table.sentAt),
    index('idx_checkins_expires_at').on(table.expiresAt),
    check('ck_checkins_token_len', sql`char_length(${table.token}) = 64`),
  ],
);

export type CheckinRow = typeof checkins.$inferSelect;
export type NewCheckinRow = typeof checkins.$inferInsert;
