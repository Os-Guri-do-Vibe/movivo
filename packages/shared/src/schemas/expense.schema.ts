/**
 * Contratos de escrita financeira (US-8.4): lançamento e estorno de despesa, e
 * vigência de preço de modelo.
 *
 * **Não existe schema de UPDATE de valor.** Correção de lançamento é estorno (linha de
 * sinal contrário) + novo lançamento — livro-caixa que se edita é livro-caixa em que
 * ninguém confia. A ausência aqui é deliberada, não é lacuna.
 */
import { z } from 'zod';

import { ExpenseCategory, ExpenseRecurrencePeriod } from '../enums/expense';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar em `YYYY-MM-DD`.');

export const expenseCategorySchema = z.enum(
  Object.values(ExpenseCategory) as [ExpenseCategory, ...ExpenseCategory[]],
);
export const expenseRecurrencePeriodSchema = z.enum(
  Object.values(ExpenseRecurrencePeriod) as [ExpenseRecurrencePeriod, ...ExpenseRecurrencePeriod[]],
);

export const createExpenseSchema = z
  .object({
    /** Competência do gasto — a data da nota, não a data de digitação. */
    occurredOn: isoDate,
    /** Centavos inteiros e positivos (regra 1 da Sprint 8). Estorno é endpoint próprio. */
    amountCents: z.number().int().positive().max(1_000_000_000),
    currency: z.literal('BRL').default('BRL'),
    category: expenseCategorySchema,
    supplier: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(500),
    isRecurring: z.boolean().default(false),
    recurrencePeriod: expenseRecurrencePeriodSchema.nullish(),
    /**
     * Referência textual ao comprovante (URL do Drive, número da NF). **Não é upload de
     * arquivo** — anexo é escopo da Sprint 10, e isso é intencional.
     */
    receiptRef: z.string().trim().max(500).nullish(),
  })
  .refine((input) => !input.isRecurring || Boolean(input.recurrencePeriod), {
    message: 'Despesa recorrente exige `recurrencePeriod`.',
    path: ['recurrencePeriod'],
  });
export type CreateExpenseInput = z.input<typeof createExpenseSchema>;

export const reverseExpenseSchema = z.object({
  /** Motivo do estorno. Sem motivo o histórico não explica por que o número mudou. */
  reason: z.string().trim().min(3).max(500),
});

export const createModelPricingSchema = z.object({
  model: z.string().trim().min(1).max(120),
  /**
   * Preço por 1k tokens **em centavos da moeda**, decimal exato (`numeric`, nunca float).
   * É uma taxa, não um valor monetário: `gpt-4.1-mini` custa 0.04 centavo de dólar por 1k
   * tokens de entrada — arredondar para inteiro zeraria o custo. O valor apurado final é
   * que vira centavo inteiro.
   */
  inputPricePer1kCents: z.number().nonnegative().max(1_000_000),
  outputPricePer1kCents: z.number().nonnegative().max(1_000_000),
  currency: z.enum(['USD', 'BRL']).default('USD'),
  /** Início da vigência. O preço anterior do mesmo modelo é fechado nesta data. */
  validFrom: isoDate,
});
export type CreateModelPricingInput = z.input<typeof createModelPricingSchema>;
