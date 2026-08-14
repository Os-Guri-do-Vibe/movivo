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
  | 'WORKOUT_QUICK_REPLY'
  | 'REENGAGEMENT'
  | 'CONSENT_STATUS'
  | 'PHONE_VERIFICATION'
  | 'TYPING';

/** Contrato de fila compartilhado: produtores nao importam o dominio WhatsApp. */
export interface WhatsappOutboundJob {
  /**
   * Ausente APENAS em `PHONE_VERIFICATION` (US-6.5): o código é enviado na Etapa 1 do
   * onboarding, quando ainda não existe `users` para o worker resolver o telefone sob RLS.
   */
  userId: string | null;
  type: WhatsappJobType;
  protocolId?: string;
  protocolVersion?: number;
  text?: string;
  dedupeId?: string;
  feedback?: boolean;
  buttons?: readonly WhatsappQuickReplyButton[];
  /** `PHONE_VERIFICATION`: destino e código. Só neste tipo o telefone viaja no payload. */
  phoneNumber?: string;
  code?: string;
}
