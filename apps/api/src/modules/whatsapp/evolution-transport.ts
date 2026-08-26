/**
 * Transporte da EvolutionAPI — QR Code/Baileys, protocolo não-oficial do WhatsApp.
 * Serve dois papéis:
 *
 *  1. Painel admin "Sistema → Integração" (criar instância, mostrar QR code, checar
 *     status) — sempre disponível, independente do transporte ativo.
 *  2. Se `WHATSAPP_TRANSPORT_PROVIDER=EVOLUTION`, o transporte REAL do worker de
 *     outbound (`WhatsappOutboundWorker`), implementando `WhatsappTransport` (mesma
 *     interface do BSP oficial já integrado no módulo `whatsapp/`, confinado noutro
 *     arquivo). Existe só para destravar teste ponta a ponta do fluxo completo num
 *     número SEPARADO enquanto a criação de Template está bloqueada no BSP oficial
 *     (não exige Template aprovado pela Meta — Baileys manda texto livre a qualquer
 *     momento). **Nunca** é o canal de produção dos usuários finais — o transporte
 *     padrão do worker continua sendo o BSP oficial, troca é opt-in por env local.
 *
 * **Único arquivo do backend que fala HTTP com a EvolutionAPI** (mesmo padrão de
 * confinamento do BSP de produção — `evolution-confinement.spec.ts`). `fetch` nativo,
 * sem SDK.
 *
 * Contrato confirmado contra a doc oficial e o código-fonte real de
 * `EvolutionAPI/evolution-api` (mesmo rigor usado antes com `docker inspect` no
 * container):
 *  - `POST /instance/create` — header `apikey`, corpo `{ instanceName, qrcode: true,
 *    integration: 'WHATSAPP-BAILEYS' }` → `{ instance: { status }, qrcode: { base64 } }`.
 *  - `GET /instance/connectionState/{instanceName}` → `{ instance: { state } }`, com
 *    `state` em `open`/`connecting`/`close`.
 *  - `GET /instance/fetchInstances` → `[{ name, connectionStatus, ... }]` (achatado —
 *    **corrigido 2026-08-17** contra o container real rodando localmente: a doc prosa
 *    e a implementação anterior assumiam `{ instance: { instanceName } }` aninhado,
 *    igual `connectionState()`; o formato real de `fetchInstances` NÃO é esse). Usado só
 *    pra descobrir o NOME da instância existente (campo `name`) — o resto do shape
 *    (`connectionStatus`) não é confiável pro status real, que sempre vem de
 *    `connectionState()`. Sem tabela própria no nosso banco, a EvolutionAPI é a única
 *    fonte de verdade de qual instância existe.
 *  - `GET /instance/connect/{instanceName}` → `{ base64?, code?, pairingCode?, count }`
 *    (achatado, confirmado no código-fonte de `instance.controller.ts`: `connectToWhatsapp`
 *    devolve `instance.qrCode` direto, sem envelope). **Corrigido 2026-08-18**: o painel
 *    "Sistema → Integração" mostrava "Conectando…" para sempre sem QR nenhum na tela,
 *    porque o QR só vinha na resposta de `createInstance()` — qualquer refresh (inclusive
 *    o polling de 3s do próprio painel) perdia o QR pra sempre, já que o `GET` de status
 *    nunca o reincluía. `fetchQrCode()` busca o QR atual/pendente a cada poll enquanto o
 *    estado é `CONNECTING` — sem side-effect nesse estado (confirmado no controller: só
 *    reinicia a conexão quando o estado é `close`, nunca quando já é `connecting`).
 *  - `POST /message/sendText/{instance}` — corpo `{ number, text }` (`number` SEM o
 *    `+` do E.164 — a própria EvolutionAPI resolve o JID a partir do número puro).
 *  - `POST /message/sendMedia/{instance}` — corpo `{ number, mediatype: "image"|"document"|
 *    "video"|"audio", media, mimetype?, fileName?, caption?, delay? }`, `required:
 *    ["number","mediatype"]`. Confirmado lendo `dist/validate/message.schema.js`
 *    (`mediaMessageSchema`, schema JSON real de validação, não a doc prosa) do container
 *    rodando localmente — `media` aceita tanto URL quanto base64 (o controller decide via
 *    `isURL`/`isBase64`; achado 2026-08-22: para base64 com `mediatype: "document"` o
 *    `fileName` é OBRIGATÓRIO, senão a própria EvolutionAPI rejeita — por isso `sendDocument`
 *    (US-2.6-PDF) sempre manda `fileName`, mesmo usando `media` como URL.
 *  - `POST /chat/sendPresence/{instance}` — corpo `{ number, presence, delay }`.
 *    **Achado crítico** lendo `whatsapp.baileys.service.ts` do repo oficial: esse
 *    endpoint BLOQUEIA a resposta HTTP pela duração de `delay` (ms) — o servidor faz
 *    `sendPresenceUpdate('composing')` → `await delay(ms)` → `sendPresenceUpdate('paused')`
 *    antes de devolver 200 (sem chunking pra `delay ≤ 20000`, nosso caso). Ou seja: um
 *    único `await` nesse endpoint já entrega "digitando… → espera → some" pronto, sem
 *    precisar reimplementar sleep nem re-disparar presence no nosso lado.
 *
 * # Comportamento humano (anti-ban do número de teste)
 * O protocolo não-oficial (Baileys) arrisca banimento se o tráfego tiver cara de bot:
 * resposta instantânea, textos longos despejados de uma vez, sem "digitando…". Por isso
 * `send()`/`sendTemplate()` chamam `humanizeBeforeSend()` ANTES de cada envio — presence
 * "composing" com atraso aleatório de 15–20s (`HUMAN_DELAY_MIN_MS`/`_MAX_MS`). O worker
 * já quebra respostas longas em bolhas (`\n---\n`) e chama `send()` por bolha — cada
 * bolha ganha seu próprio "digitando + espera", reforçando o efeito quanto mais bolhas
 * houver. Isso é uma peculiaridade SÓ da EvolutionAPI: o BSP oficial, sob SLA de
 * resposta, não tem — nem deve ganhar — esse atraso deliberado.
 *
 * Credencial **opcional no boot**: sem `EVOLUTION_API_KEY`, tanto o painel quanto o
 * envio real viram no-op (painel mostra "não configurado"; `send()`/`sendTemplate()`
 * logam e retornam, no mesmo espírito do transporte de produção sem credencial — o
 * worker não pode travar em retry infinito enquanto ninguém escaneou o QR ainda).
 */
