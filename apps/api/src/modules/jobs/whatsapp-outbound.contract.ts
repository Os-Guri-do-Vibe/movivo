/**
 * Separador de balões: um texto com `\n---\n` vira UMA mensagem do WhatsApp por trecho
 * (`WhatsappOutboundWorker.sendBubbles`). Vive no contrato porque quem produz o texto
 * (treino, conversa) não importa o domínio WhatsApp; a definição é compartilhada com o painel.
 */
export { WHATSAPP_BUBBLE_SEPARATOR } from '@movivo/shared';
import type { PlanDocumentKind } from './plan-document.registry';

export interface WhatsappQuickReplyButton {
  id: string;
  title: string;
}

export type WhatsappJobType =
  | 'CONFIRMATION'
  | 'CONFIRMATION_CARE'
  | 'CONVERSATION_MESSAGE'
  | 'CHECKIN_MESSAGE'
  | 'TRAINING_LINK'
  | 'CONSENT_STATUS'
  // Texto escrito à mão pelo profissional na aba "Conversas" (atendimento automático pausado).
  | 'MANUAL_MESSAGE'
  | 'PHONE_VERIFICATION'
  // Alerta ao profissional (número configurado, não o do aluno) de caso urgente na fila.
  | 'STAFF_QUEUE_ALERT'
  | 'TYPING';

export type WhatsappDocument = {
  caption: string;
} & (
  | { plan: PlanDocumentKind; fileName?: never; url?: never }
  | { url: string; fileName: string; plan?: never }
);

/** Contrato de fila compartilhado: produtores não importam o domínio WhatsApp. */
export interface WhatsappOutboundJob {
  /**
   * Ausente APENAS em `PHONE_VERIFICATION` e `STAFF_QUEUE_ALERT`: o código é enviado na Etapa 1
   * do onboarding, quando ainda não existe `users`, e o alerta vai a um número da equipe.
   */
  userId: string | null;
  type: WhatsappJobType;
  /** Texto já pronto (pode ter `\n---\n` para bolhas). */
  text?: string;
  /** Chave de idempotência única por mensagem (evita colidir no marcador de envio). */
  dedupeId?: string;
  /** Anexar botões de feedback 👍/👎 à última bolha. */
  feedback?: boolean;
  buttons?: readonly WhatsappQuickReplyButton[];
  /** `PHONE_VERIFICATION`: destino e código. Só neste tipo o telefone viaja no payload. */
  phoneNumber?: string;
  code?: string;
  /**
   * PDFs enviados depois do texto, na ordem. `plan`: o protocolo vigente do aluno, gerado na hora
   * do envio e mandado como arquivo (sem link). `url`: legado, a EvolutionAPI baixa pela URL.
   */
  documents?: readonly WhatsappDocument[];
}
