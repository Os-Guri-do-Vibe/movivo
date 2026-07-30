/**
 * `WebhookController` — entrada da AraraHQ (US-3.1 / Sato §6).
 *
 * `POST /api/v1/webhook/whatsapp`. Responde **sempre 200** (nunca vaza QUAL verificação
 * falhou ao atacante) e **em <1s** — não processa IA na thread do webhook: delega ao
 * `WhatsappInboundService`, que valida (HMAC + anti-replay), coalesce a rajada por
 * debounce e enfileira em `ai-response`.
 *
 * O corpo BRUTO (`req.rawBody`) é usado no HMAC — assinar o JSON re-serializado quebraria
 * a verificação. Habilitado por `rawBody: true` no bootstrap (`main.ts`); só este handler
 * o consome. `ThrottlerGuard` aplica o rate limit do path (TASK-3.1.3).
 */
import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { type RawBodyRequest } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { type Request } from 'express';

import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from './webhook-signature';
import { WhatsappInboundService } from './whatsapp-inbound.service';

@Controller('webhook')
@UseGuards(ThrottlerGuard)
export class WebhookController {
  constructor(private readonly inbound: WhatsappInboundService) {}

  @Post('whatsapp')
  @HttpCode(HttpStatus.OK)
  async whatsapp(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    const correlationId = String(
      req.headers['x-correlation-id'] ?? req.headers['x-request-id'] ?? '',
    );
    await this.inbound.ingest({
      rawBody: req.rawBody,
      signature: header(req, SIGNATURE_HEADER),
      timestamp: header(req, TIMESTAMP_HEADER),
      body,
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
