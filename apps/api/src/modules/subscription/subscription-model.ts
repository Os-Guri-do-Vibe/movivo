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
 * Versão vigente dos Termos de Assinatura (US-4.1.3 / CDC). ponytail: rascunho — Alexandre
 * ratifica o texto/versão no lançamento; muda o valor quando o contrato for aprovado.
 */
export const SUBSCRIPTION_TERMS_VERSION = 'sub-terms-2026-08-v1'; // ≤30 (coluna varchar(30))

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

/** Nível de acesso derivado da assinatura (US-4.2.3) — a fonte é o estado, não o app. */
export type AccessLevel = 'FULL' | 'RESTRICTED';

/** Campos da assinatura que decidem o acesso (subset — puro, sem I/O). */
export interface AccessInput {
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  /** Marca da última transição — âncora da janela de graça do PAST_DUE. */
  updatedAt: Date;
}

/**
 * Deriva o acesso do estado da assinatura (US-4.2.3): TRIALING dentro da janela e ACTIVE →
 * FULL; PAST_DUE dentro da graça → FULL (dunning, não bloqueio abrupto); trial expirado,
 * PAUSED, CANCELED, EXPIRED, ou PAST_DUE após a graça → RESTRICTED. `null` = sem assinatura.
 * ponytail: usa `updatedAt` como âncora da graça do PAST_DUE; coluna dedicada se as
 * transições ficarem ruidosas.
 */
export function resolveAccess(
  sub: AccessInput | null,
  graceDays: number,
  now: Date = new Date(),
): AccessLevel {
  if (!sub) return 'RESTRICTED';
  const nowMs = now.getTime();
  switch (sub.status) {
    case 'ACTIVE':
      return 'FULL';
    case 'TRIALING':
      return sub.trialEndsAt && sub.trialEndsAt.getTime() > nowMs ? 'FULL' : 'RESTRICTED';
    case 'PAST_DUE':
      return nowMs - sub.updatedAt.getTime() <= graceDays * 24 * 60 * 60 * 1000
        ? 'FULL'
        : 'RESTRICTED';
    default:
      return 'RESTRICTED'; // PAUSED / CANCELED / EXPIRED
  }
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
