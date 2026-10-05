/** Aliases de bootstrap: código SHA-256 e destino cifrado; nenhum bearer em claro no banco. */
import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { primaryKeyColumn, timestampColumns } from './_shared';

export const shortLinks = pgTable(
  'short_links',
  {
    id: primaryKeyColumn(),
    code: varchar('code', { length: 64 }).notNull(),
    targetUrl: text('target_url').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex('uq_short_links_code').on(table.code),
    check('ck_short_links_code_len', sql`char_length(${table.code}) = 64`),
  ],
);
