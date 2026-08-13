/**
 * `model_pricing` — preço de LLM versionado por vigência (US-8.4 / TASK-8.4.3).
 *
 * Fecha o ciclo aberto pela TASK-7.2.3, que gravou o preço como constante em código com o
 * ponto de substituição já marcado (`control-center.service.ts`). Vira tabela pelo motivo
 * que a constante não resolve: **preço de LLM muda e o custo histórico não pode mudar
 * retroativamente junto**. O custo de um job usa o preço vigente **na data do job**
 * (`valid_from <= data < valid_to`), nunca o preço de hoje.
 *
 * ## Por que `numeric` e não `integer` de centavos
 * A regra 1 da sprint ("dinheiro é centavo inteiro") fala de **valor monetário**. Isto é
 * uma **taxa**: `gpt-4.1-mini` custa 0,04 centavo de dólar por 1k tokens de entrada —
 * arredondar para inteiro zeraria o custo do modelo mais barato do catálogo. `numeric` é
 * decimal exato (não é `float`, não acumula erro binário); o que vira centavo inteiro é o
 * valor apurado no fim da conta.
 *
 * ## Sem RLS, com UPDATE permitido (ao contrário de `expenses`)
 * Fechar a vigência anterior é literalmente um `UPDATE valid_to` — a tabela não pode ser
 * append-only. A garantia de não-reescrita de histórico vem da vigência, não da
 * imutabilidade da linha: escrita só sob `FINANCE_WRITE` e auditada em `audit_logs`.
 */
import { date, numeric, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn } from './_shared';
import { users } from './users';

export const modelPricing = pgTable(
  'model_pricing',
  {
    id: primaryKeyColumn(),

    /** Chave de casamento por prefixo: `gpt-4.1` casa `gpt-4.1-2025-04-14`. */
    model: text('model').notNull(),

    /** Centavos (decimais) por 1k tokens de entrada. Ver cabeçalho. */
    inputPricePer1kCents: numeric('input_price_per_1k_cents', { precision: 14, scale: 6 }).notNull(),
    outputPricePer1kCents: numeric('output_price_per_1k_cents', {
      precision: 14,
      scale: 6,
    }).notNull(),

    currency: text('currency').notNull().default('USD'),

    validFrom: date('valid_from').notNull(),

    /** `NULL` = vigente. Fechado no `valid_from` do preço seguinte do mesmo modelo. */
    validTo: date('valid_to'),

    /** `NULL` = linha semeada pela migração (não houve ator humano). */
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),

    createdAt: eventTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [unique('uq_model_pricing_model_valid_from').on(table.model, table.validFrom)],
);

export type ModelPricingRow = typeof modelPricing.$inferSelect;
