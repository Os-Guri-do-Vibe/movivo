/**
 * Ações self-service de assinatura (US-4.5) — cancelar / pausar / retomar.
 *
 * Não-autenticado por token (ADR-006), mesmo padrão do `ProtocolController` (US-2.6): rota
 * pública com `ThrottlerGuard`, token no PATH, `Referrer-Policy: no-referrer` para o token não
 * vazar no `Referer`. IDOR-safe: o token É o `userId` (UUID v4 não-enumerável); o cliente
 * **nunca** manda um `user_id` arbitrário e as ações rodam sob `runAsUser(userId)` (RLS). Token
 * não-UUID ou sem assinatura → 404 uniforme. ponytail: token de portal dedicado (rotativo)
 * seria mais forte que reusar o `userId` — mesma nota da US-2.6.
 *
 * Sem fricção artificial (anti-dark-pattern, guardrail 6): as três ações são simétricas e diretas.
 */
import {
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  createCheckoutSchema,
  subscriptionViewSchema,
  uuidSchema,
  type SubscriptionView,
} from '@movivo/shared';

import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { SUBSCRIPTION_TERMS_VERSION } from './subscription-model';
import { SubscriptionService } from './subscription.service';

const TOKEN_PARAM = {
  name: 'token',
  description:
    'UUID v4 do titular (o próprio `userId`, não-enumerável) — é o token de acesso ao portal de assinatura.',
} as const;

@ApiTags('Assinatura')
@Controller('subscription')
@UseGuards(ThrottlerGuard)
export class SubscriptionController {
  constructor(private readonly subs: SubscriptionService) {}

  /** Estado do portal de gestão (US-4.6) — sem PII/dado de cartão. Sem assinatura → 404. */
  @Get(':token')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Estado do portal de assinatura',
    description: 'Plano, status do trial/cobrança e datas relevantes — nunca dado de cartão.',
  })
  @ApiParam(TOKEN_PARAM)
  @ApiResponse({
    status: 200,
    description: 'Estado da assinatura.',
    schema: zodSchemaToOpenApi(subscriptionViewSchema),
  })
  @ApiResponse({ status: 404, description: 'Token não é UUID ou titular sem assinatura.' })
  async view(@Param('token') token: string): Promise<SubscriptionView> {
    const view = await this.subs.getView(this.userId(token));
    if (!view) throw new NotFoundException();
    return view;
  }

  /**
   * Cria a sessão de checkout HOSPEDADA (US-4.2/4.6) e devolve só a `checkoutUrl` para o
   * frontend redirecionar. Nenhum dado de cartão toca o backend (PCI). Body validado por Zod.
   */
  @Post(':token/checkout')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Cria a sessão de checkout hospedada',
    description:
      'Retorna só a `checkoutUrl` (Stripe/Asaas) para redirecionamento — nenhum dado de cartão toca o backend (escopo PCI).',
  })
  @ApiParam(TOKEN_PARAM)
  @ApiBody({ schema: zodSchemaToOpenApi(createCheckoutSchema) })
  @ApiResponse({ status: 200, description: 'Sessão criada — retorna `checkoutUrl`.' })
  @ApiResponse({ status: 400, description: 'Plano ou método de pagamento inválido.' })
  @ApiResponse({ status: 404, description: 'Token não é UUID.' })
  async checkout(
    @Param('token') token: string,
    @Body() body: unknown,
  ): Promise<{ checkoutUrl: string }> {
    const userId = this.userId(token);
    const { plan, method } = createCheckoutSchema.parse(body);
    const session = await this.subs.createCheckout(
      userId,
      plan,
      method,
      SUBSCRIPTION_TERMS_VERSION,
    );
    return { checkoutUrl: session.checkoutUrl };
  }

  @Post(':token/cancel')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Cancela a assinatura',
    description:
      'Ação direta, sem fricção artificial (guardrail anti-dark-pattern). `reason` é opcional, texto livre.',
  })
  @ApiParam(TOKEN_PARAM)
  @ApiBody({
    schema: { type: 'object', properties: { reason: { type: 'string', maxLength: 500 } } },
  })
  @ApiResponse({ status: 200, description: 'Assinatura cancelada — retorna o novo status.' })
  @ApiResponse({ status: 404, description: 'Token não é UUID ou titular sem assinatura.' })
  async cancel(@Param('token') token: string, @Body() body: unknown): Promise<{ status: string }> {
    const userId = this.userId(token);
    const reason = extractReason(body);
    return this.ensureFound(await this.subs.cancel(userId, reason));
  }

  @Post(':token/pause')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({ summary: 'Pausa a assinatura' })
  @ApiParam(TOKEN_PARAM)
  @ApiResponse({ status: 200, description: 'Assinatura pausada — retorna o novo status.' })
  @ApiResponse({ status: 404, description: 'Token não é UUID ou titular sem assinatura.' })
  async pause(@Param('token') token: string): Promise<{ status: string }> {
    return this.ensureFound(await this.subs.pause(this.userId(token)));
  }

  @Post(':token/resume')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({ summary: 'Retoma a assinatura pausada' })
  @ApiParam(TOKEN_PARAM)
  @ApiResponse({ status: 200, description: 'Assinatura retomada — retorna o novo status.' })
  @ApiResponse({ status: 404, description: 'Token não é UUID ou titular sem assinatura.' })
  async resume(@Param('token') token: string): Promise<{ status: string }> {
    return this.ensureFound(await this.subs.resume(this.userId(token)));
  }

  /** O token do portal É o `userId` (UUID). Não-UUID → 404 (não vaza existência). */
  private userId(token: string): string {
    if (!uuidSchema.safeParse(token).success) throw new NotFoundException();
    return token;
  }

  private ensureFound(result: { status: string }): { status: string } {
    if (result.status === 'NO_SUBSCRIPTION') throw new NotFoundException();
    return result;
  }
}

/** Motivo do cancelamento — texto livre limitado (validação de trust boundary). */
function extractReason(body: unknown): string | undefined {
  const reason = (body as { reason?: unknown } | null)?.reason;
  return typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : undefined;
}