import { PinoLogger } from 'nestjs-pino';

import { PHONE_VERIFICATION_TEMPLATE, phoneVerificationMessage } from './message-templates';
import type { OutboundMessage, WhatsappTransport } from './whatsapp-transport';

export type EvolutionConnectionState =
  'NOT_CONFIGURED' | 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED';

export interface CreateInstanceResult {
  status: EvolutionConnectionState;
  qrCodeBase64: string | null;
}

export interface EvolutionTransport {
  hasCredentials(): boolean;
  createInstance(instanceName: string): Promise<CreateInstanceResult>;
  connectionState(instanceName: string): Promise<EvolutionConnectionState>;
  /** Nome da instância mais recente, ou `null` se nenhuma existe ainda. */
  currentInstanceName(): Promise<string | null>;
  /**
   * Último nome de instância conhecido **sem ir à rede** (cache do processo). Existe para
   * a borda de ENTRADA (`EvolutionInboundEdge`) poder validar o campo `instance` de cada
   * entrega de forma síncrona, sem uma chamada HTTP por mensagem de aluno. `null` = ainda
   * não sabemos qual instância é a nossa → a borda descarta fail-closed.
   */
  lastKnownInstanceName(): string | null;
  /**
   * Registra (de forma idempotente) o webhook de ENTRADA desta instância apontando para a
   * nossa API. Chamado na criação da instância e reafirmado quando o painel confirma
   * `CONNECTED`. No-op logado sem credencial ou sem token configurado; nunca lança.
   */
  ensureWebhookConfigured(instanceName: string): Promise<void>;
  /**
   * QR code ATUAL de uma instância que ainda não conectou (`CONNECTING`). Existe
   * porque o QR só vem no corpo de `createInstance()` — sem isso, recarregar a
   * página ou o polling perdem o QR pra sempre e o painel fica preso em
   * "Conectando…" sem nada pra escanear (bug real, encontrado 2026-08-18: o `GET`
   * de status nunca reincluía o QR depois da primeira resposta). `null` se a
   * EvolutionAPI ainda não gerou nenhum QR pra essa instância.
   */
  fetchQrCode(instanceName: string): Promise<string | null>;
}

