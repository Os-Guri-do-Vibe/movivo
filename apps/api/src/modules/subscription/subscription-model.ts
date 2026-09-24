/**
 * Modelo de domínio da assinatura (US-4.1) — plano por período + máquina de estados. PURO
 * (sem I/O): o catálogo de preços (centavos inteiros) e as transições permitidas. As
 * transições só são disparadas por evento válido do gateway ou ação self-service autorizada
 * (o `SubscriptionService` aplica; este arquivo só decide se a transição é legítima).
 */
import {
  SUBSCRIPTION_PLANS,
  type SubscriptionPlanId,
  type SubscriptionStatus,
} from '@movivo/shared';

import type { GatewayEvent } from './payment/payment-gateway.types';

/** Planos ofertados no MVP (decisão do fundador 2026-08-01) — fonte única em `@movivo/shared`. */
export type SubscriptionPlan = SubscriptionPlanId;

export interface PlanSpec {
  /** Total do contrato em centavos inteiros — nunca float para dinheiro. */
  priceCents: number;
  monthlyCents: number;
  months: number;
  /** Duração do período em dias (renovação/expiração). */
  periodDays: number;
}

/**
 * Catálogo de planos derivado de `SUBSCRIPTION_PLANS` (shared) — mesma fonte que a UI de
 * `/assinar`, para o preço do checkout nunca divergir do preço exibido. Preços validados
 * por Eduardo (unit economics).
 */
export const PLAN_CATALOG: Record<SubscriptionPlan, PlanSpec> = Object.fromEntries(
  SUBSCRIPTION_PLANS.map((p) => [
    p.id,
    {
      priceCents: p.priceCents,
      monthlyCents: p.monthlyCents,
      months: p.months,
      periodDays: p.periodDays,
    },
  ]),
) as Record<SubscriptionPlan, PlanSpec>;

export const TRIAL_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

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
  TRIALING: ['PENDING_PAYMENT', 'ACTIVE', 'EXPIRED', 'CANCELED'],
  PENDING_PAYMENT: ['ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELED'],
  // `EXPIRED`: período pago terminou sem renovação (varredura de fim de período).
  ACTIVE: ['PAST_DUE', 'PAUSED', 'CANCELED', 'EXPIRED'],
  PAST_DUE: ['PENDING_PAYMENT', 'ACTIVE', 'CANCELED', 'EXPIRED'],
  PAUSED: ['ACTIVE', 'CANCELED'],
  EXPIRED: ['PENDING_PAYMENT', 'ACTIVE'], // win-back (US-4.4)
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
  /** Fim do período já pago. Cancelamento não apaga o que foi pago; estorno encerra na hora. */
  currentPeriodEnd?: Date | null;
}

/**
 * Deriva o acesso do estado da assinatura (US-4.2.3): TRIALING dentro da janela e ACTIVE →
 * FULL; PAST_DUE dentro da graça → FULL (dunning, não bloqueio abrupto); CANCELED até o fim
 * do período pago → FULL; trial expirado, PAUSED, EXPIRED, PENDING_PAYMENT, CANCELED sem
 * período pago vigente, ou PAST_DUE após a graça → RESTRICTED. `null` = sem assinatura.
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
    case 'CANCELED':
      // Cancelar interrompe cobranças futuras, não o período que o aluno já pagou.
      return sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() > nowMs ? 'FULL' : 'RESTRICTED';
    default:
      return 'RESTRICTED'; // PENDING_PAYMENT / PAUSED / EXPIRED
  }
}

/** Campos do contrato vigente usados para decidir cobrança recorrente e vínculo de eventos. */
export interface ContractInput {
  plan: SubscriptionPlan;
  paymentMethod: string | null;
  externalSubscriptionId: string | null;
  externalPaymentId: string | null;
  externalInstallmentId: string | null;
  externalAuthorizationId: string | null;
}

/**
 * O Asaas volta a cobrar sozinho? Só a assinatura mensal no cartão e o Pix Automático (um
 * débito por mês até o fim do contrato). Parcelado no cartão e Pix à vista já cobraram o
 * período inteiro: não há próxima cobrança a esperar nem a cancelar.
 */
export function isRecurringContract(sub: Pick<ContractInput, 'plan' | 'paymentMethod'>): boolean {
  return (
    sub.paymentMethod === 'PIX_AUTOMATIC' ||
    (sub.paymentMethod === 'CARD' && sub.plan === 'MONTHLY')
  );
}

/** IDs externos do contrato vigente (qualquer um deles identifica o contrato no Asaas). */
export function contractIdsOf(sub: ContractInput): string[] {
  return [
    sub.externalSubscriptionId,
    sub.externalPaymentId,
    sub.externalInstallmentId,
    sub.externalAuthorizationId,
  ].filter((id): id is string => Boolean(id));
}

/**
 * O evento fala do contrato vigente? Um cancelamento/falha/estorno de um contrato já
 * substituído (Pix regenerado, troca de método) não pode mexer no acesso do contrato novo.
 */
export function referencesContract(
  event: Pick<
    GatewayEvent,
    | 'externalSubscriptionId'
    | 'externalPaymentId'
    | 'externalInstallmentId'
    | 'externalAuthorizationId'
  >,
  sub: ContractInput,
): boolean {
  const current = new Set(contractIdsOf(sub));
  return [
    event.externalSubscriptionId,
    event.externalPaymentId,
    event.externalInstallmentId,
    event.externalAuthorizationId,
  ].some((id) => Boolean(id) && current.has(id as string));
}

/**
 * Até quando o evento de liquidação paga o acesso. Contrato recorrente cobre um mês por
 * cobrança, contado do vencimento (competência) — assim a confirmação tardia de um mês antigo
 * nunca empurra o período para frente. Contrato de cobrança única cobre o período inteiro.
 */
export function paidThroughFor(
  sub: Pick<ContractInput, 'plan' | 'paymentMethod'>,
  dueDate: string | undefined,
  now: Date = new Date(),
): Date {
  if (isRecurringContract(sub)) {
    const parsed = dueDate ? new Date(dueDate) : now;
    const start = Number.isNaN(parsed.getTime()) ? now : parsed;
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    return end;
  }
  return new Date(now.getTime() + PLAN_CATALOG[sub.plan].periodDays * DAY_MS);
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
