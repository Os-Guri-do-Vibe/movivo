import { index, pgTable, unique } from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { users } from './users';

/** Um unico lembrete por janela de inatividade, persistido antes do envio. */
export const reengagementNudges = pgTable(
  'reengagement_nudges',
  {
    id: primaryKeyColumn(),
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    windowStartedAt: eventTimestamp('window_started_at').notNull(),
    sentAt: eventTimestamp('sent_at'),
    respondedAt: eventTimestamp('responded_at'),
    ...timestampColumns,
  },
  (table) => [
    unique('uq_reengagement_nudges_user_window').on(table.userId, table.windowStartedAt),
    index('idx_reengagement_nudges_user').on(table.userId, table.createdAt),
  ],
);
