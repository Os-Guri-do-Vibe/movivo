import {
  ConflictException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ControlCenterCapability as Capability } from '@movivo/shared';

import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { CurrentUser } from '../auth/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { ControlCenterService } from './control-center.service';

@Controller('control-center')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class ControlCenterController {
  constructor(private readonly controlCenter: ControlCenterService) {}

  @Get('overview')
  @RequireCapabilities(Capability.OVERVIEW_READ)
  overview() {
    return this.controlCenter.overview();
  }

  @Get('marketing')
  @RequireCapabilities(Capability.MARKETING_READ)
  marketing() {
    return this.controlCenter.marketing();
  }

  @Get('students')
  @RequireCapabilities(Capability.STUDENTS_READ)
  students(@CurrentUser() actor: AuthenticatedUser) {
    return this.controlCenter.students(actor);
  }

  @Get('students/:id')
  @RequireCapabilities(Capability.STUDENTS_READ)
  student(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.controlCenter.student(actor, id);
  }

  @Get('system')
  @RequireCapabilities(Capability.SYSTEM_READ)
  system() {
    return this.controlCenter.system();
  }

  @Get('finance')
  @RequireCapabilities(Capability.FINANCE_READ)
  finance() {
    return this.controlCenter.finance();
  }

  @Get('support')
  @RequireCapabilities(Capability.SUPPORT_READ)
  support(@CurrentUser() actor: AuthenticatedUser) {
    return this.controlCenter.support(actor);
  }

  @Get('compliance')
  @RequireCapabilities(Capability.COMPLIANCE_READ, Capability.AUDIT_READ)
  compliance() {
    return this.controlCenter.compliance();
  }

  @Post('admin/subjects/:id/anonymize')
  @RequireCapabilities(Capability.ADMIN_DESTRUCTIVE_REQUEST)
  denyUnsafeAnonymization(@Param('id', new ParseUUIDPipe({ version: '4' })) _id: string): never {
    throw new ConflictException({
      code: 'STEP_UP_REQUIRED_NOT_IMPLEMENTED',
      status: 'UNAVAILABLE',
      message:
        'A anonimização permanece bloqueada até existir step-up e workflow de retenção auditável.',
    });
  }
}
