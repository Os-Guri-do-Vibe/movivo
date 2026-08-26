/**
 * `EvolutionInboundEdge` — borda de ENTRADA da EvolutionAPI (Baileys), US-3.1-EVO.
 *
 * # Autenticação: token compartilhado em header, NUNCA a `EVOLUTION_API_KEY`
 * A EvolutionAPI não assina o corpo. O que ela oferece é `POST /webhook/set/{instance}`
 * com `headers` customizados — headers que ela repete em toda entrega. Usamos isso como
 * segredo compartilhado (`x-movivo-webhook-token`, `EVOLUTION_WEBHOOK_TOKEN`, 32 bytes).
 *
 * O segredo é **novo e exclusivo desta função**, jamais a `EVOLUTION_API_KEY`, porque o
 * envelope que a EvolutionAPI entrega carrega `apikey` (a chave da instância) no CORPO de
 * toda entrega — quem já lê nosso endpoint já veria a chave da instância. Reusá-la como
 * autenticação inbound seria autenticar com um valor que o próprio payload publica
 * (achado de Sato lendo o container real `evoapicloud/evolution-api:v2.3.7`).
 *
 * Sem `EVOLUTION_WEBHOOK_TOKEN` configurado o comportamento é **fail-closed**: toda
 * entrega é descartada (mesmo espírito do `no_secret` da AraraHQ).
 *
 * # Envelope confirmado contra o container real (`dist/` lido, não a doc prosa)
 * `{ ...extra, event, instance, data, destination, date_time, sender, server_url, apikey }`.
 * Para `event: 'messages.upsert'`, `data` é
 * `{ key: { remoteJid, remoteJidAlt?, addressingMode?, fromMe, id, participant? }, pushName?,
 *    message, messageType, messageTimestamp }`.
 *
 * **`key` conferido contra entregas reais (QA, 2026-08-24):** as mensagens de aluno que esta
 * instância recebe hoje chegam quase todas em **endereçamento LID** — `remoteJid` opaco em
 * `@lid` e o telefone real em `remoteJidAlt` — e `participant` vem como string VAZIA em
 * conversa 1:1 (por isso os guards testam `.trim().length > 0`, nunca só a presença do
 * campo). A resolução do remetente vive em `resolveSenderPhone()`.
 *
 * # Isolamento entre titulares (Sato)
 *  - `instance` é comparada com a instância REGISTRADA neste processo. Uma segunda
 *    instância (outra conta de WhatsApp) apontada para o nosso endpoint não consegue
 *    injetar mensagem em nome de ninguém — mesmo que descubra o token.
 *  - `key.fromMe` descarta o eco das nossas próprias mensagens (senão a IA responde a
 *    si mesma).
 *  - `key.participant` (grupo) e qualquer JID não-individual são descartados em
 *    `resolveSenderPhone()` — mensagem de grupo é fala de TERCEIRO. O fallback para
 *    `remoteJidAlt` é restrito ao caso individual-LID justamente para não abrir essa porta.
 *  - Só texto e resposta de botão alimentam o LLM. Imagem, áudio, sticker, reaction e
 *    protocolMessage são descartados sem nunca virar prompt.
 */
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import { AppConfigService } from '../../../core/config';
import {
  MAX_INBOUND_TEXT_LENGTH,
  type NormalizedInbound,
  normalizedInboundSchema,
  type RawDelivery,
  type VerifyResult,
} from './inbound-message';
import { resolveSenderPhone } from './phone-identity';
import { constantTimeEquals } from './secret-compare';
import type { InboundProvider, WhatsappInboundEdge } from './whatsapp-inbound-edge';

/** Header customizado registrado em `POST /webhook/set/{instance}` e repetido a cada entrega. */
export const EVOLUTION_WEBHOOK_TOKEN_HEADER = 'x-movivo-webhook-token';

/** Único evento que assinamos (menor privilégio — ver `configureWebhook`). */
const SUPPORTED_EVENT = 'messages.upsert';

