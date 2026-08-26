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
 *
 * # Documento (`sendDocument`, US-2.6-PDF) — mesmo contrato confirmado do SDK
 * `SendMessageRequest` tem `media_url` no MESMO objeto de `body`/`templateName` — não é
 * endpoint separado (`dist/index.d.ts` do pacote publicado): `{ receiver, templateName?,
 * templateVariables?, variables?, body?, media_url?, scheduled_at? }`. Documento funciona
 * como mensagem de sessão comum (dentro da janela de 24h, igual `send()`) OU combinado com
 * `templateName` (fora da janela — exige Template aprovado pela Meta com
 * `headerType: 'document'`), mesmo `POST /v1/messages`.
 * **Não confirmado em produção**: se `media_url` sozinho (sem `templateName`) é aceito fora
 * da janela — a suposição aqui é que segue a mesma regra de `send()` (texto), por isso o
 * fallback pra Template quando `CONVERSATION_WINDOW_CLOSED`.
 */
import { PinoLogger } from 'nestjs-pino';

import type { OutboundMessage, WhatsappTransport } from './whatsapp-transport';

/** `SendMessageRequest.receiver` exige o prefixo `whatsapp:` (contrato real, US-2.5). */
function toReceiver(to: string): string {
  return to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
}

/** Extrai `error.code` do corpo `{ error: { code, message } }` — `undefined` se não parsear. */
function parseAraraErrorCode(rawBody: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      const errorField = (parsed as { error?: unknown }).error;
      if (errorField && typeof errorField === 'object' && 'code' in errorField) {
        const code = (errorField as { code?: unknown }).code;
        if (typeof code === 'string') return code;
      }
    }
  } catch {
    // corpo não é JSON — sem code pra extrair.
  }
  return undefined;
}

/** Erro tipado da AraraHQ com o `code` da resposta (`{ error: { code, message } }`). */
class AraraApiError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AraraApiError';
  }
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

  // `fileName` (WhatsappTransport) não entra na assinatura: `SendMessageRequest` não tem
  // esse campo no contrato confirmado do SDK (ver nota de topo do arquivo) — a AraraHQ
  // decide o nome do anexo sozinha a partir de `media_url`. TS aceita a implementação com
  // menos parâmetros que a interface (parâmetro extra e opcional do lado do chamador).
  async sendDocument(
    to: string,
    documentUrl: string,
    caption: string,
    fallbackTemplateName?: string,
  ): Promise<void> {
    if (!this.apiKey) {
      this.logger.info('envio de WhatsApp simulado (sem credencial AraraHQ)');
      return;
    }
    try {
      await this.postMessage({ receiver: toReceiver(to), media_url: documentUrl, body: caption });
    } catch (error) {
      const windowClosed = error instanceof AraraApiError && error.code === 'CONVERSATION_WINDOW_CLOSED';
      if (!windowClosed || !fallbackTemplateName) throw error;
      this.logger.info(
        { fallbackTemplateName },
        'janela de 24h fechada — reenviando documento via Template aprovado',
      );
      await this.postMessage({
        receiver: toReceiver(to),
        templateName: fallbackTemplateName,
        media_url: documentUrl,
      });
    }
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
      const code = parseAraraErrorCode(detail);
      throw new AraraApiError(
        `AraraHQ respondeu ${res.status} ao enviar mensagem${detail ? `: ${detail.slice(0, 500)}` : ''}`,
        code,
        res.status,
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
