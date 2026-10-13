/**
 * `dashboard_notification_reads` — estado de leitura das notificações do sino do dashboard.
 *
 * "Lido" é POR PROFISSIONAL e independe do estado de negócio: ler um alerta não o resolve,
 * ler um protocolo não o tira da fila. A tabela só diz "esta conta já abriu este item".
 * Um item é não lido quando está pendente e (não há linha aqui OU `read_at` é anterior ao
 * momento em que ele foi notificado).
 *
 * `kind` + `ref_id` apontam para `handoff_alerts`, `protocols` ou `protocol_substitution_requests`
 * sem FK: o alvo muda de tabela conforme o tipo e a linha de leitura nunca deve travar o
 * expurgo do alvo. `user_id` é o staff, com `CASCADE` — é estado de preferência, não prova.
 */
import { index, pgTable, primaryKey, varchar } from 'drizzle-orm/pg-core';
import { uuid } from 'drizzle-orm/pg-core';

import { eventTimestamp, userIdColumn } from './_shared';
import { staff } from './staff';

export const dashboardNotificationReads = pgTable(
  'dashboard_notification_reads',
  {
    userId: userIdColumn()
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    /** `alert` | `protocol` | `substitution`. */
    kind: varchar('kind', { length: 20 }).notNull(),
    refId: uuid('ref_id').notNull(),
    readAt: eventTimestamp('read_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.kind, table.refId] }),
    index('idx_dashboard_notification_reads_user').on(table.userId, table.readAt),
  ],
);

export type DashboardNotificationReadRow = typeof dashboardNotificationReads.$inferSelect;
