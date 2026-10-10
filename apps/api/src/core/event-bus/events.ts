/**
 * US-8.1 — toque no quick reply diário de treino. Único elo da cadeia de inbound
 * determinística desde que o check-in semanal virou formulário web (achado 2026-09-13,
 * removeu `CHECKIN_INBOUND_EVENT` — sem botão de WhatsApp pra rotear).
 */
export const WORKOUT_INBOUND_EVENT = 'workout.inbound.received';

/** O conteudo fica efemero no Redis; o evento transporta somente referencias opacas. */
export interface CheckinInboundEvent {
  userId: string;
  routeKey: string;
}

export type { DashboardQueueReason } from './dashboard-queue-events.service';

/** Mensagem recebida no WhatsApp que pode ser um pedido de cancelamento/gerenciamento de assinatura. */
export const SUBSCRIPTION_INBOUND_EVENT = 'subscription.inbound.received';

/** Só o texto da própria mensagem e o titular já autenticado pelo canal. */
export interface SubscriptionInboundEvent {
  userId: string;
  text: string;
  /** Identificador estável da mensagem (hash) — idempotência da resposta. */
  messageKey: string;
}
