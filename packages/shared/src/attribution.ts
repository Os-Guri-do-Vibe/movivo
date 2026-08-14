/**
 * Atribuição de primeiro toque (Sprint 8, US-8.2).
 *
 * Duas regras que valem para os dois apps:
 *  - **Grava-se o bruto, normaliza-se na leitura.** As colunas guardam o que veio na
 *    query string (já saneado); o mapa canônico só é aplicado na agregação/exibição.
 *    Assim um erro de marcação de campanha continua visível em vez de virar "outros".
 *  - **Query string é entrada não confiável** (Sato): allowlist de charset, limite de
 *    comprimento por campo e `referrer` reduzido ao host — a URL completa carrega termo
 *    de busca e identificador de terceiro, ou seja, PII que ninguém pediu para guardar.
 */
import { z } from 'zod';

/** Origem ausente é gravada explicitamente. `null` silencioso não é resposta. */
export const UNKNOWN_SOURCE = 'desconhecida';

/** Rótulo de valor recebido mas fora do mapa canônico — nunca some num balde "outros". */
export const UNMAPPED_CHANNEL = 'nao_mapeado';

/** Cadastro anterior à migration da US-8.2: não há origem, e inferir seria mentir. */
export const NOT_CAPTURED_LABEL = 'origem não capturada (cadastro anterior à Sprint 8)';

/** Teto por campo. Igual ao `length` das colunas — truncar aqui evita erro de driver. */
export const ATTRIBUTION_MAX_LENGTH = 120;

/** Teto do host (limite de um FQDN). */
export const REFERRER_HOST_MAX_LENGTH = 253;

/**
 * Allowlist de charset: letras, dígitos e os separadores que aparecem em UTM real.
 * Tudo fora disso derruba o valor inteiro (descarte silencioso — o cadastro nunca
 * pode quebrar por causa de um parâmetro de marketing malformado).
 */
const ALLOWED = /^[a-z0-9._+-]+$/;

/**
 * Sanea um valor de query string. Retorna `null` quando não sobra nada publicável.
 * Trunca ANTES de validar: um payload de 5.000 caracteres vira 120 e segue o jogo.
 */
export function sanitizeAttributionValue(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase().slice(0, ATTRIBUTION_MAX_LENGTH);
  return value.length > 0 && ALLOWED.test(value) ? value : null;
}

/** Reduz um referrer ao host. Qualquer coisa que não seja URL absoluta vira `null`. */
export function toReferrerHost(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let host: string;
  try {
    host = new URL(raw.slice(0, 2048)).hostname.toLowerCase();
  } catch {
    return null;
  }
  return host.length > 0 && host.length <= REFERRER_HOST_MAX_LENGTH && ALLOWED.test(host)
    ? host
    : null;
}

/**
 * Payload de primeiro toque enviado pelo cliente no `POST /anamnesis/start`.
 * `.catch({})` é deliberado: atribuição jamais invalida a criação da sessão.
 */
export const attributionInputSchema = z
  .object({
    utmSource: z.unknown().optional(),
    utmMedium: z.unknown().optional(),
    utmCampaign: z.unknown().optional(),
    utmContent: z.unknown().optional(),
    /** URL completa; o servidor guarda **apenas o host**. */
    referrer: z.unknown().optional(),
  })
  .catch({});
export type AttributionInput = z.infer<typeof attributionInputSchema>;

/** O que efetivamente vai para as colunas. `utmSource` nunca é nulo. */
export interface AttributionRecord {
  utmSource: string;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  referrerHost: string | null;
}

export function normalizeAttribution(input: AttributionInput | undefined): AttributionRecord {
  return {
    utmSource: sanitizeAttributionValue(input?.utmSource) ?? UNKNOWN_SOURCE,
    utmMedium: sanitizeAttributionValue(input?.utmMedium),
    utmCampaign: sanitizeAttributionValue(input?.utmCampaign),
    utmContent: sanitizeAttributionValue(input?.utmContent),
    referrerHost: toReferrerHost(input?.referrer),
  };
}

/** Mediums que caracterizam mídia paga — separam `instagram` de `meta_ads`. */
const PAID_MEDIUMS = new Set(['cpc', 'ppc', 'paid', 'paid_social', 'ads', 'paidsocial']);

/**
 * Mapa canônico de canal (taxonomia de Helena). Ponto único do código.
 * A chave `<source>:paid` tem precedência quando o medium é de mídia paga.
 */
const CHANNEL_MAP: Record<string, string> = {
  'instagram:paid': 'meta_ads',
  'facebook:paid': 'meta_ads',
  'meta:paid': 'meta_ads',
  'ig:paid': 'meta_ads',
  'fb:paid': 'meta_ads',
  meta_ads: 'meta_ads',
  instagram: 'instagram',
  ig: 'instagram',
  'instagram.com': 'instagram',
  facebook: 'instagram',
  fb: 'instagram',
  tiktok: 'tiktok',
  'tiktok.com': 'tiktok',
  youtube: 'youtube',
  'youtube.com': 'youtube',
  whatsapp: 'whatsapp',
  google: 'organico',
  'google.com': 'organico',
  organico: 'organico',
  organic: 'organico',
  indicacao: 'indicacao',
  referral: 'indicacao',
  [UNKNOWN_SOURCE]: UNKNOWN_SOURCE,
};

/**
 * Valores canônicos possíveis, derivados do próprio `CHANNEL_MAP` — ponto único.
 * É a lista que o lançamento de `ad_spend` aceita (US-8.6): quem lança escolhe da
 * taxonomia, então em `ad_spend` não existe "bruto não mapeado" a preservar.
 */
export const CANONICAL_CHANNELS = [...new Set(Object.values(CHANNEL_MAP))] as [string, ...string[]];

export interface CanonicalChannel {
  /** Valor canônico, `desconhecida`, ou `nao_mapeado`. */
  channel: string;
  /** `false` quando o valor bruto não está no mapa — erro de marcação, não "outros". */
  mapped: boolean;
  /** `source / medium` como veio do link. Sempre exibido junto quando `mapped` é falso. */
  raw: string;
}

/** Normalização de canal na LEITURA (nunca na gravação). */
export function canonicalChannel(
  source: string | null | undefined,
  medium: string | null | undefined,
): CanonicalChannel {
  const raw = [source, medium].filter(Boolean).join(' / ') || UNKNOWN_SOURCE;
  if (!source) return { channel: UNKNOWN_SOURCE, mapped: true, raw };

  const paidKey = medium && PAID_MEDIUMS.has(medium) ? `${source}:paid` : null;
  const channel = (paidKey ? CHANNEL_MAP[paidKey] : undefined) ?? CHANNEL_MAP[source];
  return channel
    ? { channel, mapped: true, raw }
    : { channel: UNMAPPED_CHANNEL, mapped: false, raw };
}

/** Rótulo pronto para a ficha do aluno e para a timeline. */
export function attributionLabel(channel: CanonicalChannel | null): string {
  if (!channel) return NOT_CAPTURED_LABEL;
  return channel.mapped ? channel.channel : `${UNMAPPED_CHANNEL} (${channel.raw})`;
}
