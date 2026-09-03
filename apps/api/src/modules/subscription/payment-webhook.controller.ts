/**
 * `WebhookController` de pagamento (US-4.2.2 / US-8.5) — `POST /api/v1/webhook/payment`.
 *
 * É a **superfície externa de escrita mais sensível do produto**: o único endpoint público
 * onde um sistema de fora grava fato financeiro. As três defesas, nesta ordem:
 *
 *  1. **Rate limit** (`ThrottlerGuard`, 30/min por IP) — antes de qualquer trabalho. Um
 *     endpoint público que verifica HMAC em todo request é um amplificador de CPU sem isto.
 *  2. **Limite de corpo** — hoje o `DEFAULT_JSON_BODY_LIMIT` (2mb) do `main.ts`, compartilhado
 *     com toda a API desde que o teto anterior (100kb, só desta rota) virou default global por
 *     engano e passou a rejeitar POST legítimo de outras rotas (achado 2026-09-02, ex.:
 *     metodologia CREF sem teto de caracteres). `PAYMENT_WEBHOOK_BODY_LIMIT` abaixo documenta
 *     o tamanho REAL esperado do payload de gateway (poucos KB) — não é mais o valor imposto
 *     nesta rota especificamente. HMAC em 2mb ainda é CPU trivial (milissegundos), e o rate
 *     limit acima já limita volume — o risco de amplificação que motivou o teto original
 *     continua coberto pelas outras duas camadas.
 *  3. **Assinatura verificada antes de processar** — dentro do `PaymentWebhookService`,
 *     sobre o `req.rawBody` (habilitado por `rawBody: true` no bootstrap, como o webhook
 *     AraraHQ). Nada é persistido nem enfileirado antes dela passar.
 *
 * Status: **401** quando a assinatura não foi provada (uniforme para todo motivo de
 * rejeição — não vaza QUAL verificação falhou, Sato T-15), **200** no resto. Responder 200 a
 * evento não autenticado faria o gateway legítimo parar de reentregar um evento corrompido.
 *
 * O 200 é rápido por construção: o controller valida e enfileira; a conciliação roda no
 * `PaymentReconciliationWorker`. Webhook que faz trabalho pesado inline vira timeout, que
 * vira reenvio, que viraria duplicata se a idempotência não estivesse no banco — e está
 * (UNIQUE `(gateway, gateway_event_id)`).
 *
 * ponytail: headers genéricos `x-payment-*` no dev/mock; o adaptador Stripe real lê
 * `stripe-signature` (ts+sig no mesmo header) — seam de lançamento no `real-gateways.ts`.
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { type RawBodyRequest } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { type Request } from 'express';

import { PaymentWebhookService } from './payment-webhook.service';

export const PAYMENT_SIGNATURE_HEADER = 'x-payment-signature';
export const PAYMENT_TIMESTAMP_HEADER = 'x-payment-timestamp';

/**
 * Documenta o tamanho REAL esperado do payload do gateway (poucos KB) — não é mais o teto
 * imposto nesta rota (achado 2026-09-02: ver rationale completo na docstring da classe e em
 * `main.ts`, `DEFAULT_JSON_BODY_LIMIT`). Se algum dia esta rota precisar de um teto próprio
 * de novo, mais apertado que o default global, aplique via `MiddlewareConsumer` escopado a
 * este controller — não voltando a emprestar este valor como default de toda a API.
 */
export const PAYMENT_WEBHOOK_BODY_LIMIT = '100kb';

@Controller('webhook')
export class PaymentWebhookController {
  constructor(private readonly webhook: PaymentWebhookService) {}

  @Post('payment')
  @HttpCode(HttpStatus.OK)
  // 30/min por IP: folgado para a reentrega legítima do gateway (que é esparsa e faz
  // backoff), apertado para quem varre a rota testando assinaturas.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseGuards(ThrottlerGuard)
  async payment(
    @Req() req: RawBodyRequest<Request>,
    @Body() _body: unknown,
  ): Promise<{ ok: true }> {
    const correlationId = String(
      req.headers['x-correlation-id'] ?? req.headers['x-request-id'] ?? '',
    );
    const verdict = await this.webhook.ingest({
      rawBody: req.rawBody,
      signature: header(req, PAYMENT_SIGNATURE_HEADER),
      timestamp: header(req, PAYMENT_TIMESTAMP_HEADER),
      correlationId,
    });
    // Mensagem genérica de propósito: o serviço já registrou o motivo real no log.
    if (verdict === 'REJECTED') throw new UnauthorizedException('assinatura inválida');
    return { ok: true };
  }
}

function header(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
