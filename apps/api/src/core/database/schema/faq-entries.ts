/** FAQ determinístico versionado. A linha mais recente de cada `faq_key` é o estado atual. */
import { index, integer, pgEnum, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn } from './_shared';
import { users } from './users';

export const faqEntryStatusEnum = pgEnum('faq_entry_status', ['PUBLISHED', 'RETIRED']);

export const faqEntries = pgTable(
  'faq_entries',
  {
    id: primaryKeyColumn(),
    faqKey: uuid('faq_key').notNull(),
    canonicalQuestion: text('canonical_question').notNull(),
    normalizedQuestion: text('normalized_question').notNull(),
    answer: text('answer').notNull(),
    version: integer('version').notNull(),
    status: faqEntryStatusEnum('status').notNull().default('PUBLISHED'),
    changeNote: text('change_note').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: eventTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('uq_faq_entries_key_version').on(table.faqKey, table.version),
    index('idx_faq_entries_lookup').on(table.normalizedQuestion, table.createdAt),
    index('idx_faq_entries_key').on(table.faqKey, table.version),
  ],
);

export type FaqEntryRow = typeof faqEntries.$inferSelect;
