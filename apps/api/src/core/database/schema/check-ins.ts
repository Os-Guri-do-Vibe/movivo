/**
 * Check-ins adaptativos. As perguntas são escolhidas por check-in (só o que pode mudar a
 * próxima decisão) e ficam gravadas junto das respostas — o histórico mostra exatamente o
 * que foi perguntado e por quê. O acesso do aluno é por link mágico (`access_link_tokens`).
 */
import { index, jsonb, pgTable, varchar } from 'drizzle-orm/pg-core';

import {
  checkInKindSchema,
  checkInStatusSchema,
  type CheckInAnswers,
  type CheckInQuestion,
} from '@movivo/shared';

import {
  checkOneOf,
  eventTimestamp,
  primaryKeyColumn,
  timestampColumns,
  userIdColumn,
} from './_shared';
import { users } from './users';

export const checkIns = pgTable(
  'check_ins',
  {
    id: primaryKeyColumn(),
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 16 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('SENT'),
    questions: jsonb('questions').$type<CheckInQuestion[]>().notNull(),
    answers: jsonb('answers').$type<CheckInAnswers>(),
    expiresAt: eventTimestamp('expires_at').notNull(),
    answeredAt: eventTimestamp('answered_at'),
    ...timestampColumns,
  },
  (t) => [
    index('idx_check_ins_user').on(t.userId, t.createdAt),
    checkOneOf('ck_check_ins_kind', t.kind, checkInKindSchema.options),
    checkOneOf('ck_check_ins_status', t.status, checkInStatusSchema.options),
  ],
);
