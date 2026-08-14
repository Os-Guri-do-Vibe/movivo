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
import { ControlCenterCapability as Capability } from '@movivo/shared';

import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { MarketingService } from './marketing.service';

@Controller('control-center/marketing')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class MarketingController {
  constructor(private readonly marketing: MarketingService) {}

  @Get('ad-spend')
  @RequireCapabilities(Capability.MARKETING_READ)
  ledger() {
    return this.marketing.adSpendLedger();
  }

  @Post('ad-spend')
  @RequireCapabilities(Capability.MARKETING_READ, Capability.MARKETING_WRITE)
  create(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.marketing.createAdSpend(actor, body);
  }

  @Post('ad-spend/:id/reverse')
  @RequireCapabilities(Capability.MARKETING_READ, Capability.MARKETING_WRITE)
  reverse(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: unknown,
  ) {
    return this.marketing.reverseAdSpend(actor, id, body);
  }
}
