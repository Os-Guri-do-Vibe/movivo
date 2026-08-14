/**
 * Contratos de lançamento de investimento em mídia (US-8.6 / TASK-8.6.1).
 *
 * Mesmo princípio de `expense.schema.ts`: **não existe schema de UPDATE de valor**.
 * Corrigir um lançamento é gravar o estorno (linha de sinal contrário apontando para a
 * original) e depois o lançamento certo — `ad_spend` é o numerador do CAC, e um número
 * que muda em silêncio invalida a decisão de anúncio que foi tomada sobre o valor antigo.
 */
import { z } from 'zod';

import { CANONICAL_CHANNELS } from '../attribution';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar em `YYYY-MM-DD`.');

/** Canal já canônico (taxonomia de Helena). Quem lança escolhe da lista. */
export const adSpendChannelSchema = z.enum(CANONICAL_CHANNELS);

export const createAdSpendSchema = z.object({
  channel: adSpendChannelSchema,
  /** Nome da campanha como aparece no gerenciador de anúncios. */
  campaign: z.string().trim().min(1).max(160),
  /** Competência do investimento (dia veiculado), não a data de digitação. */
  spentOn: isoDate,
  /** Centavos inteiros e positivos (regra 1 da Sprint 8). Estorno é endpoint próprio. */
  amountCents: z.number().int().positive().max(1_000_000_000),
});
export type CreateAdSpendInput = z.input<typeof createAdSpendSchema>;

export const reverseAdSpendSchema = z.object({
  /** Sem motivo o histórico não explica por que o CAC do período mudou. */
  reason: z.string().trim().min(3).max(500),
});
