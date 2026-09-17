/**
 * Rotas de escrita de investimento em mídia do Control Center (US-8.6).
 *
 * Ler o extrato exige `MARKETING_READ`; **lançar e estornar exigem `MARKETING_WRITE` no
 * servidor** — quem tem só leitura recebe 403 aqui mesmo chamando o endpoint direto, sem
 * depender de a UI esconder o botão.
 *
 * Não existe `PATCH`/`PUT` de lançamento. Correção é `POST .../reverse` + novo `POST`.
 */
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ControlCenterCapability as Capability,
  createAdSpendSchema,
  reverseAdSpendSchema,
} from '@movivo/shared';

import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { MarketingService } from './marketing.service';

@ApiTags('Admin · Marketing')
@ApiBearerAuth('access-token')
@Controller('control-center/marketing')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class MarketingController {
  constructor(private readonly marketing: MarketingService) {}

  @Get('ad-spend')
  @RequireCapabilities(Capability.MARKETING_READ)
  @ApiOperation({
    summary: 'Extrato de investimento em mídia paga',
    description:
      'Requer `MARKETING_READ`. Numerador do CAC — usado nos dashboards de growth/financeiro.',
  })
  @ApiResponse({ status: 200, description: 'Lançamentos de ad spend.' })
  @ApiResponse({ status: 403, description: 'Ator sem a capability MARKETING_READ.' })
  ledger() {
    return this.marketing.adSpendLedger();
  }

  @Post('ad-spend')
  @RequireCapabilities(Capability.MARKETING_READ, Capability.MARKETING_WRITE)
  @ApiOperation({
    summary: 'Lança um investimento em mídia',
    description:
      'Não existe UPDATE de valor: corrigir um lançamento é estornar (`.../reverse`) e lançar de novo — `ad_spend` é o numerador do CAC, e um valor que muda em silêncio invalida a decisão já tomada sobre o número antigo.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(createAdSpendSchema) })
  @ApiResponse({ status: 200, description: 'Lançamento criado.' })
  @ApiResponse({
    status: 400,
    description:
      'Corpo fora do schema (ex.: valor não positivo, canal fora da taxonomia canônica).',
  })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities MARKETING_READ + MARKETING_WRITE.',
  })
  create(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.marketing.createAdSpend(actor, body);
  }

  @Post('ad-spend/:id/reverse')
  @RequireCapabilities(Capability.MARKETING_READ, Capability.MARKETING_WRITE)
  @ApiOperation({
    summary: 'Estorna um lançamento de ad spend',
    description:
      'Grava uma linha de sinal contrário apontando para o lançamento original — o original nunca é editado/apagado.',
  })
  @ApiParam({ name: 'id', description: 'UUID do lançamento original.' })
  @ApiBody({ schema: zodSchemaToOpenApi(reverseAdSpendSchema) })
  @ApiResponse({ status: 200, description: 'Estorno registrado.' })
  @ApiResponse({
    status: 400,
    description: 'Lançamento já estornado ou `id` fora do formato UUID v4.',
  })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities MARKETING_READ + MARKETING_WRITE.',
  })
  reverse(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: unknown,
  ) {
    return this.marketing.reverseAdSpend(actor, id, body);
  }
}
