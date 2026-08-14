import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ControlCenterCapability as Capability } from '@movivo/shared';

import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { KnowledgeAdminService } from './knowledge-admin.service';

@Controller('control-center/ai/knowledge')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class KnowledgeAdminController {
  constructor(private readonly knowledge: KnowledgeAdminService) {}

  @Get()
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  list(@CurrentUser() actor: AuthenticatedUser) {
    return this.knowledge.list(actor);
  }

  @Post('upload')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_KNOWLEDGE_WRITE)
  upload(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.knowledge.upload(actor, body);
  }

  @Post('review')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_KNOWLEDGE_APPROVE)
  review(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.knowledge.review(actor, body);
  }

  @Get(':id/content')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_KNOWLEDGE_APPROVE)
  content(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.knowledge.content(actor, id);
  }
}
