import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { methodologyNoteSchema, methodologyReviewSchema } from '@movivo/shared';
import { BadRequestException } from '@nestjs/common';
import { ControlCenterCapability as Capability } from '@movivo/shared';

import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { MethodologyAdminService } from './methodology-admin.service';

@Controller('control-center/ai/methodology')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class MethodologyAdminController {
  constructor(private readonly methodology: MethodologyAdminService) {}

  @Get()
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  list(@CurrentUser() actor: AuthenticatedUser) {
    return this.methodology.list(actor);
  }

  @Post()
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_KNOWLEDGE_WRITE)
  create(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.methodology.create(actor, body);
  }

  @Post(':id/submit')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_KNOWLEDGE_WRITE)
  submit(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    const note = methodologyNoteSchema.safeParse(body);
    if (!note.success) throw new BadRequestException({ code: 'INVALID_INPUT' });
    return this.methodology.submit(actor, { versionId: id, note: note.data.note });
  }

  @Post(':id/review')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_METHODOLOGY_APPROVE)
  review(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    const review = methodologyReviewSchema.safeParse(body);
    if (!review.success) throw new BadRequestException({ code: 'INVALID_INPUT' });
    return this.methodology.review(
      actor,
      { versionId: id, note: review.data.note },
      review.data.decision,
    );
  }

  @Post(':id/publish')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_METHODOLOGY_APPROVE)
  publish(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    const note = methodologyNoteSchema.safeParse(body);
    if (!note.success) throw new BadRequestException({ code: 'INVALID_INPUT' });
    return this.methodology.publish(actor, { versionId: id, note: note.data.note });
  }

  @Post(':id/rollback')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_KNOWLEDGE_WRITE)
  rollback(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const note = methodologyNoteSchema.safeParse(body);
    if (!note.success) throw new BadRequestException({ code: 'INVALID_INPUT' });
    return this.methodology.rollback(actor, { versionId: id, note: note.data.note });
  }
}
