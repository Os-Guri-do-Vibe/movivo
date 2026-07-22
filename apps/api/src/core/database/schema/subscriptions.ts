/**
 * Tabela `subscriptions` — assinatura do usuário.
 *
 * Modelo de negócio vigente (Eduardo, `07-relatorio-eduardo.md`): **plano único
 * por período** — Mensal R$39 / Trimestral R$99 / Anual R$349 — com trial de 7
 * dias **sem cartão**. Não existe tiering de features; a retenção vem do
 * compromisso de período.
 */
import { index, integer, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { paymentProviderEnum, subscriptionPlanEnum, subscriptionStatusEnum } from './enums';
import { users } from './users';

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: primaryKeyColumn(),

    /** `RESTRICT`: assinatura é registro fiscal/contratual, não some com o titular. */
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    plan: subscriptionPlanEnum('plan').notNull(),

    /**
     * Preço em **centavos**, inteiro. Nunca `numeric`/`float` para dinheiro:
     * ponto flutuante binário não representa R$39,00 exatamente e o erro se
     * acumula em relatório de receita.
     */
    priceCents: integer('price_cents').notNull(),

    currency: varchar('currency', { length: 3 }).notNull().default('BRL'),

    status: subscriptionStatusEnum('status').notNull().default('TRIALING'),

    /**
     * Nulo durante o trial: por decisão de produto o trial de 7 dias não pede
     * cartão, então não há gateway envolvido até a conversão.
     */
    paymentProvider: paymentProviderEnum('payment_provider'),

    /** ID da assinatura no Stripe/Asaas. Chave de idempotência do webhook. */
    externalSubscriptionId: varchar('external_subscription_id', { length: 255 }),

    trialEndsAt: eventTimestamp('trial_ends_at'),
    currentPeriodStart: eventTimestamp('current_period_start'),
    currentPeriodEnd: eventTimestamp('current_period_end'),
    canceledAt: eventTimestamp('canceled_at'),

    /** Motivo declarado do cancelamento — insumo direto de retenção/churn. */
    cancelReason: text('cancel_reason'),

    ...timestampColumns,
  },
  (table) => [
    index('idx_subscriptions_user').on(table.userId, table.createdAt),
    index('idx_subscriptions_status').on(table.status),
    // Sequência de conversão do trial (dias 7/10/13/14 — Lucas §MVP).
    index('idx_subscriptions_trial_ends_at').on(table.trialEndsAt),
    /*
     * Idempotência do webhook de pagamento: o mesmo evento reentregue pelo
     * Stripe/Asaas não pode criar uma segunda assinatura. `uniqueIndex` em vez
     * de `unique` porque a coluna é nula durante o trial e, no PostgreSQL,
     * múltiplos NULLs não colidem em índice único — que é exatamente o
     * comportamento desejado aqui.
     */
    uniqueIndex('uq_subscriptions_external_id').on(table.externalSubscriptionId),
  ],
);

export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type NewSubscriptionRow = typeof subscriptions.$inferInsert;