/**
 * Guard de BACKLOG ANTIGO — **não é controle de segurança**.
 *
 * `messageTimestamp` vem da própria origem que estamos autenticando pelo token: é
 * forjável por quem já passou da autenticação, então não protege contra nada. Existe por
 * UX e custo: depois de uma reconexão longa o Baileys reemite a fila inteira de mensagens
 * acumuladas, e sem este corte a MOVIVO responderia (com inferência de LLM paga) uma
 * avalanche de mensagens de ontem. O controle anti-replay de verdade é o nonce Redis
 * (`SET NX`) em `WhatsappInboundService`.
 */
const STALE_BACKLOG_SECONDS = 12 * 60 * 60;

const keySchema = z.object({
  remoteJid: z.string().min(1).max(200),
  /**
   * Telefone real quando o `remoteJid` vem em LID (`addressingMode: 'lid'`). Confirmado
   * contra as entregas reais desta instância — ver `resolveSenderPhone`.
   */
  remoteJidAlt: z.string().max(200).optional(),
  fromMe: z.boolean().optional(),
  id: z.string().min(1).max(200),
  participant: z.string().max(200).optional(),
});

/**
 * Só os campos de texto/botão são modelados. Tudo que não aparece aqui (imagem, áudio,
 * sticker, reaction, protocolMessage…) simplesmente não produz texto e vira descarte —
 * o allowlist é a AUSÊNCIA de campo, não uma lista negra de `messageType` (cujo
 * vocabulário completo do Baileys não está confirmado contra o container).
 */
const messageSchema = z.object({
  conversation: z.string().optional(),
  extendedTextMessage: z.object({ text: z.string().optional() }).optional(),
  buttonsResponseMessage: z
    .object({ selectedButtonId: z.string().optional(), selectedDisplayText: z.string().optional() })
    .optional(),
  templateButtonReplyMessage: z
    .object({ selectedId: z.string().optional(), selectedDisplayText: z.string().optional() })
    .optional(),
  listResponseMessage: z
    .object({
      title: z.string().optional(),
      singleSelectReply: z.object({ selectedRowId: z.string().optional() }).optional(),
    })
    .optional(),
});

const upsertDataSchema = z.object({
  key: keySchema,
  message: messageSchema.optional(),
  messageType: z.string().optional(),
  /** Segundos (Baileys). Pode chegar como string em algumas versões. */
  messageTimestamp: z.union([z.number(), z.string()]).optional(),
});

/** Envelope externo. Campos extras (`apikey`, `sender`, `server_url`…) são descartados. */
const envelopeSchema = z.object({
  event: z.string().min(1).max(100),
  instance: z.string().min(1).max(200).optional(),
  data: z.unknown(),
});

/** Caracteres de controle (menos `\t`, `\n`, `\r`) — nunca deveriam entrar num prompt. */
// eslint-disable-next-line no-control-regex -- remover caractere de controle é o objetivo
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function sanitizeText(raw: string): string {
  return raw.normalize('NFC').replace(CONTROL_CHARS, '').trim().slice(0, MAX_INBOUND_TEXT_LENGTH);
}

/** Primeiro candidato não vazio — simplifica a cadeia de fallback de texto/botão. */
function firstNonEmpty(...candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate;
  }
  return undefined;
}

/**
 * Nome da instância esperada. É uma FUNÇÃO, resolvida uma vez no boot por DI, e não um
 * `await transport.currentInstanceName()` a cada entrega: `normalize()` é síncrono de
 * propósito (é a fronteira de parsing, não deve fazer I/O), e consultar a EvolutionAPI a
 * cada mensagem recebida acrescentaria uma ida à rede — e um modo de falha — no caminho
 * quente de toda mensagem de aluno. O transporte mantém o nome em cache e é a única fonte.
 */
export type ExpectedInstanceNameProvider = () => string | null;

@Injectable()
export class EvolutionInboundEdge implements WhatsappInboundEdge {
  readonly provider: InboundProvider = 'EVOLUTION';

  constructor(
    private readonly config: AppConfigService,
    private readonly expectedInstanceName: ExpectedInstanceNameProvider,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(EvolutionInboundEdge.name);
  }

