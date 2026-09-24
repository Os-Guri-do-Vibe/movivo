/**
 * Contratos de assinatura (US-4.6) — fonte única dos planos e dos DTOs de checkout/portal
 * entre `apps/api` e `apps/web`.
 *
 * `SUBSCRIPTION_PLANS` é a fonte de verdade dos preços do MVP (4 planos, decisão do
 * fundador 2026-08-01): o backend deriva daqui o `PLAN_CATALOG` (checkout) e o frontend
 * renderiza a página `/assinar` — sem divergência de preço entre a UI e a cobrança.
 * Os DTOs de entrada carregam PII/cartão somente durante o request transparente ao Sandbox;
 * nenhum desses dados retorna na resposta ou é persistido.
 */
import { z } from 'zod';

import { subscriptionStatusSchema } from './common.schema';

export const SUBSCRIPTION_PLAN_IDS = ['MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL'] as const;
export const subscriptionPlanIdSchema = z.enum(SUBSCRIPTION_PLAN_IDS);
export type SubscriptionPlanId = (typeof SUBSCRIPTION_PLAN_IDS)[number];

/** Meios realmente suportados pelo checkout MOVIVO/Asaas. Carteiras não homologadas ficam fora. */
export const paymentMethodSchema = z.enum(['CARD', 'PIX', 'PIX_AUTOMATIC']);
export type PaymentMethodId = z.infer<typeof paymentMethodSchema>;

export interface SubscriptionPlanOption {
  id: SubscriptionPlanId;
  label: string;
  /** Preço em centavos inteiros — nunca float para dinheiro. */
  priceCents: number;
  /** Mensalidade equivalente/recorrente, também em centavos. */
  monthlyCents: number;
  periodDays: number;
  /** Meses cobertos pelo período (base do preço mensal equivalente). */
  months: number;
  /** Desconto inteiro (%) da mensalidade do plano sobre a mensalidade base. */
  discountPercent: number;
  /** Plano pré-selecionado/recomendado na UI (sem dark pattern: cancelar é sempre fácil). */
  recommended: boolean;
}

/**
 * Regra de preço do MVP (fundador, 2026-09-23): cada plano tem um preço MENSAL fechado
 * (R$ 79,90 / 75,90 / 71,90 / 67,90) e o período cobra `mensal × meses`. Todo o resto é
 * DERIVADO daqui — total, desconto exibido e economia — nunca digitado à mão, para a
 * landing, o `/assinar` e o `PLAN_CATALOG` do checkout nunca divergirem.
 */
export const SUBSCRIPTION_PRICING = {
  /** Mensalidade do plano mensal: a base do desconto e da economia dos demais. */
  baseMonthlyCents: 7990,
  plans: [
    { id: 'MONTHLY', label: 'Mensal', months: 1, monthlyCents: 7990, periodDays: 30 },
    { id: 'QUARTERLY', label: 'Trimestral', months: 3, monthlyCents: 7590, periodDays: 90 },
    { id: 'SEMIANNUAL', label: 'Semestral', months: 6, monthlyCents: 7190, periodDays: 180 },
    { id: 'ANNUAL', label: 'Anual', months: 12, monthlyCents: 6790, periodDays: 365 },
  ],
  recommendedPlan: 'SEMIANNUAL',
} as const satisfies {
  baseMonthlyCents: number;
  plans: readonly (Omit<
    SubscriptionPlanOption,
    'priceCents' | 'recommended' | 'discountPercent'
  > & {
    monthlyCents: number;
  })[];
  recommendedPlan: SubscriptionPlanId;
};

/** Preço do período em centavos: mensalidade do plano × meses (aritmética inteira). */
export function planPriceCents(months: number, monthlyCents: number): number {
  return months * monthlyCents;
}

/**
 * Desconto exibido (%): o desconto real da mensalidade do plano sobre a base, arredondado
 * ao inteiro (75,90 sobre 79,90 = 5,006% → 5%). Nunca maior que o real em mais de meio
 * ponto — o selo "X% OFF" é sempre verdadeiro.
 */
