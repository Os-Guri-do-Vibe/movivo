/**
 * Transporte outbound da AraraHQ (WhatsApp Business API) — US-2.5 / TASK-2.5.1.
 *
 * **Único arquivo do backend que fala HTTP com a AraraHQ** (um teste estrutural garante).
 * `fetch` nativo, sem SDK — mesmo padrão confinado do `llm/providers.ts`. Sem webhook de
 * ENTRADA nesta sprint (Sprint 3).
 *
 * Credencial **opcional no boot**: sem `ARARAHQ_API_KEY` o envio real vira **no-op logado**
 * (dev/CI sobem sem conta AraraHQ). Os testes injetam um fake que implementa `WhatsappTransport`.
 *
 * # Contrato confirmado 2026-08-16 (conta AraraHQ criada)
 * Confirmado contra `@ararahq/sdk@1.8.1` (tipos reais do pacote, não a doc prosa):
 * `POST /v1/messages` com `{ receiver: "whatsapp:+55...", body }` — não `{ to, text: { body } }`
 * como o placeholder anterior assumia. **`buttons` não existe no contrato real** — a API não
 * aceita quick-reply em mensagem de sessão avulsa, só via botão de Template aprovado (Meta).
 * O parâmetro `buttons` continua na interface (US-3.6 o popula) mas **não é mais enviado no
 * corpo** — ver nota em `send()`. Redesenhar US-3.6 (feedback 👍/👎) fica pendente de decisão
 * de produto: confirmar com a AraraHQ se há outro mecanismo, ou migrar para Template com
 * `TemplateButton` (QUICK_REPLY).
 *
 * # `send()` só funciona DENTRO da janela de 24h — descoberto em produção 2026-08-16
 * A AraraHQ rejeita com 422 `CONVERSATION_WINDOW_CLOSED` texto livre (`body`) pra quem nunca
 * mandou mensagem pro número da MOVIVO (sem janela de sessão aberta) — é regra da própria
 * Meta, não bug da AraraHQ. `PHONE_VERIFICATION` (US-6.5) é o caso clássico: é a PRIMEIRA
 * mensagem que o número recebe. Por isso usa `sendTemplate()`, não `send()` — precisa de um
 * Template pré-aprovado pela Meta. Qualquer outro fluxo que possa mandar a primeira mensagem
 * pra um número (reengajamento após período de silêncio, por ex.) tem o mesmo problema.
 */
import { PinoLogger } from 'nestjs-pino';

import type { OutboundMessage, WhatsappTransport } from './whatsapp-transport';

/** `SendMessageRequest.receiver` exige o prefixo `whatsapp:` (contrato real, US-2.5). */
function toReceiver(to: string): string {
  return to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
}

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
      this.logger.info('envio de WhatsApp simulado (sem credencial AraraHQ)');
      return;
    }
    // `buttons` (US-3.6) não é enviado: o contrato real de `POST /v1/messages` não tem esse
    // campo — ver nota de topo do arquivo. Só funciona dentro da janela de 24h (idem).
    await this.postMessage({
      receiver: toReceiver(message.to),
      type: 'text',
      body: message.text,
    });
  }

  async sendTemplate(
    to: string,
    templateName: string,
    variables?: readonly string[],
  ): Promise<void> {
    if (!this.apiKey) {
      this.logger.info('envio de WhatsApp simulado (sem credencial AraraHQ)');
      return;
    }
    await this.postMessage({
      receiver: toReceiver(to),
      templateName,
      ...(variables?.length ? { variables: [...variables] } : {}),
    });
  }

  private async postMessage(body: Record<string, unknown>): Promise<void> {
    // Um 4xx/5xx lança e o BullMQ retenta.
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Corpo do erro da AraraHQ ({ error: { code, message } }) ajuda a diagnosticar 4xx
      // (ex.: fora da janela de 24h, template obrigatório) — nunca ficou só no status antes.
      const detail = await res.text().catch(() => '');
      throw new Error(
        `AraraHQ respondeu ${res.status} ao enviar mensagem${detail ? `: ${detail.slice(0, 500)}` : ''}`,
      );
    }
  }

  async sendTyping(to: string): Promise<void> {
    if (!this.apiKey) return; // no-op sem credencial (dev/CI)
    // ponytail: `/v1/presence` NÃO está no contrato confirmado do SDK oficial (só users,
    // messages, templates, organizations, apiKeys) — pode não existir. Best-effort: nunca
    // deixa a resposta falhar por causa dele, então um 404 aqui é inofensivo (silencioso).
    try {
      await fetch(`${this.baseUrl}/v1/presence`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ to, presence: 'typing' }),
      });
    } catch {
      to = '[redacted]';
      this.logger.info({ to }, 'indicador de digitação falhou (ignorado)');
    }
  }
}
