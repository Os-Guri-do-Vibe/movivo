/**
 * `WebhookController` de pagamento (US-4.2.2) — `POST /api/v1/webhook/payment`.
 *
 * Responde **sempre 200** (não vaza QUAL verificação falhou — Sato T-15) e **rápido**: delega ao
 * `PaymentWebhookService`, que verifica assinatura sobre o `req.rawBody` (habilitado por
 * `rawBody: true` no bootstrap, como o webhook AraraHQ), deduplica e aplica a transição.
 *
 * ponytail: headers genéricos `x-payment-*` no dev/mock; o adaptador Stripe real lê
 * `stripe-signature` (ts+sig no mesmo header) — seam de lançamento no `real-gateways.ts`.
 */
import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { type RawBodyRequest } from '@nestjs/common';
import { type Request } from 'express';

import { PaymentWebhookService } from './payment-webhook.service';

export const PAYMENT_SIGNATURE_HEADER = 'x-payment-signature';
export const PAYMENT_TIMESTAMP_HEADER = 'x-payment-timestamp';

@Controller('webhook')
export class PaymentWebhookController {
  constructor(private readonly webhook: PaymentWebhookService) {}

  @Post('payment')
  @HttpCode(HttpStatus.OK)
  async payment(
    @Req() req: RawBodyRequest<Request>,
    @Body() _body: unknown,
  ): Promise<{ ok: true }> {
    const correlationId = String(
      req.headers['x-correlation-id'] ?? req.headers['x-request-id'] ?? '',
    );
    await this.webhook.ingest({
      rawBody: req.rawBody,
      signature: header(req, PAYMENT_SIGNATURE_HEADER),
      timestamp: header(req, PAYMENT_TIMESTAMP_HEADER),
      correlationId,
    });
    // Sempre 200: forjado/replay/desconhecido são descartados dentro do serviço.
    return { ok: true };
  }
}

function header(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
