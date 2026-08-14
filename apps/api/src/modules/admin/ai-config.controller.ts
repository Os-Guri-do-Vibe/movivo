/**
 * Rotas do pilar IA do Control Center (US-7.7).
 *
 * Leitura sob `AI_CONFIG_READ`; **publicar e reverter exigem `AI_CONFIG_WRITE` no
 * servidor** — quem tem só leitura recebe 403 aqui mesmo chamando o endpoint direto, sem
 * depender de a UI esconder o botão (TASK-7.7.5).
 */
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ControlCenterCapability as Capability } from '@movivo/shared';

import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { AiConfigService } from './ai-config.service';

@Controller('control-center/ai')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class AiConfigController {
  constructor(private readonly aiConfig: AiConfigService) {}

  @Get('persona')
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  persona() {
    return this.aiConfig.persona();
  }

  @Get('persona/history')
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  history() {
    return this.aiConfig.history();
  }

  @Get('inviolable-rules')
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  inviolableRules() {
    return this.aiConfig.inviolableRules();
  }

  @Post('simulate')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  simulate(@Body() body: unknown) {
    return this.aiConfig.simulate(body);
  }

  @Post('persona')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  publish(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.aiConfig.publish(actor, body);
  }

  @Post('persona/rollback')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  rollback(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.aiConfig.rollback(actor, body);
  }
}
