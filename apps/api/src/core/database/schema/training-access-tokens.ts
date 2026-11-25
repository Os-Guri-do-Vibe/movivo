/** Tokens de bootstrap (WhatsApp) e sessões passwordless do aluno. Só o SHA-256 é persistido. */
import { sql } from 'drizzle-orm';
import { char, check, index, pgTable, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { users } from './users';

export const trainingAccessTokens = pgTable(
  'training_access_tokens',
  {
    id: primaryKeyColumn(),
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    kind: varchar('kind', { length: 12 }).$type<'MAGIC' | 'SESSION'>().notNull(),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    expiresAt: eventTimestamp('expires_at').notNull(),
    consumedAt: eventTimestamp('consumed_at'),
    revokedAt: eventTimestamp('revoked_at'),
    lastUsedAt: eventTimestamp('last_used_at'),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex('uq_training_access_tokens_hash').on(table.tokenHash),
    index('idx_training_access_tokens_user').on(table.userId, table.expiresAt),
    check('ck_training_access_tokens_kind', sql`${table.kind} in ('MAGIC', 'SESSION')`),
  ],
);
