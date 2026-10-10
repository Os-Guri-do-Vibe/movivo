/** Portal e checkout validam credenciais opacas revogáveis no banco, nunca IDs de titulares. */
import {
  Body,
  Controller,
  ConflictException,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  accessLinkRequestSchema,
  createCheckoutSchema,
  checkoutLinkResultSchema,
  checkoutPaymentResultSchema,
  checkoutSummarySchema,
  refundResultSchema,
  subscriptionViewSchema,
  type CheckoutLinkResult,
  type CheckoutPaymentResult,
  type CheckoutSummary,
  type RefundResult,
  type SubscriptionView,
} from '@movivo/shared';
import type { Request } from 'express';
import { z } from 'zod';

import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { parseBody } from '../../core/validation/strict-input';
import { AccessLinkService } from '../../core/database/access-link.service';
import { CheckoutTokenService } from './checkout-token.service';
import { InvalidTransitionError } from './subscription-model';
import { SubscriptionAccessService } from './subscription-access.service';
import { SubscriptionService } from './subscription.service';

const cancelSchema = z.strictObject({ reason: z.string().trim().max(500).optional() });

const TOKEN_PARAM = {
  name: 'token',
  description: 'Credencial opaca, expirável e revogável do portal de assinatura.',
} as const;

@ApiTags('Assinatura')
@Controller('subscription')
@UseGuards(ThrottlerGuard)
export class SubscriptionController {
  constructor(
    private readonly subs: SubscriptionService,
    private readonly access: SubscriptionAccessService,
    private readonly checkoutTokens: CheckoutTokenService,
    private readonly accessLinks: AccessLinkService,
  ) {}

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
  @ApiResponse({
    status: 404,
    description: 'Token inválido, expirado, revogado ou titular sem assinatura.',
  })
  async view(@Param('token') token: string): Promise<SubscriptionView> {
    const view = await this.subs.getView(await this.userId(token));
    if (!view) throw new NotFoundException();
    return view;
  }

