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

/**
 * Foto ou PDF recebido no WhatsApp, já baixado e conferido (tipo e tamanho). Quem decide o
 * destino (refeição, exame…) é o roteador de mídia; o exame segue por `MEDIA_EXAM_EVENT`.
 */
export const MEDIA_INBOUND_EVENT = 'media.inbound.received';

/** Arquivo que o roteador identificou como exame: vai para a leitura da medicina. */
export const MEDIA_EXAM_EVENT = 'media.exam.received';

export interface InboundMediaEvent {
  userId: string;
  messageKey: string;
  mediaType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';
  bytes: Buffer;
  /** Legenda que o aluno escreveu junto da foto. */
  caption?: string | null;
}
