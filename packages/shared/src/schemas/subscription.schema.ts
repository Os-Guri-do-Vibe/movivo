/**
 * Contratos de assinatura (US-4.6) — fonte única dos planos e dos DTOs de checkout/portal
 * entre `apps/api` e `apps/web`.
 *
 * `SUBSCRIPTION_PLANS` é a fonte de verdade dos preços do MVP (4 planos, decisão do
 * fundador 2026-08-01): o backend deriva daqui o `PLAN_CATALOG` (checkout) e o frontend
 * renderiza a página `/assinar` — sem divergência de preço entre a UI e a cobrança.
 * Nenhum DTO aqui carrega PII ou dado de cartão (o checkout é hospedado pelo gateway, PCI).
 */
import { z } from 'zod';

import { subscriptionStatusSchema } from './common.schema';

export const SUBSCRIPTION_PLAN_IDS = ['MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL'] as const;
export const subscriptionPlanIdSchema = z.enum(SUBSCRIPTION_PLAN_IDS);
export type SubscriptionPlanId = (typeof SUBSCRIPTION_PLAN_IDS)[number];

/** Meio de pagamento do checkout (decisão do fundador: PIX avulso ou cartão recorrente). */
export const paymentMethodSchema = z.enum(['CARD', 'PIX']);
export type PaymentMethodId = z.infer<typeof paymentMethodSchema>;

export interface SubscriptionPlanOption {
  id: SubscriptionPlanId;
  label: string;
  /** Preço em centavos inteiros — nunca float para dinheiro. */
  priceCents: number;
  periodDays: number;
  /** Plano pré-selecionado/recomendado na UI (sem dark pattern: cancelar é sempre fácil). */
  recommended: boolean;
}

/**
 * Catálogo do MVP. Preços validados por Eduardo (unit economics).
 * ponytail: SEMIANNUAL usa preço placeholder (18900c) até Eduardo fechar o valor — trocar aqui.
 */
export const SUBSCRIPTION_PLANS: readonly SubscriptionPlanOption[] = [
  { id: 'MONTHLY', label: 'Mensal', priceCents: 3900, periodDays: 30, recommended: false },
  { id: 'QUARTERLY', label: 'Trimestral', priceCents: 9900, periodDays: 90, recommended: true },
  { id: 'SEMIANNUAL', label: 'Semestral', priceCents: 18900, periodDays: 180, recommended: false },
  { id: 'ANNUAL', label: 'Anual', priceCents: 34900, periodDays: 365, recommended: false },
];

/** Body do checkout (`POST /subscription/:token/checkout`). Sem dado de cartão (PCI). */
export const createCheckoutSchema = z.object({
  plan: subscriptionPlanIdSchema,
  method: paymentMethodSchema,
});
export type CreateCheckoutBody = z.infer<typeof createCheckoutSchema>;

/** Resposta do checkout: só a URL hospedada do gateway para redirecionar. */
export const checkoutSessionSchema = z.object({ checkoutUrl: z.url() });
export type CheckoutSessionView = z.infer<typeof checkoutSessionSchema>;

/**
 * Estado do portal (`GET /subscription/:token`) — o que `/conta/[token]` renderiza.
 * Sem PII, sem dado de cartão, sem id externo do gateway: só plano, estado, acesso e a
 * próxima cobrança.
 */
export const subscriptionViewSchema = z.object({
  plan: subscriptionPlanIdSchema,
  status: subscriptionStatusSchema,
  access: z.enum(['FULL', 'RESTRICTED']),
  currentPeriodEnd: z.iso.datetime().nullable(),
});
export type SubscriptionView = z.infer<typeof subscriptionViewSchema>;
