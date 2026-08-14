import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ControlCenterCapability as Capability } from '@movivo/shared';

import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { AuditQueryService } from './audit-query.service';

@Controller('control-center/audit')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class AuditQueryController {
  constructor(private readonly auditQuery: AuditQueryService) {}

  @Get()
  @RequireCapabilities(Capability.AUDIT_READ)
  search(@CurrentUser() actor: AuthenticatedUser, @Query() query: Record<string, string>) {
    return this.auditQuery.search(actor, query);
  }
}
