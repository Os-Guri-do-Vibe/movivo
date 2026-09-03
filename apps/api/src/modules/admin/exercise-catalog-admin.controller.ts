import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ControlCenterCapability as Capability } from '@movivo/shared';

import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { ExerciseCatalogAdminService } from './exercise-catalog-admin.service';

@Controller('control-center/ai/exercise-catalog')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class ExerciseCatalogAdminController {
  constructor(private readonly exerciseCatalog: ExerciseCatalogAdminService) {}

  @Get()
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  list() {
    return this.exerciseCatalog.list();
  }

  @Post()
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  publish(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.exerciseCatalog.publish(actor, body);
  }

  @Post('retire')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  retire(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.exerciseCatalog.retire(actor, body);
  }
}
