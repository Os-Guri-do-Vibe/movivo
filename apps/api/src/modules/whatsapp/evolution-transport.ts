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

export type EvolutionConnectionState = 'NOT_CONFIGURED' | 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED';

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

export class EvolutionHttpTransport implements EvolutionTransport, WhatsappTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('EvolutionHttpTransport');
    if (!this.apiKey) {
      this.logger.warn('EVOLUTION_API_KEY ausente — painel de Integração ficará "não configurado"');
    }
  }

  hasCredentials(): boolean {
    return Boolean(this.apiKey);
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
        return { status: 'CONNECTING', qrCodeBase64: await this.fetchQrCode(instanceName) };
      }
      throw error;
    }
  }

  async connectionState(instanceName: string): Promise<EvolutionConnectionState> {
    const res = await this.request(`/instance/connectionState/${encodeURIComponent(instanceName)}`, {
      method: 'GET',
    });
    const body = (await res.json()) as { instance?: { state?: string } };
    return toConnectionState(body.instance?.state);
  }

  async currentInstanceName(): Promise<string | null> {
    const res = await this.request('/instance/fetchInstances', { method: 'GET' });
    const body = (await res.json()) as Array<{ name?: string }>;
    return body[0]?.name ?? null;
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

  async sendTemplate(to: string, templateName: string, variables?: readonly string[]): Promise<void> {
    const text = renderTemplate(templateName, variables);
    if (text === null) {
      this.logger.warn({ templateName }, 'template sem equivalente na EvolutionAPI — descartado');
      return;
    }
    await this.send({ to, text });
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
      HUMAN_DELAY_MIN_MS + Math.floor(Math.random() * (HUMAN_DELAY_MAX_MS - HUMAN_DELAY_MIN_MS + 1));
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
      throw new Error('EVOLUTION_API_KEY ausente — configure o secret antes de usar o painel de Integração.');
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
