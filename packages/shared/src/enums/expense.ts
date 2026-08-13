/**
 * Plano de categorias de despesa (US-8.4 / TASK-8.4.1) — **decisão de Eduardo**, não de
 * engenharia. É ENUM nativo no Postgres: cada categoria mal desenhada aqui vira migration
 * de ENUM depois. Fechado no dia 2 da Sprint 8.
 */
export const ExpenseCategory = {
  INFRA: 'INFRA',
  IA_LLM: 'IA_LLM',
  WHATSAPP: 'WHATSAPP',
  GATEWAY_PAGAMENTO: 'GATEWAY_PAGAMENTO',
  MARKETING: 'MARKETING',
  JURIDICO_CONTABIL: 'JURIDICO_CONTABIL',
  FERRAMENTAS: 'FERRAMENTAS',
  PESSOAS: 'PESSOAS',
  IMPOSTOS: 'IMPOSTOS',
  OUTROS: 'OUTROS',
} as const;
export type ExpenseCategory = (typeof ExpenseCategory)[keyof typeof ExpenseCategory];

/** Periodicidade de uma despesa recorrente. Só faz sentido com `isRecurring = true`. */
export const ExpenseRecurrencePeriod = {
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
  YEARLY: 'YEARLY',
} as const;
export type ExpenseRecurrencePeriod =
  (typeof ExpenseRecurrencePeriod)[keyof typeof ExpenseRecurrencePeriod];

/**
 * Regime de apuração do lucro exibido no Control Center.
 *
 * O regime alvo é **CAIXA** (sobre receita recebida). Enquanto `payments` não existe
 * (US-8.5, mesma sprint), o lucro usa `contractedMrr` como proxy e o regime exibido é
 * `CONTRATADO_PROXY` — a tela nunca chama de caixa um número que não é.
 */
export const ProfitBasis = {
  CAIXA: 'CAIXA',
  CONTRATADO_PROXY: 'CONTRATADO_PROXY',
} as const;
export type ProfitBasis = (typeof ProfitBasis)[keyof typeof ProfitBasis];
