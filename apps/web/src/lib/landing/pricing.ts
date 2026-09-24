/**
 * Modelo de exibição dos planos da landing.
 *
 * Nenhum preço nasce aqui: tudo é derivado de `SUBSCRIPTION_PLANS`/`SUBSCRIPTION_PRICING`
 * (`@movivo/shared`), a mesma fonte do `PLAN_CATALOG` do checkout. Esta camada só
 * calcula o que a vitrine mostra (mensal equivalente, economia, destaque verdadeiro) e
 * centraliza os benefícios, para nenhum componente carregar número ou texto de plano.
 */
import {
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_PRICING,
  type SubscriptionPlanId,
  type SubscriptionPlanOption,
} from '@movivo/shared';

export interface LandingPlan {
  id: SubscriptionPlanId;
  label: string;
  months: number;
  discountPercent: number;
  /** Valor cobrado pelo período inteiro. */
  totalCents: number;
  /** Total ÷ meses, arredondado ao centavo — o número grande do cartão. */
  monthlyEquivalentCents: number;
  /** Quanto o mesmo período custaria no mensal. */
  fullPriceCents: number;
  savingsCents: number;
  /** Maior desconto do catálogo: o único destaque que é verdade matemática. */
  isBestValue: boolean;
  /** Plano pré-selecionado no seletor mobile (configurado em `SUBSCRIPTION_PRICING`). */
  isDefault: boolean;
}

export const PLAN_BENEFITS = [
  'Protocolo individualizado',
  'Acompanhamento pelo WhatsApp',
  'Ajustes contínuos',
  'Respaldo profissional',
  'Acesso ao MOVIVO CLUB',
] as const;

export const TRIAL_DAYS = 7;

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Centavos → "R$ 79,90" (o `Intl` usa NBSP entre símbolo e valor). */
export function formatBRL(cents: number): string {
  return brl.format(cents / 100);
}

/** Só o número, sem símbolo: "79,90". Para compor o preço grande com tipografia própria. */
export function formatAmount(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function buildLandingPlans(
  plans: readonly SubscriptionPlanOption[] = SUBSCRIPTION_PLANS,
  baseMonthlyCents: number = SUBSCRIPTION_PRICING.baseMonthlyCents,
): LandingPlan[] {
  const bestDiscount = Math.max(...plans.map((plan) => plan.discountPercent));
  return plans.map((plan) => {
    const fullPriceCents = baseMonthlyCents * plan.months;
    return {
      id: plan.id,
      label: plan.label,
      months: plan.months,
      discountPercent: plan.discountPercent,
      totalCents: plan.priceCents,
      monthlyEquivalentCents: Math.round(plan.priceCents / plan.months),
      fullPriceCents,
      savingsCents: Math.max(0, fullPriceCents - plan.priceCents),
      isBestValue: bestDiscount > 0 && plan.discountPercent === bestDiscount,
      isDefault: plan.recommended,
    };
  });
}

export const LANDING_PLANS: readonly LandingPlan[] = buildLandingPlans();

/** "a cada 3 meses" / "por ano" / "por mês" — a periodicidade da cobrança, em PT-BR. */
export function billingCadence(months: number): string {
  if (months === 1) return 'por mês';
  if (months === 12) return 'por ano';
  return `a cada ${months} meses`;
}

/** Destino do fluxo existente: a anamnese recebe o plano pelo parâmetro `plano`. */
export function anamnesisHref(plan: SubscriptionPlanId): string {
  return `/anamnese?plano=${plan}`;
}
