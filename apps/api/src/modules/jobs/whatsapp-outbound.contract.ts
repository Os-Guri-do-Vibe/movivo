export interface WhatsappQuickReplyButton {
  id: string;
  title: string;
}

export type WhatsappJobType =
  | 'CONFIRMATION'
  | 'CONFIRMATION_CARE'
  | 'PROTOCOL_DELIVERY'
  | 'PROTOCOL_WAITING'
  | 'COACH_MESSAGE'
  | 'CHECKIN_MESSAGE'
  | 'REENGAGEMENT'
  | 'CONSENT_STATUS'
  | 'TYPING';

/** Contrato de fila compartilhado: produtores nao importam o dominio WhatsApp. */
export interface WhatsappOutboundJob {
  userId: string;
  type: WhatsappJobType;
  protocolId?: string;
  protocolVersion?: number;
  text?: string;
  dedupeId?: string;
  feedback?: boolean;
  buttons?: readonly WhatsappQuickReplyButton[];
}
