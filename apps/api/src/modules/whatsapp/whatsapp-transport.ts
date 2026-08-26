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
  /**
   * Envia um documento (PDF do protocolo, US-2.6-PDF) por URL, com legenda opcional.
   * Dentro da janela de 24h funciona como mensagem de sessão comum; se a janela estiver
   * fechada e `fallbackTemplateName` for passado, a implementação deve tentar reenviar
   * via esse Template aprovado (precisa ter `headerType: 'document'` na Meta) antes de
   * desistir. Opcional na interface: nem todo transporte (ex.: EvolutionAPI, dev-only)
   * precisa suportar — quem chama trata a ausência como "sem PDF, manda o link em texto".
   *
   * `fileName` (achado 2026-08-25) é o nome do anexo como o titular VÊ no WhatsApp — não
   * tem relação com `documentUrl`, que continua sendo o endpoint público anônimo
   * (IDOR-safe, sem PII na URL nem no `Content-Disposition` dela — ver `protocol.controller.ts`).
   * Quem chama já resolveu o telefone sob RLS, então pode montar um nome personalizado sem
   * expor titular nenhum na URL em si. Opcional: nem todo transporte tem esse campo no
   * contrato confirmado (ex.: AraraHQ — ver nota em `arara-transport.ts`).
   */
  sendDocument?(
    to: string,
    documentUrl: string,
    caption: string,
    fallbackTemplateName?: string,
    fileName?: string,
  ): Promise<void>;
  /** Indicador "digitando…" (US-3.5, mascara latência). Opcional: fakes/legados sem ele. */
  sendTyping?(to: string): Promise<void>;
  hasCredentials(): boolean;
}

export const WHATSAPP_TRANSPORT = Symbol('MOVIVO_WHATSAPP_TRANSPORT');
