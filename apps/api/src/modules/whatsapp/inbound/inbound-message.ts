/**
 * Contrato COMUM do lado de ENTRADA do WhatsApp (US-3.1-EVO).
 *
 * Dois provedores entregam mensagem de aluno hoje — AraraHQ (BSP oficial, produção) e
 * EvolutionAPI (QR Code/Baileys, teste local). Eles diferem em TUDO na borda: formato de
 * autenticação, nomes de header, envelope, identificação do remetente. Não diferem em
 * nada depois disso: a partir de `resolveUser()` o pipeline é idêntico e não pode ser
 * duplicado (duplicar é como um provedor ganha, com o tempo, um gate de consentimento
 * mais fraco que o outro).
 *
 * Este arquivo define a fronteira entre esses dois mundos:
 *  - `RawDelivery` — a entrega crua, sem nenhum nome de header específico de provedor;
 *  - `NormalizedInbound` — a mensagem já normalizada, o ÚNICO formato que o pipeline
 *    interno consome.
 */
import { z } from 'zod';

/**
 * Entrega crua do webhook, antes de qualquer verificação. `headers` é genérico de
 * propósito: quem sabe o nome do header de assinatura é a edge do provedor, não o
 * controller nem o serviço.
 */
export interface RawDelivery {
  /** Corpo BRUTO exatamente como recebido — o HMAC da AraraHQ é sobre ele. */
  readonly rawBody: Buffer | undefined;
  /** Headers já achatados (valor repetido → primeiro), em minúsculas. */
  readonly headers: Record<string, string | undefined>;
  readonly body: unknown;
  readonly correlationId: string;
}

/**
 * Veredito de autenticação de uma entrega. `reason` é `string` (e não uma união fechada)
 * porque cada provedor tem seus próprios modos de falha (`bad_signature` do HMAC da
 * AraraHQ, `bad_token` do header compartilhado da EvolutionAPI). O `reason` NUNCA vai
 * para a resposta HTTP — só para o log interno.
 */
export type VerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * Formato interno da mensagem de entrada — o mesmo que o pipeline já consumia.
 *
 * `.strict()` (era `.passthrough()`): campo extra agora **rejeita** o payload em vez de
 * ser carregado adiante. Um payload normalizado é construído pela edge, campo a campo,
 * a partir do envelope do provedor — se sobrou campo, ou a edge tem bug ou o corpo não é
 * o que dizemos que é. Nos dois casos a resposta certa é rejeitar, não propagar dado não
 * modelado para dentro do contexto do titular.
 *
 * `text` XOR `audio`: uma mensagem de voz chega da edge SEM texto — só a referência
 * (`audio.mediaKey`) que `WhatsappInboundService` usa pra baixar e transcrever ANTES do
 * resto do pipeline rodar (nonce/orçamento/consentimento primeiro, transcrição por
 * último — ver `resolveText()`). Depois de resolvida, vira uma mensagem com `text`
 * igual a qualquer outra; nada além da borda de entrada enxerga `audio`.
 */
export const normalizedInboundSchema = z
  .object({
    messageId: z.string().min(1).max(200),
    /** Telefone E.164 do remetente — chave EXATA de `resolveUser()`. */
    from: z.string().min(8).max(20),
    text: z.string().min(1).max(4096).optional(),
    /** Toque num quick-reply (ex.: feedback 👍/👎, US-3.6). Ausente numa mensagem normal. */
    buttonId: z.string().max(100).optional(),
    /** Mensagem de voz ainda não transcrita — ver nota acima. Ausente em mensagem normal. */
    audio: z
      .object({
        /** Referência opaca, só o transporte do PRÓPRIO provedor sabe interpretar. */
        mediaKey: z.string().min(1).max(2000),
        durationSeconds: z.number().int().positive().max(3600).optional(),
      })
      .optional(),
  })
  .strict()
  .refine((value) => Boolean(value.text) || Boolean(value.audio), {
    message: 'normalizedInbound precisa de text ou audio',
  });

export type NormalizedInbound = z.infer<typeof normalizedInboundSchema>;

/** Mensagem já com `text` resolvido — texto normal, ou transcrição de um áudio. */
export type ResolvedInbound = NormalizedInbound & { text: string };

/** Limite de texto do schema acima — usado pelas edges ao truncar. */
export const MAX_INBOUND_TEXT_LENGTH = 4096;
