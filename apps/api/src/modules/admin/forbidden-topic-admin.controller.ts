import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ControlCenterCapability as Capability } from '@movivo/shared';

import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { ForbiddenTopicAdminService } from './forbidden-topic-admin.service';

@Controller('control-center/ai/forbidden-topics')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class ForbiddenTopicAdminController {
  constructor(private readonly topics: ForbiddenTopicAdminService) {}

  @Get()
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  list() {
    return this.topics.list();
  }

  @Post()
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  propose(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.topics.propose(actor, body);
  }

  @Post('submit')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  submit(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.topics.submit(actor, body);
  }

  @Post('approve')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_GUARDRAIL_APPROVE)
  approve(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.topics.approve(actor, body);
  }

  @Post('retire')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_GUARDRAIL_APPROVE)
  retire(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.topics.retire(actor, body);
  }
}
