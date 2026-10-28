/** Mensagem recebida no WhatsApp que pode ser um pedido de cancelamento/gerenciamento de assinatura. */
export const SUBSCRIPTION_INBOUND_EVENT = 'subscription.inbound.received';

/** Só o texto da própria mensagem e o titular já autenticado pelo canal. */
export interface SubscriptionInboundEvent {
  userId: string;
  text: string;
  /** Identificador estável da mensagem (hash) — idempotência da resposta. */
  messageKey: string;
}
