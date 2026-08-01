/**
 * Modelo de domínio da assinatura (US-4.1) — plano por período + máquina de estados. PURO
 * (sem I/O): o catálogo de preços (centavos inteiros) e as transições permitidas. As
 * transições só são disparadas por evento válido do gateway ou ação self-service autorizada
 * (o `SubscriptionService` aplica; este arquivo só decide se a transição é legítima).
 */
import { type SubscriptionStatus } from '@movivo/shared';

/** Planos ofertados no MVP (decisão do fundador 2026-08-01) — os quatro na UI. */
export type SubscriptionPlan = 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'ANNUAL';

export interface PlanSpec {
  /** Preço em centavos inteiros — nunca float para dinheiro. */
  priceCents: number;
  /** Duração do período em dias (renovação/expiração). */
  periodDays: number;
}

/**
 * Catálogo de planos. Preços validados por Eduardo (unit economics).
 * ponytail: SEMIANNUAL usa preço placeholder (18900c) até Eduardo fechar o valor — trocar aqui.
 */
export const PLAN_CATALOG: Record<SubscriptionPlan, PlanSpec> = {
  MONTHLY: { priceCents: 3900, periodDays: 30 },
  QUARTERLY: { priceCents: 9900, periodDays: 90 },
  SEMIANNUAL: { priceCents: 18900, periodDays: 180 },
  ANNUAL: { priceCents: 34900, periodDays: 365 },
};

export const TRIAL_DAYS = 7;

/**
 * Transições permitidas da máquina de estados. Um estado ausente do array de destino é
 * uma transição inválida (rejeitada). `CANCELED` é terminal; `EXPIRED` permite win-back.
 */
const ALLOWED_TRANSITIONS: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  TRIALING: ['ACTIVE', 'EXPIRED', 'CANCELED'],
  ACTIVE: ['PAST_DUE', 'PAUSED', 'CANCELED'],
  PAST_DUE: ['ACTIVE', 'CANCELED', 'EXPIRED'],
  PAUSED: ['ACTIVE', 'CANCELED'],
  EXPIRED: ['ACTIVE'], // win-back (US-4.4)
  CANCELED: [], // terminal
};

/** A transição `from → to` é legítima? (idempotente: `from === to` é sempre permitido no-op). */
export function canTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Erro de transição inválida da máquina de estados. */
export class InvalidTransitionError extends Error {
  constructor(
    readonly from: SubscriptionStatus,
    readonly to: SubscriptionStatus,
  ) {
    super(`transição de assinatura inválida: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}
