/**
 * Transporte outbound da AraraHQ (WhatsApp Business API) — US-2.5 / TASK-2.5.1.
 *
 * **Único arquivo do backend que fala HTTP com a AraraHQ** (um teste estrutural garante).
 * `fetch` nativo, sem SDK — mesmo padrão confinado do `llm/providers.ts`. Sem webhook de
 * ENTRADA nesta sprint (Sprint 3).
 *
 * Credencial **opcional no boot**: sem `ARARAHQ_API_KEY` o envio real vira **no-op logado**
 * (dev/CI sobem sem conta AraraHQ). Os testes injetam um fake que implementa `WhatsappTransport`.
 */
import { PinoLogger } from 'nestjs-pino';

export interface OutboundMessage {
  /** Telefone E.164 do destinatário. */
  to: string;
  text: string;
}

export interface WhatsappTransport {
  send(message: OutboundMessage): Promise<void>;
  hasCredentials(): boolean;
}

export const WHATSAPP_TRANSPORT = Symbol('MOVIVO_WHATSAPP_TRANSPORT');

export class AraraHttpTransport implements WhatsappTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('AraraHttpTransport');
    if (!this.apiKey) {
      this.logger.warn('ARARAHQ_API_KEY ausente — envios do WhatsApp serão no-op logado (dev/CI)');
    }
  }

  hasCredentials(): boolean {
    return Boolean(this.apiKey);
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!this.apiKey) {
      // Sem credencial: no-op logado (nunca lança) — o job completa em dev/CI. NÃO loga
      // o texto (contém dado de saúde derivado); só o destino redigido pelo LoggerModule.
      this.logger.info({ to: message.to }, 'envio de WhatsApp simulado (sem credencial AraraHQ)');
      return;
    }
    // ponytail: shape mínimo do endpoint AraraHQ — confirmar contra a doc quando a conta
    // existir (bloqueador de lançamento, não de dev). Um 4xx/5xx lança e o BullMQ retenta.
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ to: message.to, type: 'text', text: { body: message.text } }),
    });
    if (!res.ok) {
      throw new Error(`AraraHQ respondeu ${res.status} ao enviar mensagem`);
    }
  }
}
