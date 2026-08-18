/**
 * Contrato `WhatsappTransport` — abstração compartilhada entre os transportes reais de
 * WhatsApp deste módulo (o do BSP oficial e o da conexão via QR Code). Vive num arquivo
 * à parte, e não dentro do transporte do BSP oficial, por dois motivos: (1) não é uma
 * peculiaridade de um provedor específico, é o contrato que QUALQUER transporte
 * implementa; (2) o outro transporte também precisa importar isso, e os testes
 * estruturais de confinamento de cada provedor reprovam qualquer arquivo que fale HTTP
 * com aquele provedor fora do transporte dedicado — importar tipos de dentro do
 * arquivo de um provedor faria o outro transporte "mencionar" esse provedor e cair
 * nesse marcador à toa, mesmo sem trocar uma requisição sequer com ele.
 */

/** Botão de resposta rápida (quick reply) — ex.: feedback 👍/👎 (US-3.6). */
export interface QuickReplyButton {
  id: string;
  title: string;
}

export interface OutboundMessage {
  /** Telefone E.164 do destinatário. */
  to: string;
  text: string;
  /** Quick-reply buttons anexados à mensagem (opcional). No fake/dev é só metadado. */
  buttons?: readonly QuickReplyButton[];
}

export interface WhatsappTransport {
  send(message: OutboundMessage): Promise<void>;
  /**
   * Envia um Template pré-aprovado (fora da janela de 24h — ver nota de topo do
   * transporte do BSP oficial). `variables` preenche {{1}}, {{2}}... na ordem.
   */
  sendTemplate(to: string, templateName: string, variables?: readonly string[]): Promise<void>;
  /** Indicador "digitando…" (US-3.5, mascara latência). Opcional: fakes/legados sem ele. */
  sendTyping?(to: string): Promise<void>;
  hasCredentials(): boolean;
}

export const WHATSAPP_TRANSPORT = Symbol('MOVIVO_WHATSAPP_TRANSPORT');
