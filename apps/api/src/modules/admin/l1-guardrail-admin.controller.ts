import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ControlCenterCapability as Capability } from '@movivo/shared';

import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { L1GuardrailAdminService } from './l1-guardrail-admin.service';

@Controller('control-center/ai/guardrails')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class L1GuardrailAdminController {
  constructor(private readonly guardrails: L1GuardrailAdminService) {}

  @Get()
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  list() {
    return this.guardrails.list();
  }

  @Post()
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  publish(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.guardrails.publish(actor, body);
  }

  @Post('rollback')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  rollback(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.guardrails.rollback(actor, body);
  }

  @Post('retire')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  retire(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.guardrails.retire(actor, body);
  }
}
