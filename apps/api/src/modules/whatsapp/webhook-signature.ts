/**
 * Verificação de assinatura do webhook de ENTRADA da AraraHQ (US-3.1 / Sato §6).
 *
 * # ⚠️ FORMATO PLACEHOLDER (mock — decisão do fundador 2026-07-30)
 * A conta AraraHQ **não foi assinada**: o formato real de assinatura/headers do webhook
 * é desconhecido. Este arquivo é o **único ponto** onde esse formato está codificado —
 * headers, ordem do preimage do HMAC e codificação da assinatura. Quando a conta existir,
 * ajuste as constantes `SIGNATURE_HEADER`/`TIMESTAMP_HEADER` e `buildPreimage()` para o
 * contrato real; o resto do módulo (controller, dedup, debounce, enqueue) não muda.
 *
 * # As três camadas de Sato §6 (todas obrigatórias)
 *  1. HMAC-SHA256 sobre o **corpo bruto** (nunca sobre o JSON re-serializado) + `timingSafeEqual`.
 *  2. Timestamp assinado dentro de janela ±5min (o timestamp entra no preimage do HMAC).
 *  3. Nonce/`messageId` de uso único (Redis `SET NX`) — feito no serviço, fora daqui.
 *
 * Nunca lançar com detalhe explorável nem revelar QUAL camada falhou ao chamador externo:
 * o serviço responde 200 e descarta. Aqui só retornamos um `reason` para o log interno.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Header (placeholder) com o HMAC-SHA256 hex do corpo. */
export const SIGNATURE_HEADER = 'x-ararahq-signature';
/** Header (placeholder) com o timestamp Unix (segundos) que entra no HMAC. */
export const TIMESTAMP_HEADER = 'x-ararahq-timestamp';
/** Janela anti-replay de timestamp (Sato §6): ±5 min. */
export const TIMESTAMP_TOLERANCE_SECONDS = 300;

export type SignatureFailure =
  'no_secret' | 'missing_headers' | 'stale_timestamp' | 'bad_signature';

export interface VerifyInput {
  readonly secret: string | undefined;
  /** Corpo BRUTO exatamente como recebido (Buffer) — re-serializar quebra o HMAC. */
  readonly rawBody: Buffer | undefined;
  readonly signature: string | undefined;
  readonly timestamp: string | undefined;
  /** Epoch em ms (injetável para teste determinístico). */
  readonly nowMs?: number;
  readonly toleranceSeconds?: number;
}

export type VerifyResult = { ok: true } | { ok: false; reason: SignatureFailure };

/** Preimage do HMAC (placeholder): `${timestamp}.${rawBody}` — timestamp assinado junto. */
function buildPreimage(timestamp: string, rawBody: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), rawBody]);
}

/**
 * Verifica assinatura + janela de timestamp. Fail-closed: sem segredo, sem headers ou
 * sem corpo bruto → falha. Comparação em tempo constante após checar tamanho igual.
 */
export function verifyWebhookSignature(input: VerifyInput): VerifyResult {
  const { secret, rawBody, signature, timestamp } = input;
  if (!secret) return { ok: false, reason: 'no_secret' };
  if (!rawBody || rawBody.length === 0 || !signature || !timestamp) {
    return { ok: false, reason: 'missing_headers' };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'missing_headers' };
  const nowSec = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const tolerance = input.toleranceSeconds ?? TIMESTAMP_TOLERANCE_SECONDS;
  if (Math.abs(nowSec - ts) > tolerance) return { ok: false, reason: 'stale_timestamp' };

  const expected = createHmac('sha256', secret).update(buildPreimage(timestamp, rawBody)).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, 'hex');
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
  // timingSafeEqual exige tamanho igual; tamanho distinto já é assinatura inválida.
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }
  return { ok: true };
}

/** Helper de teste/dev: assina um corpo bruto no mesmo formato placeholder. */
export function signWebhookBody(secret: string, timestamp: string, rawBody: Buffer): string {
  return createHmac('sha256', secret).update(buildPreimage(timestamp, rawBody)).digest('hex');
}
