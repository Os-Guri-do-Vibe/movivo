import { sql } from 'drizzle-orm';
import { char, check, pgTable, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { users } from './users';

export type AccessLinkPurpose = 'PROTOCOL' | 'CHECKOUT' | 'SUBSCRIPTION_PORTAL';

/** Credenciais independentes dos IDs: um hash ativo por titular, finalidade e recurso. */
export const accessLinkTokens = pgTable(
  'access_link_tokens',
  {
    id: primaryKeyColumn(),
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    purpose: varchar('purpose', { length: 24 }).$type<AccessLinkPurpose>().notNull(),
    resourceId: uuid('resource_id').notNull(),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    expiresAt: eventTimestamp('expires_at').notNull(),
    revokedAt: eventTimestamp('revoked_at'),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex('uq_access_link_tokens_hash').on(table.tokenHash),
    uniqueIndex('uq_access_link_tokens_resource').on(table.userId, table.purpose, table.resourceId),
    check(
      'ck_access_link_tokens_purpose',
      sql`${table.purpose} in ('PROTOCOL', 'CHECKOUT', 'SUBSCRIPTION_PORTAL')`,
    ),
  ],
);
