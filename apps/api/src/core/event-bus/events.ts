/** Mensagem recebida no WhatsApp que pode ser um pedido de cancelamento/gerenciamento de assinatura. */
export const SUBSCRIPTION_INBOUND_EVENT = 'subscription.inbound.received';

/** Mensagem recebida no WhatsApp que pode ser um registro/comando do ciclo menstrual. */
export const CYCLE_INBOUND_EVENT = 'cycle.inbound.received';

/** Mensagem recebida no WhatsApp que pode ser "conectar/desconectar Strava". */
export const WEARABLE_INBOUND_EVENT = 'wearable.inbound.received';

/** Só o texto da própria mensagem e o titular já autenticado pelo canal. */
export interface InboundTextEvent {
  userId: string;
  text: string;
  /** Identificador estável da mensagem (hash) — idempotência da resposta. */
  messageKey: string;
}

/** Foto ou PDF recebido no WhatsApp, já baixado e conferido (tipo e tamanho): exame. */
export const MEDIA_INBOUND_EVENT = 'media.inbound.received';

export interface InboundMediaEvent {
  userId: string;
  messageKey: string;
  mediaType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';
  bytes: Buffer;
}