export function planDiscountPercent(
  monthlyCents: number,
  baseMonthlyCents: number = SUBSCRIPTION_PRICING.baseMonthlyCents,
): number {
  return Math.max(0, Math.round((1 - monthlyCents / baseMonthlyCents) * 100));
}

/** Catálogo do MVP, derivado de `SUBSCRIPTION_PRICING`. */
export const SUBSCRIPTION_PLANS: readonly SubscriptionPlanOption[] = SUBSCRIPTION_PRICING.plans.map(
  ({ monthlyCents, ...plan }) => ({
    ...plan,
    monthlyCents,
    priceCents: planPriceCents(plan.months, monthlyCents),
    discountPercent: planDiscountPercent(monthlyCents),
    recommended: plan.id === SUBSCRIPTION_PRICING.recommendedPlan,
  }),
);

const digits = (minimum: number, maximum = minimum) =>
  z
    .string()
    .transform((value) => value.replace(/\D/g, ''))
    .pipe(z.string().min(minimum).max(maximum));

/** Dados cadastrais exigidos pelo Asaas. Não são dados de cartão e não voltam na resposta. */
export const checkoutPayerSchema = z.object({
  name: z.string().trim().min(2).max(255),
  email: z.email().max(255),
  cpfCnpj: digits(11, 14),
  postalCode: digits(8),
  addressNumber: z.string().trim().min(1).max(20),
  addressComplement: z.string().trim().max(255).optional(),
  phone: digits(10, 13),
});
export type CheckoutPayer = z.infer<typeof checkoutPayerSchema>;

/**
 * Dados de cartão só existem no request em memória e seguem direto ao Asaas. Nunca entram em
 * resposta, banco ou log. A ativação em produção permanece condicionada à validação PCI/QSA.
 */
export const checkoutCardSchema = z.object({
  holderName: z.string().trim().min(2).max(255),
  number: digits(13, 19),
  expiryMonth: digits(1, 2).refine((value) => {
    const month = Number(value);
    return month >= 1 && month <= 12;
  }, 'Mês inválido'),
  expiryYear: digits(4),
  ccv: digits(3, 4),
});
export type CheckoutCard = z.infer<typeof checkoutCardSchema>;

const payerPaymentFields = { payer: checkoutPayerSchema } as const;

/** Body do início do pagamento. Plano e preço são resolvidos pelo token no backend. */
export const createCheckoutSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('CARD'),
    ...payerPaymentFields,
    card: checkoutCardSchema,
    installments: z.number().int().min(1).max(12),
    acceptTerms: z.literal(true),
  }),
  z.object({
    method: z.literal('PIX'),
    ...payerPaymentFields,
    acceptTerms: z.literal(true),
    regenerate: z.boolean().optional(),
  }),
  z.object({
    method: z.literal('PIX_AUTOMATIC'),
    ...payerPaymentFields,
    acceptTerms: z.literal(true),
    regenerate: z.boolean().optional(),
  }),
]);
export type CreateCheckoutBody = z.infer<typeof createCheckoutSchema>;

export const checkoutSummarySchema = z.object({
  plan: subscriptionPlanIdSchema,
  label: z.string(),
  monthlyCents: z.number().int().positive(),
  totalCents: z.number().int().positive(),
  months: z.number().int().positive(),
  maxInstallments: z.number().int().positive(),
  status: subscriptionStatusSchema,
  expiresAt: z.iso.datetime(),
  methods: z.array(paymentMethodSchema),
});
export type CheckoutSummary = z.infer<typeof checkoutSummarySchema>;

export const checkoutPaymentResultSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'REFUSED', 'EXPIRED']),
  method: paymentMethodSchema,
  qrCode: z
    .object({
      encodedImage: z.string(),
      payload: z.string(),
      expirationDate: z.string(),
    })
    .optional(),
  nextBillingAt: z.string().optional(),
  message: z.string().optional(),
});
export type CheckoutPaymentResult = z.infer<typeof checkoutPaymentResultSchema>;

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
