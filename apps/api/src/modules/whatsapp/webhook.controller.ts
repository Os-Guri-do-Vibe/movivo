/**
 * `WebhookController` — entradas de WhatsApp (US-3.1 / US-3.1-EVO / Sato §6).
 *
 * `POST /api/v1/webhook/whatsapp/evolution` recebe entregas da EvolutionAPI.
 *
 * Responde **sempre 200** (não vaza QUAL verificação falhou) e **em <1s** — não
 * processam IA na thread do webhook: delegam ao `WhatsappInboundService`, que autentica na
 * borda do provedor, coalesce a rajada por debounce e enfileira em `ai-response`.
 *
 * `ThrottlerGuard` aplica o rate limit do path (TASK-3.1.3).
 */
import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { type RawBodyRequest } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { type Request } from 'express';

import { WhatsappInboundService } from './whatsapp-inbound.service';

/**
 * O Baileys entrega evento por
 * evento e reemite backlog inteiro após reconexão. 300/min ainda corta um flood real, sem
 * derrubar uma sincronização legítima. O controle que protege o custo de IA não é este —
 * é o orçamento POR TITULAR dentro do serviço.
 */
const EVOLUTION_THROTTLE = { default: { limit: 300, ttl: 60_000 } };

@ApiTags('WhatsApp')
@Controller('webhook')
@UseGuards(ThrottlerGuard)
export class WebhookController {
  constructor(private readonly inbound: WhatsappInboundService) {}

  @Post('whatsapp/evolution')
  @HttpCode(HttpStatus.OK)
  @Throttle(EVOLUTION_THROTTLE)
  @ApiOperation({
    summary: 'Entrada de mensagens do WhatsApp (EvolutionAPI)',
    description:
      'Autenticado pelo token configurado na EvolutionAPI. Responde 200 sem processar IA na thread do webhook.',
  })
  @ApiResponse({
    status: 200,
    description: 'Sempre 200; entregas inválidas são descartadas.',
  })
  async whatsappEvolution(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    await this.inbound.ingest({
      provider: 'EVOLUTION',
      rawBody: req.rawBody,
      headers: flattenHeaders(req),
      body,
      correlationId: correlationId(req),
    });
    return { ok: true };
  }
}

/**
 * Headers em `Record<string, string | undefined>` (valor repetido → primeiro). O
 * controller não conhece NENHUM nome de header de provedor: quem sabe é a borda.
 */
function flattenHeaders(req: Request): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    out[name.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return out;
}

/**
 * Id de correlação da entrega. **Nunca devolve string vazia** (achado de QA 2026-08-24).
 *
 * Nenhum dos dois provedores manda header de correlação numa entrega real: no webhook da
 * EvolutionAPI nós mesmos registramos os headers, e são só `x-movivo-webhook-token` e
 * `content-type`. O `''` que sobrava daí não ficava só no log: ele viajava como
 * `AiResponseJob.correlationId` → `WhatsappOutboundJob.dedupeId` → segmento de chave
 * Redis do marker de idempotência do envio, onde `?? 'na'` não o salva (`??` só cobre
 * null/undefined, não string vazia) e o `RedisKeyBuilder` rejeita segmento vazio. Efeito
 * observado: a resposta da IA era gerada e persistida, mas o job de envio falhava em
 * todas as tentativas — o aluno nunca recebia resposta.
 *
 * O fallback é o id que o `pino-http` já gerou para esta requisição, que é o mesmo valor
 * que aparece em `req.id` nas linhas de log da requisição — então a correlação entre o
 * log de ingestão e o de envio continua real, e não sintética.
 */
function correlationId(req: Request): string {
  const value = req.headers['x-correlation-id'] ?? req.headers['x-request-id'] ?? '';
  const fromHeader = String(Array.isArray(value) ? (value[0] ?? '') : value).trim();
  if (fromHeader.length > 0) return fromHeader;
  const requestId = (req as Request & { id?: unknown }).id;
  return typeof requestId === 'string' && requestId.length > 0 ? requestId : randomUUID();
}