export const EVOLUTION_TRANSPORT = Symbol('MOVIVO_EVOLUTION_TRANSPORT');

/** Erro com o status HTTP anexado — permite `createInstance()` distinguir "nome já em uso". */
class EvolutionApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Janela de atraso "humano" antes de cada envio real (anti-ban — ver nota de topo). */
const HUMAN_DELAY_MIN_MS = 15_000;
const HUMAN_DELAY_MAX_MS = 20_000;

/** Ping curto de "digitando…" (US-3.5, mascara latência de LLM) — não é o atraso anti-ban. */
const TYPING_PING_MS = 3_000;

/** Mapeia o vocabulário da EvolutionAPI (`open`/`connecting`/`close`) pro nosso enum. */
function toConnectionState(raw: string | undefined): EvolutionConnectionState {
  if (raw === 'open') return 'CONNECTED';
  if (raw === 'connecting') return 'CONNECTING';
  return 'DISCONNECTED';
}

/** `number` da EvolutionAPI é E.164 SEM o `+` (contrato confirmado no código-fonte). */
function toEvolutionNumber(to: string): string {
  return to.startsWith('+') ? to.slice(1) : to;
}

/**
 * `sendDocument` manda `media` como URL para a EvolutionAPI baixar sozinha — e a
 * EvolutionAPI roda no CONTAINER Docker (`movivo-evolution-api`), não no host. `PUBLIC_SITE_URL`
 * (achado 2026-08-25) aponta pro `apps/web` rodando no host (`http://localhost:3000`), que
 * é exatamente o endereço certo para o link de texto que vai pro navegador do titular — mas
 * dentro do container `localhost` resolve pro PRÓPRIO container, nunca pro host. A
 * EvolutionAPI então falha a validação de `media` (`"Owned media must be a url or base64"`)
 * porque a URL é, do ponto de vista dela, inalcançável. `host.docker.internal` é o hostname
 * padrão do Docker Desktop (macOS/Windows) para o container alcançar o host — funciona sem
 * mudança nenhuma no `docker-compose.yml`. Reescrita só afeta ESTE transporte dev-only
 * (EvolutionAPI nunca é o canal de produção — ver docstring do arquivo); o BSP oficial usa
 * `PUBLIC_SITE_URL` direto, sem essa reescrita, porque roda contra um domínio público real.
 *
 * **Também vale para o caminho inverso** (US-3.1-EVO): a URL do nosso webhook de ENTRADA
 * registrada via `POST /webhook/set/{instance}` é chamada de DENTRO do container, então
 * `http://localhost:3001/...` (a API rodando no host) precisa da mesma reescrita. Por isso
 * a função é exportada — é o único lugar do backend que conhece essa peculiaridade de rede.
 */
export function toContainerReachableUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      parsed.hostname = 'host.docker.internal';
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Único template do sistema hoje é `PHONE_VERIFICATION_TEMPLATE` — a EvolutionAPI não
 * tem conceito de Template aprovado pela Meta, então renderiza o texto real e manda
 * como mensagem comum. `null` = template desconhecido (nunca deveria acontecer; melhor
 * descartar com aviso do que lançar e acionar retry do BullMQ para um erro permanente).
 */
function renderTemplate(templateName: string, variables?: readonly string[]): string | null {
  if (templateName === PHONE_VERIFICATION_TEMPLATE) {
    const code = variables?.[0];
    return code ? phoneVerificationMessage(code) : null;
  }
  return null;
}

/**
 * Configuração do webhook de ENTRADA (US-3.1-EVO). Opcional no construtor: sem ela o
 * transporte segue funcionando só como outbound + painel, sem registrar webhook nenhum.
 */
export interface EvolutionInboundWebhookConfig {
  /** URL PÚBLICA da nossa rota (`.../webhook/whatsapp/evolution`), antes da reescrita. */
  readonly url: string;
  /** `EVOLUTION_WEBHOOK_TOKEN` — vai no header customizado de toda entrega. */
  readonly token: string | undefined;
}

export class EvolutionHttpTransport implements EvolutionTransport, WhatsappTransport {
  /**
   * Nome da instância aprendido nesta execução. Serve à borda de ENTRADA, que precisa
   * validar `instance` de forma síncrona (ver `lastKnownInstanceName`). Atualizado em todo
   * caminho que já descobre o nome — nenhuma ida extra à rede é criada por causa disso.
   */
  private knownInstanceName: string | null = null;

