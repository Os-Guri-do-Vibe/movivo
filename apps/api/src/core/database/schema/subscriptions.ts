/**
 * Tabela `subscriptions` — assinatura do usuário.
 *
 * Modelo de negócio vigente: **plano único por período** (Mensal, Trimestral,
 * Semestral ou Anual), com trial de 7 dias **sem cartão**. Os preços vivem na
 * fonte única `SUBSCRIPTION_PLANS`; não existe tiering de features.
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
     * ponto flutuante binário não representa R$79,90 exatamente e o erro se
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

    /** IDs externos para conciliação e idempotência do checkout/webhook. */
    externalSubscriptionId: varchar('external_subscription_id', { length: 255 }),
    externalCustomerId: varchar('external_customer_id', { length: 255 }),
    externalCheckoutSessionId: varchar('external_checkout_session_id', { length: 255 }),
    externalPriceId: varchar('external_price_id', { length: 255 }),

    trialStartedAt: eventTimestamp('trial_started_at'),
    trialEndsAt: eventTimestamp('trial_ends_at'),
    currentPeriodStart: eventTimestamp('current_period_start'),
    currentPeriodEnd: eventTimestamp('current_period_end'),
    canceledAt: eventTimestamp('canceled_at'),

    /** Motivo declarado do cancelamento — insumo direto de retenção/churn. */
    cancelReason: text('cancel_reason'),

    /**
     * Aceite dos Termos de Assinatura no checkout (US-4.1.3 / CDC / Alexandre): versão do
     * contrato aceita + quando. Registro contratual; nulo até o checkout capturar o aceite.
     */
    termsVersion: varchar('terms_version', { length: 30 }),
    termsAcceptedAt: eventTimestamp('terms_accepted_at'),

    ...timestampColumns,
  },
  (table) => [
    // Uma assinatura por titular: fecha a corrida de dois jobs `trial-start` simultâneos.
    uniqueIndex('uq_subscriptions_user').on(table.userId),
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
    uniqueIndex('uq_subscriptions_external_checkout_session').on(table.externalCheckoutSessionId),
  ],
);

export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type NewSubscriptionRow = typeof subscriptions.$inferInsert;
