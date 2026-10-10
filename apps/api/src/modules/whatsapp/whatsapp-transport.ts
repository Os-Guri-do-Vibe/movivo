/**
 * Contrato entre o worker de envio e o transporte da EvolutionAPI.
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
   * Renderiza uma mensagem parametrizada. `variables` preenche os campos na ordem.
   */
  sendTemplate(to: string, templateName: string, variables?: readonly string[]): Promise<void>;
  /**
   * Envia um documento (PDF do protocolo, US-2.6-PDF) por URL, com legenda opcional.
   * A implementação entrega o arquivo pela EvolutionAPI.
   *
   * `fileName` (achado 2026-08-25) é o nome do anexo como o titular VÊ no WhatsApp — não
   * tem relação com `documentUrl`, que continua sendo o endpoint público anônimo
   * (IDOR-safe, sem PII na URL nem no `Content-Disposition` dela — ver `protocol.controller.ts`).
   * Quem chama já resolveu o telefone sob RLS, então pode montar um nome personalizado sem
   * expor titular nenhum na URL em si.
   */
  sendDocument?(to: string, documentUrl: string, caption: string, fileName?: string): Promise<void>;
  /** Indicador "digitando…" (US-3.5, mascara latência). Opcional: fakes/legados sem ele. */
  sendTyping?(to: string): Promise<void>;
  hasCredentials(): boolean;
}

export const WHATSAPP_TRANSPORT = Symbol('MOVIVO_WHATSAPP_TRANSPORT');
