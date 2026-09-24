/**
 * Tabela `subscriptions` — assinatura do usuário.
 *
 * Modelo de negócio vigente: **plano único por período** (Mensal, Trimestral,
 * Semestral ou Anual), com trial de 7 dias **sem cartão**. Os preços vivem na
 * fonte única `SUBSCRIPTION_PLANS`; não existe tiering de features.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

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

    /** Snapshot comercial do contrato. Atualização futura do catálogo nunca reprecifica a linha. */
    monthlyPriceCents: integer('monthly_price_cents').notNull(),
    totalPriceCents: integer('total_price_cents').notNull(),
    commitmentMonths: integer('commitment_months').notNull(),

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
    externalPaymentId: varchar('external_payment_id', { length: 255 }),
    externalInstallmentId: varchar('external_installment_id', { length: 255 }),
    externalAuthorizationId: varchar('external_authorization_id', { length: 255 }),

    /** Forma e limites autorizados no contrato — nunca inferidos depois pelo catálogo atual. */
    paymentMethod: varchar('payment_method', { length: 30 }),
    installmentCount: integer('installment_count'),
    authorizedPaymentCount: integer('authorized_payment_count'),
    /** Incrementado somente ao substituir uma cobrança Pix expirada/cancelada. */
    paymentAttempt: integer('payment_attempt').notNull().default(0),

    trialStartedAt: eventTimestamp('trial_started_at'),
    trialEndsAt: eventTimestamp('trial_ends_at'),
    currentPeriodStart: eventTimestamp('current_period_start'),
    currentPeriodEnd: eventTimestamp('current_period_end'),
    nextBillingAt: eventTimestamp('next_billing_at'),
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
     * O provedor não pode criar uma segunda assinatura. `uniqueIndex` em vez
     * de `unique` porque a coluna é nula durante o trial e, no PostgreSQL,
     * múltiplos NULLs não colidem em índice único — que é exatamente o
     * comportamento desejado aqui.
     */
    uniqueIndex('uq_subscriptions_external_id').on(table.externalSubscriptionId),
    uniqueIndex('uq_subscriptions_external_checkout_session').on(table.externalCheckoutSessionId),
    uniqueIndex('uq_subscriptions_external_payment').on(table.externalPaymentId),
    uniqueIndex('uq_subscriptions_external_installment').on(table.externalInstallmentId),
    uniqueIndex('uq_subscriptions_external_authorization').on(table.externalAuthorizationId),
    check('ck_subscriptions_monthly_price_positive', sql`${table.monthlyPriceCents} > 0`),
    check('ck_subscriptions_total_price_positive', sql`${table.totalPriceCents} > 0`),
    check('ck_subscriptions_commitment_months', sql`${table.commitmentMonths} between 1 and 12`),
    check(
      'ck_subscriptions_payment_method',
      sql`${table.paymentMethod} in ('CARD', 'PIX', 'PIX_AUTOMATIC')`,
    ),
    check('ck_subscriptions_installment_count', sql`${table.installmentCount} between 1 and 12`),
    check(
      'ck_subscriptions_authorized_payment_count',
      sql`${table.authorizedPaymentCount} between 1 and 12`,
    ),
    check('ck_subscriptions_payment_attempt', sql`${table.paymentAttempt} >= 0`),
  ],
);

export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type NewSubscriptionRow = typeof subscriptions.$inferInsert;
