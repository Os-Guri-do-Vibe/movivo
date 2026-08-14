/**
 * `payments` — a liquidação que **de fato caiu na conta** (US-8.5 / TASK-8.5.1).
 *
 * Até a Sprint 7 o sistema conhecia apenas receita **contratada** (`subscriptions.price_cents`).
 * A diferença entre contratado e recebido é inadimplência, falha de cartão e prazo de
 * liquidação — e num B2C de ticket baixo pago em cartão ela não é pequena. Distribuir lucro
 * sobre receita contratada é distribuir dinheiro que talvez não tenha entrado.
 *
 * ## Idempotência é do banco, não do código
 * `uq_payments_gateway_event` em (`gateway`, `gateway_event_id`) é a **única** garantia de
 * "uma linha por evento". Checagem em código (`select` antes do `insert`) tem janela de corrida
 * entre a leitura e a escrita, e o gateway reentrega por design — inclusive em paralelo. A
 * constraint não tem janela. O worker faz `onConflictDoNothing` sobre ela e pronto.
 *
 * ## Append-only, estorno é linha nova
 * Mesmo padrão de `audit_logs`/`agent_config`/`expenses`: `buildPaymentsImmutabilitySql`
 * instala trigger de rejeição (55000) + `REVOKE UPDATE, DELETE, TRUNCATE` da role de runtime
 * (42501). Estorno/chargeback **nunca** altera a linha da cobrança original: entra como linha
 * nova com `amount_cents` negativo e `status` próprio. Somar a coluna devolve o líquido
 * correto sem nenhum CASE — é essa propriedade que faz o extrato ser conferível.
 *
 * ## Por que `user_id`/`subscription_id` são nulos
 * São o resultado da conciliação, não um dado do evento. Um evento cuja assinatura não é
 * encontrada (metadata errado, cobrança fora do produto, teste do gateway) grava a linha com
 * ambos nulos — é essa a **fila de exceção**, consultável por `subscription_id IS NULL`.
 * Descartar o evento para manter a coluna `NOT NULL` seria perder fato financeiro para
 * agradar o schema.
 *
 * ## RLS
 * Tem titular, então é tabela de titular normal (`professional: 'read'`, como `subscriptions`).
 * A linha órfã (titular nulo) não casa com nenhuma política de titular — fica visível só a
 * `SYSTEM`/`ADMIN`, que é exatamente o público da fila de exceção.
 */
import { index, integer, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn, userIdColumn } from './_shared';
import { subscriptions } from './subscriptions';
import { users } from './users';

export const payments = pgTable(
  'payments',
  {
    id: primaryKeyColumn(),

    /** Nulo quando a conciliação não achou a assinatura — ver "fila de exceção" acima. */
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, {
      onDelete: 'restrict',
    }),

    /** Nulo pelo mesmo motivo. `RESTRICT`: liquidação é registro fiscal, não some com o titular. */
    userId: userIdColumn().references(() => users.id, { onDelete: 'restrict' }),

    /** `MOCK` | `STRIPE` | `ASAAS` — o `GatewayName` do adaptador que verificou a assinatura. */
    gateway: text('gateway').notNull(),

    /** Id do evento no provedor. Metade da chave de idempotência. */
    gatewayEventId: text('gateway_event_id').notNull(),

    /** `SETTLED` | `FAILED` | `REFUNDED` | `CHARGEBACK`. */
    status: text('status').notNull(),

    /** Centavos inteiros (regra 1 da sprint). Negativo em estorno/chargeback. */
    amountCents: integer('amount_cents').notNull(),

    /**
     * Líquido de taxa do gateway. A taxa é custo real da operação e precisa ser visível:
     * ela é `amount_cents - net_amount_cents`, então não existe terceira coluna para
     * divergir da subtração. Igual a `amount_cents` quando o provedor não informa taxa.
     */
    netAmountCents: integer('net_amount_cents').notNull(),

    /** Quando a liquidação ocorreu no gateway — não quando chegou aqui. */
    occurredAt: eventTimestamp('occurred_at').notNull(),

    /**
     * Payload bruto do provedor, como recebido. Fica aqui sob RLS e **nunca** vai para log
     * de aplicação: carrega dado de cobrança. Ver `PaymentReconciliationWorker`.
     */
    rawPayload: jsonb('raw_payload').notNull(),

    /** Chegada do webhook. `occurred_at - received_at` é o prazo de liquidação exibido. */
    receivedAt: eventTimestamp('received_at').notNull().defaultNow(),
  },
  (table) => [
    // A idempotência do webhook. Ver o cabeçalho: é isto, e não código, que garante 1 linha.
    unique('uq_payments_gateway_event').on(table.gateway, table.gatewayEventId),
    // Receita recebida por período — a varredura do painel Financeiro.
    index('idx_payments_occurred_at').on(table.occurredAt),
    index('idx_payments_subscription').on(table.subscriptionId, table.occurredAt),
  ],
);

export type PaymentRow = typeof payments.$inferSelect;
export type NewPaymentRow = typeof payments.$inferInsert;
