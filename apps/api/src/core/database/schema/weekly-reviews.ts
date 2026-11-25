/**
 * Revisão semanal do progresso: uma por aluno por semana fechada. Guarda os números, os sinais
 * (fatos) e o parecer com as hipóteses, sempre marcadas como hipótese. As ações propostas ficam
 * na trilha de decisões (`proposal_ids`).
 */
import { date, index, jsonb, pgTable, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import {
  reviewStatusSchema,
  type ReviewSignal,
  type WeekMetrics,
  type WeeklyReviewRecord,
} from '@movivo/shared';

import { checkOneOf, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { users } from './users';

export const weeklyReviews = pgTable(
  'weekly_reviews',
  {
    id: primaryKeyColumn(),
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Segunda-feira da semana revisada. */
    weekStart: date('week_start').notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    metrics: jsonb('metrics').$type<WeekMetrics[]>().notNull(),
    signals: jsonb('signals').$type<ReviewSignal[]>().notNull(),
    record: jsonb('record').$type<WeeklyReviewRecord>().notNull(),
    modelRunId: uuid('model_run_id'),
    proposalIds: jsonb('proposal_ids')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    ...timestampColumns,
  },
  (t) => [
    unique('uq_weekly_reviews_user_week').on(t.userId, t.weekStart),
    index('idx_weekly_reviews_user').on(t.userId, t.weekStart),
    checkOneOf('ck_weekly_reviews_status', t.status, reviewStatusSchema.options),
  ],
);
