import { bigint, char, index, jsonb, pgTable, uuid, varchar } from 'drizzle-orm/pg-core';

import { eventTimestamp } from './_shared';

/**
 * Trilha administrativa imutavel; hashes sao produzidos pelo trigger do banco.
 *
 * `actor_id` e `user_id` não têm FK de propósito: cada um ora referencia `staff.id`
 * (ação de dashboard, ou o sentinela `userId = actorId` quando não há titular
 * envolvido), ora `users.id` (o titular sujeito da ação, ou ele mesmo como ator ao
 * revogar seu próprio consentimento — `revoke_health_data_consent`/
 * `revoke_non_health_consent`). Postgres não modela FK polimórfico; a integridade
 * fica com a aplicação (`AuditService.append` e as funções `SECURITY DEFINER` de
 * consentimento em `security-policies.ts`), não com o banco, só para estas colunas.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    actorId: uuid('actor_id').notNull(),
    userId: uuid('user_id').notNull(),
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
