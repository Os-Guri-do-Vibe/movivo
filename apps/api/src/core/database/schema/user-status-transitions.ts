/**
 * Tabela `user_status_transitions` — a sequência de mudanças de estado do aluno (US-8.3).
 *
 * O sistema já guardava o **estado atual** e datas soltas em `subscriptions`. Isso responde
 * "quantos ativos hoje" e não responde "quantos dos que entraram em maio converteram", "em
 * quantos dias" e "a coorte de junho retém melhor". Essas perguntas se respondem com a
 * sequência, e a sequência estava sendo inferida — o que dá certo até o primeiro aluno que
 * pausou, voltou e trocou de plano, quando a inferência erra em silêncio.
 *
 * ## Append-only imposto no banco
 * Mesma dupla barreira já provada em `audit_logs` e `agent_config` (Sprint 7):
 * trigger que rejeita UPDATE/DELETE/TRUNCATE com SQLSTATE 55000 + REVOKE do privilégio na
 * role de runtime. Ver `buildStatusTransitionsImmutabilitySql` em `security-policies.ts` e o
 * teste `test/user-status-transitions-immutability.int-spec.ts`.
 *
 * ## Unicidade
 * `(user_id, to_status, occurred_at)` existe para o backfill: rodar o script duas vezes não
 * duplica linha (`onConflictDoNothing`). Não impede o mesmo marco em instantes diferentes —
 * `RENEWED` acontece várias vezes por titular, e deve.
 */
import { pgTable, text, unique, index } from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { statusTransitionActorEnum, userLifecycleStatusEnum } from './enums';
import { users } from './users';

export const userStatusTransitions = pgTable(
  'user_status_transitions',
  {
    id: primaryKeyColumn(),

    /** `RESTRICT`: é histórico de coorte/receita, não some com o titular. */
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    /** Marco anterior do titular. Nulo na primeira transição (entrada no funil). */
    fromStatus: userLifecycleStatusEnum('from_status'),

    toStatus: userLifecycleStatusEnum('to_status').notNull(),

    /**
     * Quando o marco aconteceu — distinto de `created_at` (quando foi gravado). No
     * backfill os dois divergem por meses, e é isso que torna a coorte reconstruída
     * legível como reconstrução.
     */
    occurredAt: eventTimestamp('occurred_at').notNull().defaultNow(),

    /** Texto livre curto (ex.: `refund`, `winback`). Nunca PII, nunca dado de saúde. */
    reason: text('reason'),

    actor: statusTransitionActorEnum('actor').notNull().default('SYSTEM'),

    ...timestampColumns,
  },
  (table) => [
    unique('uq_user_status_transitions_event').on(table.userId, table.toStatus, table.occurredAt),
    // Funil e coorte varrem por marco × instante cruzando todos os titulares.
    index('idx_user_status_transitions_to_status').on(table.toStatus, table.occurredAt),
    index('idx_user_status_transitions_user').on(table.userId, table.occurredAt),
  ],
);

export type UserStatusTransitionRow = typeof userStatusTransitions.$inferSelect;
export type NewUserStatusTransitionRow = typeof userStatusTransitions.$inferInsert;
