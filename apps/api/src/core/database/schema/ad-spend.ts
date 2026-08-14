/**
 * `ad_spend` — investimento em mídia por canal e campanha (US-8.6 / TASK-8.6.1).
 *
 * Quatro colunas que fecham a pergunta "esse anúncio funcionou?": com origem gravada
 * (US-8.2), estados gravados (US-8.3) e custo gravado (US-8.4), o que faltava era o
 * numerador do CAC.
 *
 * ## Lançamento manual é a decisão, não a preguiça
 * Com o volume de campanha atual, integrar a Meta Ads API custa mais em manutenção de
 * token e de esquema do que uma entrada semanal de 30 segundos. A integração está no
 * roadmap (Sprint 11+) atrelada a gatilho de volume, não a uma data.
 *
 * ## Fonte de verdade do gasto de mídia — regra anti-dupla-contagem
 * **`ad_spend` é a fonte de verdade do gasto de mídia por canal.** A categoria `MARKETING`
 * de `expenses` cobre marketing que **não** é mídia direta por canal (ferramenta de
 * automação, freelancer de criativo, assessoria). As duas tabelas nunca descrevem o mesmo
 * real, e por isso o custo total do painel é `expenses + ad_spend`, cada real entrando
 * exatamente uma vez. Ver `ControlCenterService.finance()` e o teste de conferência.
 *
 * ## Correção por estorno, nunca por edição
 * Mesmo princípio de `expenses`: lançou errado → grava a linha de estorno
 * (`amount_cents` negativo, `reverses_ad_spend_id` apontando para a original) e depois a
 * linha certa. `buildAdSpendImmutabilitySql` instala trigger + `REVOKE UPDATE/DELETE`.
 *
 * ## Sem RLS por titular
 * Dado da empresa, não de aluno — igual a `expenses`/`model_pricing`. O controle é por
 * capability na API (`MARKETING_READ` / `MARKETING_WRITE`) + append-only no banco.
 */
import { date, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn } from './_shared';
import { users } from './users';

export const adSpend = pgTable(
  'ad_spend',
  {
    id: primaryKeyColumn(),

    /**
     * Canal canônico da taxonomia de Helena (`CANONICAL_CHANNELS`), validado no schema Zod.
     * Guardado já canônico — diferente de `anamnesis_sessions`, aqui não existe "bruto":
     * quem lança escolhe da lista, então não há erro de marcação a preservar.
     */
    channel: text('channel').notNull(),

    /** Nome da campanha como aparece no gerenciador de anúncios. */
    campaign: text('campaign').notNull(),

    /** Competência do investimento (dia veiculado), não a data de digitação. */
    spentOn: date('spent_on').notNull(),

    /** Centavos inteiros (regra 1 da sprint). Negativo **somente** em linha de estorno. */
    amountCents: integer('amount_cents').notNull(),

    /** Preenchido só na linha de estorno: aponta o lançamento que está sendo anulado. */
    reversesAdSpendId: uuid('reverses_ad_spend_id'),

    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    createdAt: eventTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    // Um lançamento só pode ser estornado uma vez.
    unique('uq_ad_spend_reversal').on(table.reversesAdSpendId),
    index('idx_ad_spend_spent_on').on(table.spentOn),
    index('idx_ad_spend_channel').on(table.channel, table.spentOn),
  ],
);

export type AdSpendRow = typeof adSpend.$inferSelect;
export type NewAdSpendRow = typeof adSpend.$inferInsert;
