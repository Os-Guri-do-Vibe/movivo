import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ControlCenterCapability as Capability } from '@movivo/shared';

import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { StudentEvolutionService } from './student-evolution.service';

@ApiTags('Admin · Evolução do aluno')
@ApiBearerAuth('access-token')
@Controller('control-center/students')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class StudentEvolutionController {
  constructor(private readonly evolution: StudentEvolutionService) {}

  @Get(':id/evolution')
  @RequireCapabilities(Capability.STUDENTS_HEALTH_READ)
  @ApiOperation({
    summary: 'Evolução do aluno (carga, prontidão, medidas, força, dor e memória)',
    description: 'Dado de saúde: exige STUDENTS_HEALTH_READ e cada abertura é auditada.',
  })
  read(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query('weeks', new ParseIntPipe({ optional: true })) weeks?: number,
  ) {
    const count = weeks && weeks > 0 ? Math.min(weeks, 26) : 12;
    return this.evolution.read(actor, id, count);
  }
}
