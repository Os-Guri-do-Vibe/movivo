/**
 * `conversation_followups` — pergunta que o Coach fez ao aluno e ainda espera resposta.
 *
 * Nasce do achado de 2026-10-13: a pergunta "o que aconteceu com o treino de ontem?" é
 * respondida, na prática, horas ou dias depois. A memória curta da conversa (Redis, por dia
 * civil, TTL 24h) não sustenta esse intervalo, e nada registrava QUAL treino a pergunta
 * tratava. Esta tabela é o estado durável dessa espera: o Coach lê a pendência ao responder
 * e entende "trabalhei" como a resposta sobre o treino certo, mesmo dias depois.
 *
 * ## Sem texto livre, de propósito
 * A resposta do aluno fica em `conversations` (cifrada). Aqui só há metadado do tópico:
 * a data do treino e o rótulo copiado da prescrição, que já é público dentro de
 * `workout_sessions.prescription`. Um motivo categorizado ("doença", "dor") seria dado de
 * saúde inferido e exigiria revisão jurídica antes de existir como coluna.
 *
 * ## Ciclo de vida
 * `PENDING_SEND` (reservada antes do envio) → `OPEN` (envio confirmado, vale 72h) →
 * `ANSWERED` | `RESUMED` (o aluno registrou um treino de um dia posterior, ou seja, voltou) |
 * `EXPIRED`. `CANCELLED` quando a reserva perdeu o sentido antes de sair (o aluno já voltou a
 * treinar); `NOT_SENT` quando o envio não aconteceu (consentimento revogado, sem telefone,
 * reserva velha). A expiração é avaliada na leitura;
 * o varredor só materializa o estado para métrica.
 *
 * `UNIQUE (user_id, kind, subject_date)` é a idempotência de verdade: duas varreduras, um
 * retry ou dois processos nunca criam duas perguntas para o mesmo dia.
 */
import { sql } from 'drizzle-orm';
import { check, date, index, pgTable, unique, uuid, varchar } from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { protocols } from './protocols';
import { users } from './users';
import { workoutSessions } from './workout-journal';

export type FollowupKind = 'MISSED_WORKOUT';

export type FollowupStatus =
  'PENDING_SEND' | 'OPEN' | 'ANSWERED' | 'RESUMED' | 'EXPIRED' | 'CANCELLED' | 'NOT_SENT';

export const conversationFollowups = pgTable(
  'conversation_followups',
  {
    id: primaryKeyColumn(),

    /** `RESTRICT`: compõe o histórico de acompanhamento supervisionado, como `conversations`. */
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    kind: varchar('kind', { length: 32 }).$type<FollowupKind>().notNull(),

    /** Dia civil (fuso do aluno) do treino sobre o qual a pergunta trata. */
    subjectDate: date('subject_date').notNull(),

    sessionKey: varchar('session_key', { length: 60 }),

    workoutSessionId: uuid('workout_session_id').references(() => workoutSessions.id, {
      onDelete: 'restrict',
    }),

    protocolId: uuid('protocol_id').references(() => protocols.id, { onDelete: 'set null' }),

    /** Cópia do foco da prescrição ("Costas e Bíceps"): o rótulo que o aluno reconhece. */
    topicLabel: varchar('topic_label', { length: 120 }).notNull(),

    status: varchar('status', { length: 16 })
      .$type<FollowupStatus>()
      .notNull()
      .default('PENDING_SEND'),

    /** Momento em que o WhatsApp confirmou o envio. Só existe a partir de `OPEN`. */
    deliveredAt: eventTimestamp('delivered_at'),

    /** Reserva: +24h. Na entrega vira `delivered_at` + 72h. */
    expiresAt: eventTimestamp('expires_at').notNull(),

    resolvedAt: eventTimestamp('resolved_at'),

    ...timestampColumns,
  },
  (table) => [
    unique('uq_conversation_followups_user_kind_subject').on(
      table.userId,
      table.kind,
      table.subjectDate,
    ),
    // Leitura quente: "há pendência aberta deste aluno?" a cada mensagem recebida.
    index('idx_conversation_followups_user_open')
      .on(table.userId, table.deliveredAt)
      .where(sql`${table.status} = 'OPEN'`),
    index('idx_conversation_followups_user_created').on(table.userId, table.createdAt),
    check(
      'ck_conversation_followups_status',
      sql`${table.status} in ('PENDING_SEND','OPEN','ANSWERED','RESUMED','EXPIRED','CANCELLED','NOT_SENT')`,
    ),
    check(
      'ck_conversation_followups_open_delivered',
      sql`${table.status} <> 'OPEN' or ${table.deliveredAt} is not null`,
    ),
  ],
);

export type ConversationFollowupRow = typeof conversationFollowups.$inferSelect;
