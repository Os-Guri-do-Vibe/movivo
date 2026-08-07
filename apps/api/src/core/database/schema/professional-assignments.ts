import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { users } from './users';

/** Vinculo de escopo: RBAC profissional nunca equivale a acesso global. */
export const professionalAssignments = pgTable(
  'professional_assignments',
  {
    id: primaryKeyColumn(),
    professionalId: uuid('professional_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    active: boolean('active').notNull().default(true),
    assignedAt: eventTimestamp('assigned_at').notNull().defaultNow(),
    revokedAt: eventTimestamp('revoked_at'),
    ...timestampColumns,
  },
  (table) => [
    unique('uq_professional_assignments_pair').on(table.professionalId, table.userId),
    uniqueIndex('uq_professional_assignments_active_user')
      .on(table.userId)
      .where(sql`${table.active} = true AND ${table.revokedAt} IS NULL`),
    index('idx_professional_assignments_professional').on(table.professionalId, table.active),
    index('idx_professional_assignments_user').on(table.userId, table.active),
  ],
);

export type ProfessionalAssignmentRow = typeof professionalAssignments.$inferSelect;
