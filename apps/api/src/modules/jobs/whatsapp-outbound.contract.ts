/**
 * Separador de balões: um texto com `\n---\n` vira UMA mensagem do WhatsApp por trecho
 * (`WhatsappOutboundWorker.sendBubbles`). Vive no contrato porque quem produz o texto
 * (workout, coach) não importa o domínio WhatsApp; a definição é compartilhada com o painel.
 */
export { WHATSAPP_BUBBLE_SEPARATOR } from '@movivo/shared';

export interface WhatsappQuickReplyButton {
  id: string;
  title: string;
}

export type WhatsappJobType =
  | 'CONFIRMATION'
  | 'CONFIRMATION_CARE'
  | 'PROTOCOL_DELIVERY'
  | 'PROTOCOL_WAITING'
  | 'MESOCYCLE_RENEWAL_INVITE'
  | 'COACH_MESSAGE'
  | 'CHECKIN_MESSAGE'
  | 'WORKOUT_DAILY_LINK'
  | 'WORKOUT_INSIGHT'
  | 'REENGAGEMENT'
  | 'CONSENT_STATUS'
  // Texto escrito à mão pelo profissional na aba "Conversas" (atendimento automático pausado).
  | 'MANUAL_MESSAGE'
  | 'PHONE_VERIFICATION'
  // Alerta ao profissional (número configurado, não o do aluno) de item novo na fila de revisão.
  | 'STAFF_QUEUE_ALERT'
  | 'TYPING';

export type StaffQueueAlertKind = 'PROTOCOL_REVIEW' | 'SUBSTITUTION_REVIEW';

/** Contrato de fila compartilhado: produtores nao importam o dominio WhatsApp. */
export interface WhatsappOutboundJob {
  /**
   * Ausente APENAS em `PHONE_VERIFICATION` (US-6.5): o código é enviado na Etapa 1 do
   * onboarding, quando ainda não existe `users` para o worker resolver o telefone sob RLS.
   */
  userId: string | null;
  type: WhatsappJobType;
  /** `STAFF_QUEUE_ALERT` apenas: o que entrou na fila (o aluno é `userId`). */
  staffAlertKind?: StaffQueueAlertKind;
  protocolId?: string;
  protocolVersion?: number;
  text?: string;
  dedupeId?: string;
  /**
   * Pendência de conversa que ESTE envio abre (`conversation_followups`): hoje, a pergunta
   * sobre o treino sem registro que viaja dentro do link do dia.
   */
  followupId?: string;
  /**
   * Texto enviado no lugar de `text` quando a pendência deixou de ser enviável entre o
   * enfileiramento e o envio (o aluno já voltou a treinar). Sem ele o envio seria descartado;
   * com ele, o link do dia SEMPRE sai, só que sem a pergunta.
   */
  fallbackText?: string;
  feedback?: boolean;
  buttons?: readonly WhatsappQuickReplyButton[];
  /** `PHONE_VERIFICATION`: destino e código. Só neste tipo o telefone viaja no payload. */
  phoneNumber?: string;
  code?: string;
  /**
   * `PROTOCOL_DELIVERY` apenas (achado 2026-09-08): distingue a 1ª entrega do treino de uma
   * reentrega após substituição de exercício aprovada, ou (achado 2026-09-13) após ajuste de
   * volume pelo check-in semanal — a saudação estática muda (ver `protocolDeliveryPdfText`).
   * Ausente/`'INITIAL'` mantém o texto de sempre.
   */
  deliveryReason?: 'INITIAL' | 'SUBSTITUTION' | 'CHECKIN_ADJUSTMENT';
  /** Só com `deliveryReason: 'SUBSTITUTION'` — nomes do exercício trocado, pra saudação.
   * Com troca em lote, espelham a 1ª troca; a lista completa está em `substitutionChanges`. */
  substitutionFromExercise?: string;
  substitutionToExercise?: string;
  /** Só com `deliveryReason: 'SUBSTITUTION'` — todas as trocas aplicadas (troca em lote). */
  substitutionChanges?: ReadonlyArray<{ from: string; to: string }>;
}
