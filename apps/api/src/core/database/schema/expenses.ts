/**
 * `expenses` — o livro-caixa de despesa da operação (US-8.4 / TASK-8.4.2).
 *
 * Existe para tornar falsa a frase da Sprint 7: *"o sistema conhece receita contratada e
 * não conhece nenhuma despesa — qualquer tela que exibisse um número chamado 'lucro'
 * estaria inventando"*.
 *
 * ## Duas propriedades não negociáveis
 * 1. **Valor em centavo inteiro** (regra 1 da sprint). Nunca `float`, nunca `real`.
 * 2. **Correção por estorno, nunca por edição.** Não há endpoint de UPDATE de valor, e a
 *    proibição não é convenção de código: `security-policies.ts` instala trigger de
 *    rejeição + `REVOKE UPDATE, DELETE, TRUNCATE` da role de runtime, o mesmo padrão de
 *    `audit_logs` e `agent_config`. Lançou errado → grava a linha de estorno
 *    (`amount_cents` negativo, `reverses_expense_id` apontando para a original) e depois
 *    a linha certa. O extrato é conferível porque nada some.
 *
 * ## Sem RLS por titular
 * Não é dado de aluno: é dado da empresa. O controle é por capability na API
 * (`FINANCE_READ` / `FINANCE_WRITE`) + append-only no banco — igual a `agent_config`.
 *
 * ## Recorrência é materializada, não calculada
 * Despesa recorrente gera **uma linha por período**, criada pelo job de materialização
 * (`ExpenseService.materializeRecurring`). Recorrência que só existe na query é
 * impossível de conferir contra extrato bancário. A linha-mãe (`is_recurring = true`)
 * é o modelo; as filhas apontam para ela por `recurring_parent_id`, e o índice único
 * `(recurring_parent_id, occurred_on)` faz o job ser idempotente por construção.
 */
import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { ExpenseCategory, ExpenseRecurrencePeriod } from '@movivo/shared';

import { eventTimestamp, primaryKeyColumn } from './_shared';
import { users } from './users';

export const expenseCategoryEnum = pgEnum(
  'expense_category',
  Object.values(ExpenseCategory) as [string, ...string[]],
);

export const expenseRecurrencePeriodEnum = pgEnum(
  'expense_recurrence_period',
  Object.values(ExpenseRecurrencePeriod) as [string, ...string[]],
);

export const expenses = pgTable(
  'expenses',
  {
    id: primaryKeyColumn(),

    /** Competência (data da despesa), não a data de digitação — esta é `created_at`. */
    occurredOn: date('occurred_on').notNull(),

    /** Centavos inteiros. Negativo **somente** em linha de estorno. */
    amountCents: integer('amount_cents').notNull(),

    currency: text('currency').notNull().default('BRL'),

    category: expenseCategoryEnum('category').notNull(),

    supplier: text('supplier').notNull(),

    description: text('description').notNull(),

    isRecurring: boolean('is_recurring').notNull().default(false),

    recurrencePeriod: expenseRecurrencePeriodEnum('recurrence_period'),

    /** Referência textual/URL ao comprovante. Upload de arquivo é Sprint 10, de propósito. */
    receiptRef: text('receipt_ref'),

    /** Preenchido só na linha de estorno: aponta a despesa que está sendo anulada. */
    reversesExpenseId: uuid('reverses_expense_id'),

    /** Preenchido nas linhas materializadas por recorrência; aponta a linha-mãe. */
    recurringParentId: uuid('recurring_parent_id'),

    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    createdAt: eventTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    // Idempotência do job de materialização: rodar 2x no mesmo dia não duplica linha.
    unique('uq_expenses_recurring_period').on(table.recurringParentId, table.occurredOn),
    // Uma despesa só pode ser estornada uma vez.
    unique('uq_expenses_reversal').on(table.reversesExpenseId),
    // Agregação do painel: custo por mês e por categoria varre por competência.
    index('idx_expenses_occurred_on').on(table.occurredOn),
  ],
);

export type ExpenseRow = typeof expenses.$inferSelect;
export type NewExpenseRow = typeof expenses.$inferInsert;