  /**
   * Instâncias cujo webhook já foi (re)afirmado neste processo. O painel faz polling a
   * cada 3s: sem esta memória, reafirmar em `CONNECTED` viraria um POST a cada 3s para
   * sempre. Só vive em memória de propósito — reiniciar a API reafirma uma vez, que é
   * justamente o que garante que o webhook volte ao ar depois de qualquer mudança de URL.
   */
  private readonly webhookConfigured = new Set<string>();

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    private readonly logger: PinoLogger,
    private readonly inboundWebhook?: EvolutionInboundWebhookConfig,
  ) {
    this.logger.setContext('EvolutionHttpTransport');
    if (!this.apiKey) {
      this.logger.warn('EVOLUTION_API_KEY ausente — painel de Integração ficará "não configurado"');
    }
    // Achado de QA 2026-08-25: sem isto, o app sobe normal, o painel mostra "conectado"
    // e o inbound morre em silêncio — foi exatamente assim que passou despercebido até
    // alguém tentar mandar mensagem de verdade. `ensureWebhookConfigured()` já vira no-op
    // sem token, mas nada avisava o operador ANTES disso acontecer.
    if (this.apiKey && !this.inboundWebhook?.token) {
      this.logger.warn(
        'EVOLUTION_WEBHOOK_TOKEN ausente — o agente não vai responder no WhatsApp: nenhum webhook de entrada será registrado nas instâncias EvolutionAPI.',
      );
    }
  }

  hasCredentials(): boolean {
    return Boolean(this.apiKey);
  }

  lastKnownInstanceName(): string | null {
    return this.knownInstanceName;
  }

  /**
   * Aquece o cache do nome da instância e reafirma o webhook no boot.
   *
   * Sem isto haveria uma janela real de silêncio: a EvolutionAPI persiste o webhook no
   * banco DELA, então depois de um restart da API ela continua entregando — mas o nosso
   * processo ainda não sabe qual é a instância registrada e a borda de entrada descartaria
   * tudo como `unknown_instance` até alguém abrir o painel. Também é o momento em que uma
   * mudança de `API_PUBLIC_URL` chega até a instância. Best-effort: qualquer falha é
   * engolida (a EvolutionAPI é ferramenta de teste local, nunca pode travar o boot).
   */
  async onModuleInit(): Promise<void> {
    if (!this.apiKey || this.knownInstanceName) return;
    const name = await this.currentInstanceName().catch(() => null);
    if (name) await this.ensureWebhookConfigured(name);
  }

  async createInstance(instanceName: string): Promise<CreateInstanceResult> {
    try {
      const res = await this.request('/instance/create', {
        method: 'POST',
        body: JSON.stringify({
          instanceName,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
        }),
      });
      const body = (await res.json()) as { qrcode?: { base64?: string } };
      this.knownInstanceName = instanceName;
      // Registra o webhook de ENTRADA já na criação: sem isso a instância nasce muda
      // (o fluxo aluno → IA nunca começa) e ninguém percebe até testar no celular.
      await this.ensureWebhookConfigured(instanceName);
      // Criação bem-sucedida com QR code emitido = está aguardando o scan. O campo
      // `instance.status` do endpoint de create tem vocabulário não confirmado contra
      // uma doc completa; `connectionState()` (vocabulário confirmado: open/connecting/
      // close) é quem deve ser consultado depois, via polling, pro estado real.
      return {
        status: 'CONNECTING',
        qrCodeBase64: body.qrcode?.base64 ?? null,
      };
    } catch (error) {
      // `POST /instance/create` só devolve 403 por um motivo: o nome já está em uso
      // (confirmado batendo no container real — corpo `{"message":["This name ... is
      // already in use."]}`). Do ponto de vista de quem clica "Criar Instância" de novo
      // com o mesmo nome (ex.: depois de um QR expirado ou de uma tentativa que falhou),
      // isso não é um erro real — é pedir pra reconectar. Em vez de propagar um 500 pro
      // painel, cai pro mesmo caminho de `fetchQrCode()` usado pelo polling.
      if (error instanceof EvolutionApiError && error.status === 403) {
        // Nome já em uso = a instância é nossa, só não foi criada agora. Vale como
        // descoberta do nome e como gatilho de reasserção do webhook.
        this.knownInstanceName = instanceName;
        await this.ensureWebhookConfigured(instanceName);
        return { status: 'CONNECTING', qrCodeBase64: await this.fetchQrCode(instanceName) };
      }
      throw error;
    }
  }

  async connectionState(instanceName: string): Promise<EvolutionConnectionState> {
    const res = await this.request(
      `/instance/connectionState/${encodeURIComponent(instanceName)}`,
      {
        method: 'GET',
      },
    );
    const body = (await res.json()) as { instance?: { state?: string } };
    return toConnectionState(body.instance?.state);
  }

  async currentInstanceName(): Promise<string | null> {
    const res = await this.request('/instance/fetchInstances', { method: 'GET' });
    const body = (await res.json()) as Array<{ name?: string }>;
    const name = body[0]?.name ?? null;
    // Todo caminho que já descobre o nome alimenta o cache lido pela borda de ENTRADA.
    if (name) this.knownInstanceName = name;
    return name;
  }

  /**
   * `POST /webhook/set/{instance}` — contrato confirmado no container real
   * (`evoapicloud/evolution-api:v2.3.7`): `{ webhook: { enabled, url, headers?, byEvents?,
   * base64?, events? } }`. **Headers customizados só existem nesta rota** — não há como
   * pedi-los em `/instance/create`.
   *
   * Menor privilégio, os dois obrigatórios:
   *  - `events: ['MESSAGES_UPSERT']` — sem isso a instância despeja presença, chats,
   *    contatos e estado de conexão no nosso endpoint, tudo dado que não pedimos.
   *  - `base64: false` — mídia embutida em base64 no corpo do webhook seria dado de
   *    titular trafegando e (pior) parando em log de erro.
   *
   * `byEvents: false` mantém a URL única (o `true` cria uma sub-rota por evento).
   */
  async configureWebhook(instanceName: string, webhookUrl: string, token: string): Promise<void> {
    if (!this.apiKey) {
      this.logger.info('webhook da EvolutionAPI não registrado (sem credencial)');
      return;
    }
    const url = toContainerReachableUrl(webhookUrl);
    await this.request(`/webhook/set/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url,
          headers: { 'x-movivo-webhook-token': token, 'content-type': 'application/json' },
          byEvents: false,
          base64: false,
          events: ['MESSAGES_UPSERT'],
        },
      }),
    });
    // A URL não é segredo; o token nunca é logado.
    this.logger.info({ instanceName, url }, 'webhook de entrada da EvolutionAPI registrado');
  }

  /**
   * Reasserção idempotente: uma vez por instância por processo. Nunca lança — um webhook
   * que falhou ao registrar não pode derrubar o painel nem a criação da instância; o
   * próximo boot (ou o próximo `createInstance`) tenta de novo.
   */
  async ensureWebhookConfigured(instanceName: string): Promise<void> {
    if (!this.inboundWebhook?.token) {
      // Fail-closed do outro lado: sem token, a borda de entrada descartaria tudo mesmo.
      // Registrar o webhook aqui só encheria o log de entregas rejeitadas.
      return;
    }
    if (this.webhookConfigured.has(instanceName)) return;
    try {
      await this.configureWebhook(instanceName, this.inboundWebhook.url, this.inboundWebhook.token);
      this.webhookConfigured.add(instanceName);
    } catch (error) {
      this.logger.warn(
        { instanceName, err: error instanceof Error ? error.message : 'erro desconhecido' },
        'falha ao registrar o webhook de entrada da EvolutionAPI (será tentado de novo)',
      );
    }
  }

  async fetchQrCode(instanceName: string): Promise<string | null> {
    // `GET /instance/connect/{name}` é seguro de chamar repetidamente ENQUANTO o
    // estado já é `connecting`: o controller real (`instance.controller.ts`) só
    // devolve o QR pendente sem reiniciar nada. Só dispara um novo `connectToWhatsapp`
    // quando o estado é `close` — por isso este método só é chamado pelo painel
    // quando `connectionState()` já confirmou `CONNECTING`, nunca em `DISCONNECTED`
    // (evita brigar com a própria reconexão automática da EvolutionAPI a cada poll).
    const res = await this.request(`/instance/connect/${encodeURIComponent(instanceName)}`, {
      method: 'GET',
    });
    const body = (await res.json()) as { base64?: string };
    return body.base64 ?? null;
  }

  /**
   * Envio real (`WhatsappTransport`, só ativo com `WHATSAPP_TRANSPORT_PROVIDER=EVOLUTION`).
   * Sem credencial ou sem instância conectada: no-op logado — nunca lança, pro worker não
   * ficar em retry infinito enquanto ninguém escaneou o QR ainda.
   */
  async send(message: OutboundMessage): Promise<void> {
    if (!this.apiKey) {
      this.logger.info('envio de WhatsApp simulado (sem credencial EvolutionAPI)');
      return;
    }
    const instanceName = await this.currentInstanceName();
    if (!instanceName) {
      this.logger.info('envio de WhatsApp simulado (nenhuma instância EvolutionAPI conectada)');
      return;
    }
    await this.humanizeBeforeSend(message.to, instanceName);
    await this.sendText(instanceName, message.to, message.text);
  }

  async sendTemplate(
    to: string,
    templateName: string,
    variables?: readonly string[],
  ): Promise<void> {
    const text = renderTemplate(templateName, variables);
    if (text === null) {
      this.logger.warn({ templateName }, 'template sem equivalente na EvolutionAPI — descartado');
      return;
    }
    await this.send({ to, text });
  }

  /**
   * Documento (PDF do protocolo, US-2.6-PDF). A EvolutionAPI não tem conceito de janela de
   * 24h/Template aprovado pela Meta (Baileys manda qualquer coisa a qualquer momento) —
   * `fallbackTemplateName` (só relevante pro BSP oficial) é ignorado aqui de propósito.
   */
  async sendDocument(
    to: string,
    documentUrl: string,
    caption: string,
    _fallbackTemplateName?: string,
    fileName?: string,
  ): Promise<void> {
    if (!this.apiKey) {
      this.logger.info('envio de WhatsApp simulado (sem credencial EvolutionAPI)');
      return;
    }
    const instanceName = await this.currentInstanceName();
    if (!instanceName) {
      this.logger.info('envio de WhatsApp simulado (nenhuma instância EvolutionAPI conectada)');
      return;
    }
    await this.humanizeBeforeSend(to, instanceName);
    await this.request(`/message/sendMedia/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      body: JSON.stringify({
        number: toEvolutionNumber(to),
        mediatype: 'document',
        mimetype: 'application/pdf',
        media: toContainerReachableUrl(documentUrl),
        fileName: fileName ?? 'protocolo-movivo.pdf',
        caption,
      }),
    });
  }

  /** Indicador "digitando…" imediato (US-3.5) — best-effort, nunca lança. */
  async sendTyping(to: string): Promise<void> {
    if (!this.apiKey) return;
    const instanceName = await this.currentInstanceName().catch(() => null);
    if (!instanceName) return;
    try {
      await this.sendPresence(instanceName, to, 'composing', TYPING_PING_MS);
    } catch {
      this.logger.info('indicador de digitação falhou (ignorado)');
    }
  }

  /** Atraso anti-ban de 15–20s com "digitando…" — ver nota de topo do arquivo. */
  private async humanizeBeforeSend(to: string, instanceName: string): Promise<void> {
    const delayMs =
      HUMAN_DELAY_MIN_MS +
      Math.floor(Math.random() * (HUMAN_DELAY_MAX_MS - HUMAN_DELAY_MIN_MS + 1));
    await this.sendPresence(instanceName, to, 'composing', delayMs);
  }

  private async sendPresence(
    instanceName: string,
    to: string,
    presence: 'composing',
    delayMs: number,
  ): Promise<void> {
    await this.request(`/chat/sendPresence/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      body: JSON.stringify({ number: toEvolutionNumber(to), presence, delay: delayMs }),
    });
  }

  private async sendText(instanceName: string, to: string, text: string): Promise<void> {
    await this.request(`/message/sendText/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      body: JSON.stringify({ number: toEvolutionNumber(to), text }),
    });
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    if (!this.apiKey) {
      throw new Error(
        'EVOLUTION_API_KEY ausente — configure o secret antes de usar o painel de Integração.',
      );
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', apikey: this.apiKey },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new EvolutionApiError(
        res.status,
        `EvolutionAPI respondeu ${res.status} em ${path}${detail ? `: ${detail.slice(0, 500)}` : ''}`,
      );
    }
    return res;
  }
}
