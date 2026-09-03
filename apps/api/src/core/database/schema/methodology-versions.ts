/** Metodologia clínica versionada e seu workflow auditável, ambos append-only. */
import { index, integer, pgEnum, pgTable, text, unique, uuid, varchar } from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn } from './_shared';
import { users } from './users';

export const methodologyStatusEnum = pgEnum('methodology_status', [
  'DRAFT',
  'IN_REVIEW',
  'REJECTED',
  'APPROVED',
  'PUBLISHED',
  'ARCHIVED',
]);

export const methodologyVersions = pgTable(
  'methodology_versions',
  {
    id: primaryKeyColumn(),
    version: integer('version').notNull(),
    versionLabel: varchar('version_label', { length: 80 }).notNull(),
    content: text('content').notNull(),
    contentSha256: varchar('content_sha256', { length: 64 }).notNull(),
    changeNote: text('change_note').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: eventTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('uq_methodology_versions_version').on(table.version),
    unique('uq_methodology_versions_label').on(table.versionLabel),
  ],
);

export const methodologyEvents = pgTable(
  'methodology_events',
  {
    id: primaryKeyColumn(),
    methodologyVersionId: uuid('methodology_version_id')
      .notNull()
      .references(() => methodologyVersions.id, { onDelete: 'restrict' }),
    sequence: integer('sequence').notNull(),
    status: methodologyStatusEnum('status').notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'restrict' }),
    note: text('note').notNull(),
    createdAt: eventTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('uq_methodology_event_sequence').on(table.methodologyVersionId, table.sequence),
    index('idx_methodology_events_status').on(table.status, table.createdAt),
  ],
);

export type MethodologyVersionRow = typeof methodologyVersions.$inferSelect;
