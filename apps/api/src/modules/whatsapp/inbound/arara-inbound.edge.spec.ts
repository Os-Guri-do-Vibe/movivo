/**
 * Unit — `AraraInboundEdge` (US-3.1). Não é comportamento novo: é a mesma verificação de
 * `webhook-signature.spec.ts` e o mesmo parse que vivia dentro do serviço, agora
 * exercitados pela borda. Qualquer falha aqui é regressão do inbound de produção.
 */
import { describe, expect, it } from 'vitest';

import type { AppConfigService } from '../../../core/config';
import { SIGNATURE_HEADER, signWebhookBody, TIMESTAMP_HEADER } from '../webhook-signature';
import { AraraInboundEdge } from './arara-inbound.edge';
import type { RawDelivery } from './inbound-message';

const SECRET = 'unit-webhook-secret';

/** `{}` = segredo padrão; `{ secret: undefined }` = sem segredo (fail-closed). */
function makeEdge(opts: { secret?: string } = {}) {
  const config = {
    get whatsapp() {
      return { webhookSecret: 'secret' in opts ? opts.secret : SECRET };
    },
  } as unknown as AppConfigService;
  return new AraraInboundEdge(config);
}

function delivery(payload: object, over: Partial<RawDelivery> = {}, secret = SECRET): RawDelivery {
  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    rawBody,
    body: payload,
    correlationId: 'c1',
    headers: {
      [SIGNATURE_HEADER]: signWebhookBody(secret, timestamp, rawBody),
      [TIMESTAMP_HEADER]: timestamp,
    },
    ...over,
  };
}

const payload = { messageId: 'msg-1', from: '+5541999998888', text: 'oi movi' };

describe('AraraInboundEdge.verify', () => {
  it('assinatura válida → ok', () => {
    expect(makeEdge().verify(delivery(payload))).toEqual({ ok: true });
  });

  it('assinatura forjada → bad_signature', () => {
    const bad = delivery(payload, {
      headers: { [SIGNATURE_HEADER]: 'deadbeef', [TIMESTAMP_HEADER]: '1760000000' },
    });
    expect(makeEdge().verify(bad)).toEqual({ ok: false, reason: expect.any(String) });
    expect(makeEdge().verify(bad).ok).toBe(false);
  });

  it('fail-closed: sem segredo configurado → no_secret', () => {
    expect(makeEdge({ secret: undefined }).verify(delivery(payload))).toEqual({
      ok: false,
      reason: 'no_secret',
    });
  });

  it('sem headers de assinatura → rejeita', () => {
    expect(makeEdge().verify(delivery(payload, { headers: {} })).ok).toBe(false);
  });
});

describe('AraraInboundEdge.normalize', () => {
  it('payload no contrato → uma mensagem normalizada', () => {
    expect(makeEdge().normalize(payload)).toEqual([payload]);
  });

  it('preserva o buttonId do quick-reply', () => {
    const withButton = { ...payload, buttonId: 'fb_up' };
    expect(makeEdge().normalize(withButton)).toEqual([withButton]);
  });

  it('payload fora do contrato → null (rejeição, não descarte)', () => {
    expect(makeEdge().normalize({ messageId: 'm', from: '+55' })).toBeNull();
    expect(makeEdge().normalize(undefined)).toBeNull();
  });

  it('campo extra agora rejeita (schema .strict()) em vez de passar adiante', () => {
    expect(makeEdge().normalize({ ...payload, injetado: 'x' })).toBeNull();
  });
});