  /** Resumo autoritativo: o token resolve o titular e o plano; a URL não leva preço editável. */
  @Get('checkout/:token')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Obtém o checkout individual',
    description: 'Valida o token opaco e devolve apenas o snapshot comercial do contrato.',
  })
  @ApiParam({ name: 'token', description: 'Token opaco, autenticado e expirável do checkout.' })
  @ApiResponse({ status: 200, schema: zodSchemaToOpenApi(checkoutSummarySchema) })
  @ApiResponse({ status: 404, description: 'Token inválido, adulterado ou expirado.' })
  async checkoutSummary(@Param('token') token: string): Promise<CheckoutSummary> {
    const verified = await this.checkoutToken(token);
    const summary = await this.subs.getCheckoutSummary(verified.userId, verified.expiresAt);
    if (!summary) throw new NotFoundException();
    return summary;
  }

  /** Inicia a operação no Asaas; preço vem do contrato, não do body. */
  @Post('checkout/:token/payment')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Inicia pagamento no Asaas',
    description:
      'Pix à vista (QR Code na própria página) e cartão no Checkout hospedado pelo Asaas, que nunca expõe o cartão à MOVIVO. Pix Automático indisponível.',
  })
  @ApiParam({ name: 'token', description: 'Token opaco, autenticado e expirável do checkout.' })
  @ApiBody({ schema: zodSchemaToOpenApi(createCheckoutSchema) })
  @ApiResponse({ status: 200, schema: zodSchemaToOpenApi(checkoutPaymentResultSchema) })
  @ApiResponse({ status: 400, description: 'Dados ou parcelamento inválidos.' })
  @ApiResponse({ status: 404, description: 'Token inválido, adulterado ou expirado.' })
  async checkoutPayment(
    @Param('token') token: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<CheckoutPaymentResult> {
    const { userId } = await this.checkoutToken(token);
    const input = parseBody(createCheckoutSchema, body);
    return this.subs.startCheckoutPayment(userId, input, req.ip || '127.0.0.1');
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
  @ApiResponse({
    status: 404,
    description: 'Token inválido, expirado, revogado ou titular sem assinatura.',
  })
  async cancel(@Param('token') token: string, @Body() body: unknown): Promise<{ status: string }> {
    const userId = await this.userId(token);
    const { reason } = parseBody(cancelSchema, body ?? {});
    return this.ensureFound(this.subs.cancel(userId, reason || undefined));
  }

  @Post(':token/refund')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Arrependimento: estorno integral em até 7 dias da contratação',
    description:
      'Interrompe cobranças futuras, devolve o valor pago e encerra o acesso. Fora do prazo, 409.',
  })
  @ApiParam(TOKEN_PARAM)
  @ApiResponse({ status: 200, schema: zodSchemaToOpenApi(refundResultSchema) })
  @ApiResponse({ status: 409, description: 'Prazo encerrado ou sem pagamento a estornar.' })
  async refund(@Param('token') token: string): Promise<RefundResult> {
    const result = await this.subs.requestRefund(await this.userId(token));
    if (!result) throw new NotFoundException();
    return result;
  }

  @Post(':token/checkout-link')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({ summary: 'Novo link de checkout a partir do portal do titular' })
  @ApiParam(TOKEN_PARAM)
  @ApiResponse({ status: 200, schema: zodSchemaToOpenApi(checkoutLinkResultSchema) })
  async checkoutLink(@Param('token') token: string): Promise<CheckoutLinkResult> {
    const url = await this.subs.issueCheckoutLink(await this.userId(token));
    if (!url) throw new NotFoundException();
    return { url };
  }

  @Post(':token/pause')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({ summary: 'Pausa a assinatura' })
  @ApiParam(TOKEN_PARAM)
  @ApiResponse({ status: 200, description: 'Assinatura pausada — retorna o novo status.' })
  @ApiResponse({
    status: 404,
    description: 'Token inválido, expirado, revogado ou titular sem assinatura.',
  })
  async pause(@Param('token') token: string): Promise<{ status: string }> {
    return this.ensureFound(this.subs.pause(await this.userId(token)));
  }

  @Post(':token/resume')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({ summary: 'Retoma a assinatura pausada' })
  @ApiParam(TOKEN_PARAM)
  @ApiResponse({ status: 200, description: 'Assinatura retomada — retorna o novo status.' })
  @ApiResponse({
    status: 404,
    description: 'Token inválido, expirado, revogado ou titular sem assinatura.',
  })
  async resume(@Param('token') token: string): Promise<{ status: string }> {
    return this.ensureFound(this.subs.resume(await this.userId(token)));
  }

  /** Página pública `/conta`: pede o link pelo celular. Resposta idêntica exista ou não cliente. */
  @Post('access-link')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Pede um novo link de gerenciamento pelo celular',
    description:
      'Sempre 202, sem revelar se o número tem assinatura. O link vai só ao WhatsApp cadastrado.',
  })
  async accessLink(@Body() body: unknown): Promise<{ accepted: true }> {
    const { phone } = parseBody(accessLinkRequestSchema, body);
    await this.access.requestPortalLinkByPhone(phone);
    return { accepted: true };
  }

  /** Link curto vencido: o botão "receber novo link" reenvia ao dono, sem digitar nada. */
  @Post('link-renewal')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Reenvia um link vencido ao WhatsApp do próprio titular' })
  async renewLink(@Body() body: unknown): Promise<{ accepted: true }> {
    const { code } = parseBody(
      z.strictObject({ code: z.string().regex(/^[A-Za-z0-9]{24}$/) }),
      body,
    );
    await this.access.renewFromShortCode(code);
    return { accepted: true };
  }

  private async userId(token: string): Promise<string> {
    const verified = await this.accessLinks.verify(token, 'SUBSCRIPTION_PORTAL');
    if (!verified) throw new NotFoundException();
    return verified.userId;
  }

  private async checkoutToken(token: string): Promise<{ userId: string; expiresAt: number }> {
    const verified = await this.checkoutTokens.verify(token);
    if (!verified) throw new NotFoundException();
    return verified;
  }

  private async ensureFound(operation: Promise<{ status: string }>): Promise<{ status: string }> {
    let result: { status: string };
    try {
      result = await operation;
    } catch (error) {
      if (error instanceof InvalidTransitionError) {
        throw new ConflictException('Transição de assinatura não permitida.');
      }
      throw error;
    }
    if (result.status === 'NO_SUBSCRIPTION') throw new NotFoundException();
    return result;
  }
}
