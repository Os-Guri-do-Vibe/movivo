import { bigint, char, index, jsonb, pgTable, uuid, varchar } from 'drizzle-orm/pg-core';

import { eventTimestamp } from './_shared';
import { users } from './users';

/** Trilha administrativa imutavel; hashes sao produzidos pelo trigger do banco. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    action: varchar('action', { length: 80 }).notNull(),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    changes: jsonb('changes').notNull(),
    previousHash: char('previous_hash', { length: 64 }),
    rowHash: char('row_hash', { length: 64 }).notNull(),
    createdAt: eventTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_audit_logs_user_created').on(table.userId, table.createdAt),
    index('idx_audit_logs_actor_created').on(table.actorId, table.createdAt),
  ],
);
