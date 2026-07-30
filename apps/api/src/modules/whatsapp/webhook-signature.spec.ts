/**
 * Unit — verificação de assinatura do webhook (US-3.1 / Sato §6). Prova as três garantias:
 * HMAC sobre corpo bruto, janela ±5min de timestamp e fail-closed sem segredo/headers.
 */
import { describe, expect, it } from 'vitest';

import {
  signWebhookBody,
  TIMESTAMP_TOLERANCE_SECONDS,
  verifyWebhookSignature,
} from './webhook-signature';

const SECRET = 'test-webhook-secret';
const raw = Buffer.from('{"messageId":"m1","from":"+5541999","text":"oi"}', 'utf8');

function tsNow(): string {
  return String(Math.floor(Date.now() / 1000));
}

describe('verifyWebhookSignature', () => {
  it('aceita assinatura HMAC válida dentro da janela', () => {
    const ts = tsNow();
    const sig = signWebhookBody(SECRET, ts, raw);
    expect(
      verifyWebhookSignature({ secret: SECRET, rawBody: raw, signature: sig, timestamp: ts }),
    ).toEqual({ ok: true });
  });

  it('rejeita corpo adulterado (HMAC sobre corpo bruto)', () => {
    const ts = tsNow();
    const sig = signWebhookBody(SECRET, ts, raw);
    const tampered = Buffer.from(raw.toString().replace('oi', 'hackeado'), 'utf8');
    const res = verifyWebhookSignature({
      secret: SECRET,
      rawBody: tampered,
      signature: sig,
      timestamp: ts,
    });
    expect(res).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejeita assinatura forjada', () => {
    const ts = tsNow();
    const res = verifyWebhookSignature({
      secret: SECRET,
      rawBody: raw,
      signature: 'deadbeef',
      timestamp: ts,
    });
    expect(res).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejeita assinatura de outro segredo', () => {
    const ts = tsNow();
    const sig = signWebhookBody('outro-segredo', ts, raw);
    const res = verifyWebhookSignature({
      secret: SECRET,
      rawBody: raw,
      signature: sig,
      timestamp: ts,
    });
    expect(res).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejeita timestamp fora da janela ±5min (replay antigo)', () => {
    const stale = String(Math.floor(Date.now() / 1000) - TIMESTAMP_TOLERANCE_SECONDS - 60);
    const sig = signWebhookBody(SECRET, stale, raw);
    const res = verifyWebhookSignature({
      secret: SECRET,
      rawBody: raw,
      signature: sig,
      timestamp: stale,
    });
    expect(res).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('rejeita timestamp no futuro além da janela', () => {
    const future = String(Math.floor(Date.now() / 1000) + TIMESTAMP_TOLERANCE_SECONDS + 60);
    const sig = signWebhookBody(SECRET, future, raw);
    const res = verifyWebhookSignature({
      secret: SECRET,
      rawBody: raw,
      signature: sig,
      timestamp: future,
    });
    expect(res).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('fail-closed sem segredo configurado', () => {
    const ts = tsNow();
    const sig = signWebhookBody(SECRET, ts, raw);
    expect(
      verifyWebhookSignature({ secret: undefined, rawBody: raw, signature: sig, timestamp: ts }),
    ).toEqual({
      ok: false,
      reason: 'no_secret',
    });
  });

  it('rejeita quando faltam headers ou corpo bruto', () => {
    const ts = tsNow();
    expect(
      verifyWebhookSignature({ secret: SECRET, rawBody: undefined, signature: 'x', timestamp: ts })
        .ok,
    ).toBe(false);
    expect(
      verifyWebhookSignature({ secret: SECRET, rawBody: raw, signature: undefined, timestamp: ts })
        .ok,
    ).toBe(false);
    expect(
      verifyWebhookSignature({ secret: SECRET, rawBody: raw, signature: 'x', timestamp: undefined })
        .ok,
    ).toBe(false);
    expect(
      verifyWebhookSignature({ secret: SECRET, rawBody: raw, signature: 'x', timestamp: 'nan' }).ok,
    ).toBe(false);
  });
});
