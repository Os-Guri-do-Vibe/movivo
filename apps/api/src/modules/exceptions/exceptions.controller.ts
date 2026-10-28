import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import {
  approveExceptionRequestSchema,
  closeExceptionRequestSchema,
  ControlCenterCapability as Capability,
  exceptionStatusSchema,
} from '@movivo/shared';

import { parseBody } from '../../core/validation/strict-input';
import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { ExceptionsService } from './exceptions.service';

const listQuerySchema = z.object({ status: exceptionStatusSchema.optional() });

@ApiTags('Admin · Fila de exceções')
@ApiBearerAuth('access-token')
@Controller('control-center/exceptions')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class ExceptionsController {
  constructor(private readonly exceptions: ExceptionsService) {}

  @Get()
  @RequireCapabilities(Capability.EXCEPTIONS_READ)
  @ApiOperation({ summary: 'Casos da fila, só do domínio do conselho do profissional' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    return this.exceptions.list(user, parseBody(listQuerySchema, query));
  }

  @Get('summary')
  @RequireCapabilities(Capability.EXCEPTIONS_READ)
  @ApiOperation({ summary: 'Quantos casos abertos (e urgentes) há para o profissional' })
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.exceptions.summary(user);
  }

  @Get(':id')
  @RequireCapabilities(Capability.EXCEPTIONS_READ, Capability.STUDENTS_READ)
  @ApiOperation({ summary: 'Caso com a proposta, a decisão e o Estado do Aluno' })
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.exceptions.detail(user, id);
  }

  @Get(':id/decisions')
  @RequireCapabilities(Capability.EXCEPTIONS_READ, Capability.STUDENTS_READ)
  @ApiOperation({ summary: 'Trilha de decisões do aluno do caso' })
  async decisions(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    const detail = await this.exceptions.detail(user, id);
    return this.exceptions.decisionsOf(detail.case.userId);
  }

  @Post(':id/claim')
  @RequireCapabilities(Capability.EXCEPTIONS_RESOLVE)
  @ApiOperation({ summary: 'Assume o caso' })
  claim(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.exceptions.claim(user, id);
  }

  @Post(':id/approve')
  @RequireCapabilities(Capability.EXCEPTIONS_RESOLVE)
  @ApiOperation({ summary: 'Aprova a proposta pendente e executa a mudança' })
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() raw: unknown,
  ) {
    return this.exceptions.approve(user, id, parseBody(approveExceptionRequestSchema, raw).note);
  }

  @Post(':id/reject')
  @RequireCapabilities(Capability.EXCEPTIONS_RESOLVE)
  @ApiOperation({ summary: 'Recusa a proposta pendente (nada muda no plano)' })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() raw: unknown,
  ) {
    return this.exceptions.reject(user, id, parseBody(closeExceptionRequestSchema, raw).note);
  }

  @Post(':id/resolve')
  @RequireCapabilities(Capability.EXCEPTIONS_RESOLVE)
  @ApiOperation({ summary: 'Encerra o caso (e o sinal de segurança, se o conselho puder)' })
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() raw: unknown,
  ) {
    return this.exceptions.resolve(user, id, parseBody(closeExceptionRequestSchema, raw).note);
  }
}
