/**
 * Rotas do cap table (US-8.7). `PARTNERS_READ`/`PARTNERS_WRITE` são exclusivas do
 * `ADMIN` — `FINANCE` recebe 403 aqui mesmo chamando o endpoint direto, sem depender
 * de a UI esconder o item do menu (regra 7 da sprint).
 */
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ControlCenterCapability as Capability,
  partnerDistributionResponseSchema,
  replacePartnersSchema,
} from '@movivo/shared';

import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { PartnersService } from './partners.service';

@ApiTags('Admin · Parceiros')
@ApiBearerAuth('access-token')
@Controller('control-center/partners')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  @Get()
  @RequireCapabilities(Capability.PARTNERS_READ)
  @ApiOperation({
    summary: 'Distribuição de lucro do cap table (gerencial)',
    description:
      'Requer `PARTNERS_READ` (exclusiva do papel ADMIN). Cálculo aritmético simples (lucro × participação vigente) — a resposta sempre carrega as ressalvas de governança (sem vesting formalizado, sem reserva de caixa, não é pró-labore/dividendo declarado).',
  })
  @ApiResponse({
    status: 200,
    description: 'Distribuição do período corrente.',
    schema: zodSchemaToOpenApi(partnerDistributionResponseSchema),
  })
  @ApiResponse({
    status: 403,
    description: 'Ator sem a capability PARTNERS_READ (ex.: papel FINANCE).',
  })
  distribution() {
    return this.partners.distribution();
  }

  @Post()
  @RequireCapabilities(Capability.PARTNERS_READ, Capability.PARTNERS_WRITE)
  @ApiOperation({
    summary: 'Substitui a composição societária vigente',
    description:
      'A lista enviada substitui a vigente POR INTEIRO (não existe "editar um sócio isolado") e precisa somar exatamente 10.000 pontos-base (100%).',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(replacePartnersSchema) })
  @ApiResponse({ status: 200, description: 'Composição substituída.' })
  @ApiResponse({
    status: 400,
    description: 'Soma de `shareBasisPoints` diferente de 10.000, ou corpo fora do schema.',
  })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities PARTNERS_READ + PARTNERS_WRITE.',
  })
  replace(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.partners.replace(actor, body);
  }
}
