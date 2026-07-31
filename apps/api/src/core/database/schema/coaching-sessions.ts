/**
 * Tabela `coaching_sessions` — memória de longo prazo da conversa com a MOVI (US-3.2).
 *
 * A working memory (janela recente) vive no Redis; quando a sessão do dia passa de ~15
 * turnos, um job assíncrono condensa os turnos antigos em 2-3 frases e persiste aqui, para
 * o contexto seguinte usar "janela recente + resumo" sem estourar tokens. Uma linha por
 * (titular, dia) — a constraint única torna o upsert do resumo idempotente.
 *
 * Dado derivado de conversa de saúde: sob FORCE RLS (a policy é registrada em
 * `security-policies.ts`); leitura/escrita sempre sob `runAsUser`/`SET LOCAL`.
 */
import { date, index, pgTable, text, unique } from 'drizzle-orm/pg-core';

import { primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { users } from './users';

export const coachingSessions = pgTable(
  'coaching_sessions',
  {
    id: primaryKeyColumn(),

    /** `RESTRICT`: o resumo compõe o histórico de acompanhamento supervisionado. */
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    /** Dia da sessão (America/Sao_Paulo) — mesma chave do `session:{user}:{yyyy-mm-dd}` do Redis. */
    sessionDate: date('session_date').notNull(),

    /** Resumo condensado dos turnos antigos (2-3 frases). `null` até a sessão ficar longa. */
    summary: text('summary'),

    ...timestampColumns,
  },
  (table) => [
    unique('uq_coaching_sessions_user_date').on(table.userId, table.sessionDate),
    index('idx_coaching_sessions_user').on(table.userId, table.sessionDate),
  ],
);

export type CoachingSessionRow = typeof coachingSessions.$inferSelect;
export type NewCoachingSessionRow = typeof coachingSessions.$inferInsert;
