/**
 * Rotas do cap table (US-8.7). `PARTNERS_READ`/`PARTNERS_WRITE` são exclusivas do
 * `ADMIN` — `FINANCE` recebe 403 aqui mesmo chamando o endpoint direto, sem depender
 * de a UI esconder o item do menu (regra 7 da sprint).
 */
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ControlCenterCapability as Capability } from '@movivo/shared';

import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { PartnersService } from './partners.service';

@Controller('control-center/partners')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  @Get()
  @RequireCapabilities(Capability.PARTNERS_READ)
  distribution() {
    return this.partners.distribution();
  }

  @Post()
  @RequireCapabilities(Capability.PARTNERS_READ, Capability.PARTNERS_WRITE)
  replace(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.partners.replace(actor, body);
  }
}
