/**
 * Estados possíveis de uma assinatura MOVIVO.
 *
 * Fonte: bounded context SUBSCRIPTION & BILLING (`docs/arquitetura/ARQUITETURA.md` §7)
 * e modelo de negócio de Eduardo (`07-relatorio-eduardo.md`): plano único por período
 * (mensal / trimestral / anual) com trial de 7 dias sem cartão.
 *
 * Apenas constantes — nenhuma lógica de transição de estado vive aqui (regra da TASK-0.1.4).
 * As máquinas de estado ficam no módulo SUBSCRIPTION do backend (Sprint 4).
 */
export const SubscriptionStatus = {
  /** Trial de 7 dias, sem cartão cadastrado. */
  TRIALING: 'TRIALING',
  /** Assinatura paga e adimplente. */
  ACTIVE: 'ACTIVE',
  /** Cobrança falhou; em janela de recuperação (dunning). */
  PAST_DUE: 'PAST_DUE',
  /** Cancelada pelo usuário; pode seguir ativa até o fim do período pago. */
  CANCELED: 'CANCELED',
  /** Trial ou período pago terminou sem renovação. */
  EXPIRED: 'EXPIRED',
} as const;

export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const SUBSCRIPTION_STATUSES = Object.values(SubscriptionStatus);