  /**
   * Compara o token do header com o segredo esperado, **antes de olhar o corpo**. Sem
   * segredo configurado, fail-closed.
   */
  verify(delivery: RawDelivery): VerifyResult {
    const expected = this.config.evolution.webhookToken;
    if (!expected) return { ok: false, reason: 'no_secret' };
    const provided = delivery.headers[EVOLUTION_WEBHOOK_TOKEN_HEADER];
    if (!constantTimeEquals(provided, expected)) return { ok: false, reason: 'bad_token' };
    return { ok: true };
  }

  normalize(body: unknown): NormalizedInbound[] | null {
    const envelope = envelopeSchema.safeParse(body);
    if (!envelope.success) return null;

    // Assinamos só MESSAGES_UPSERT; qualquer outro evento é ruído, não erro.
    if (envelope.data.event !== SUPPORTED_EVENT) return this.discard('unsupported_event');

    // Instância divergente (ou desconhecida) = origem não registrada. Fail-closed: uma
    // segunda instância apontada para este endpoint não fala em nome de ninguém.
    const expectedInstance = this.expectedInstanceName();
    if (!expectedInstance || envelope.data.instance?.trim() !== expectedInstance.trim()) {
      return this.discard('unknown_instance');
    }

    const parsed = upsertDataSchema.safeParse(envelope.data.data);
    if (!parsed.success) return null;
    const { key, message, messageTimestamp } = parsed.data;

    // Eco do que a MOVIVO acabou de mandar — responder a isso é loop infinito.
    if (key.fromMe === true) return this.discard('from_me');
    // Contexto de grupo: a fala é de um TERCEIRO, nunca do dono do `remoteJid`.
    if (typeof key.participant === 'string' && key.participant.trim().length > 0) {
      return this.discard('group_message');
    }
    if (this.isStaleBacklog(messageTimestamp)) return this.discard('stale_backlog');

    const from = resolveSenderPhone(key);
    if (!from) return this.discard('unresolvable_sender');

    const buttonId = firstNonEmpty(
      message?.buttonsResponseMessage?.selectedButtonId,
      message?.templateButtonReplyMessage?.selectedId,
      message?.listResponseMessage?.singleSelectReply?.selectedRowId,
    );
    const rawText = firstNonEmpty(
      message?.conversation,
      message?.extendedTextMessage?.text,
      // Toque em botão sem texto livre: o rótulo exibido é o texto da mensagem; sem ele,
      // o próprio id (o schema interno exige `text` não vazio).
      message?.buttonsResponseMessage?.selectedDisplayText,
      message?.templateButtonReplyMessage?.selectedDisplayText,
      message?.listResponseMessage?.title,
      buttonId,
    );
    // Imagem, áudio, sticker, reaction, protocolMessage: nenhum campo de texto → descarte.
    if (!rawText) return this.discard('unsupported_message_type');

    const text = sanitizeText(rawText);
    if (text.length === 0) return this.discard('empty_text');

    const candidate = {
      messageId: key.id,
      from,
      text,
      ...(buttonId ? { buttonId: buttonId.slice(0, 100) } : {}),
    };
    const normalized = normalizedInboundSchema.safeParse(candidate);
    // Não bateu com o próprio contrato que acabamos de montar = bug NOSSO, não descarte
    // legítimo. `null` para cair no caminho de payload inválido (que loga rejeição).
    if (!normalized.success) return null;
    return [normalized.data];
  }

  /** Descarte legítimo: `[]` + log sem PII (só a razão). */
  private discard(reason: string): NormalizedInbound[] {
    this.logger.info(
      { event: 'evolution_inbound_discarded', reason },
      'entrega da EvolutionAPI descartada sem processar',
    );
    return [];
  }

  private isStaleBacklog(messageTimestamp: number | string | undefined): boolean {
    if (messageTimestamp === undefined) return false;
    const seconds = Number(messageTimestamp);
    if (!Number.isFinite(seconds) || seconds <= 0) return false;
    return Math.floor(Date.now() / 1000) - seconds > STALE_BACKLOG_SECONDS;
  }
}
