/**
 * TOTP (RFC 6238 sobre HOTP, RFC 4226) — HMAC-SHA1, 6 dígitos, passo de 30 s: o perfil que
 * Google Authenticator, Microsoft Authenticator, 1Password, Authy etc. implementam.
 *
 * Implementação própria e mínima (≈60 linhas, só `node:crypto`) em vez de dependência: é uma
 * superfície pequena, com vetores oficiais da RFC no teste, e evita mais um pacote na cadeia
 * de suprimentos de um controle de autenticação.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Tolerância de relógio: aceita o passo anterior e o seguinte (±30 s). */
const TOTP_WINDOW_STEPS = 1;

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('segredo base32 inválido');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Segredo novo: 160 bits (o tamanho recomendado pela RFC 4226 para HMAC-SHA1). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** HOTP (RFC 4226 §5.3): truncamento dinâmico do HMAC-SHA1 do contador de 8 bytes. */
export function hotp(secret: Buffer, counter: number, digits: number = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(message).digest();
  const byte = (index: number) => hmac[index] ?? 0;
  const offset = byte(hmac.length - 1) & 0x0f;
  const binary =
    ((byte(offset) & 0x7f) << 24) |
    (byte(offset + 1) << 16) |
    (byte(offset + 2) << 8) |
    byte(offset + 3);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

/** Código do instante `nowMs` (usado em teste e para derivar vizinhos). */
export function totpAt(secretBase32: string, nowMs: number): string {
  return hotp(base32Decode(secretBase32), totpStep(nowMs));
}

/**
 * Confere `code` contra o passo atual ±1 e devolve o passo que bateu, ou `null`.
 *
 * `lastUsedStep` impede replay: só passos ESTRITAMENTE maiores que o último aceito valem —
 * o mesmo código (ou um espiado por cima do ombro) não autentica duas vezes. A comparação
 * é em tempo constante e percorre sempre toda a janela.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  nowMs: number,
  lastUsedStep: number | null = null,
): number | null {
  const normalized = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return null;
  const secret = base32Decode(secretBase32);
  const current = totpStep(nowMs);
  const given = Buffer.from(normalized);
  let matched: number | null = null;
  for (let delta = -TOTP_WINDOW_STEPS; delta <= TOTP_WINDOW_STEPS; delta += 1) {
    const step = current + delta;
    const expected = Buffer.from(hotp(secret, step));
    const equal = timingSafeEqual(given, expected);
    if (equal && (lastUsedStep === null || step > lastUsedStep) && matched === null) {
      matched = step;
    }
  }
  return matched;
}

/** URI `otpauth://` (Key URI Format) que os apps autenticadores leem do QR. */
export function buildOtpauthUri(issuer: string, account: string, secretBase32: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
