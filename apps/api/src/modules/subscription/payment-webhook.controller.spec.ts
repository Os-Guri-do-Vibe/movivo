/**
 * TASK-8.9.1 (Sato) — as defesas do controller do webhook de liquidação.
 *
 * O `payment-webhook.service.spec.ts` já cobre o veredito (assinatura, idempotência, log
 * limpo). O que faltava era o que só existe no controller e no bootstrap: o **status** da
 * rejeição, o rate limit e o teto de corpo. São três decorações/constantes que ninguém
 * quebra de propósito — quebram-se por remoção acidental, e sem teste isso passa no CI.
 */
import { UnauthorizedException } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { describe, expect, it, vi } from 'vitest';

import {
  PAYMENT_WEBHOOK_BODY_LIMIT,
  PaymentWebhookController,
} from './payment-webhook.controller';
import type { PaymentWebhookService } from './payment-webhook.service';
import type { WebhookVerdict } from './payment-webhook.service';

function make(verdict: WebhookVerdict) {
  const ingest = vi.fn().mockResolvedValue(verdict);
  const controller = new PaymentWebhookController({ ingest } as unknown as PaymentWebhookService);
  const req = {
    rawBody: Buffer.from('{"id":"evt_1"}'),
    headers: { 'x-payment-signature': 'sig', 'x-correlation-id': 'c1' },
  } as never;
  return { controller, ingest, req };
}

describe('PaymentWebhookController (TASK-8.9.1)', () => {
  it('veredito REJECTED vira 401 — nunca 200, nunca 500', async () => {
    const { controller, req } = make('REJECTED');
    await expect(controller.payment(req, {})).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('o 401 é uniforme: a mensagem não revela QUAL verificação falhou', async () => {
    const { controller, req } = make('REJECTED');
    const error = await controller.payment(req, {}).catch((e: UnauthorizedException) => e);
    const message = JSON.stringify((error as UnauthorizedException).getResponse());
    for (const leak of ['timestamp', 'hmac', 'body', 'replay', 'expired']) {
      expect(message.toLowerCase()).not.toContain(leak);
    }
  });

  it('veredito ACCEPTED responde 200 e repassa corpo bruto, assinatura e correlation id', async () => {
    const { controller, ingest, req } = make('ACCEPTED');
    await expect(controller.payment(req, {})).resolves.toEqual({ ok: true });
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({ signature: 'sig', correlationId: 'c1' }),
    );
  });

  it('a rota é protegida por rate limit (30/min por IP) e pelo ThrottlerGuard', () => {
    const handler = PaymentWebhookController.prototype.payment;
    // `@Throttle` grava uma chave por nome de config: `THROTTLER:LIMIT` + 'default'.
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(30);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60_000);
    expect(Reflect.getMetadata('__guards__', handler)).toContain(ThrottlerGuard);
  });

  it('o teto de corpo é explícito (aplicado no main.ts), não um default implícito', () => {
    expect(PAYMENT_WEBHOOK_BODY_LIMIT).toBe('100kb');
  });
});
