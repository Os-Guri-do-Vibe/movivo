import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ControlCenterCapability as Capability,
  controlCenterScriptRunResponseSchema,
  controlCenterScriptsResponseSchema,
} from '@movivo/shared';

import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { CurrentUser } from '../auth/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { SystemScriptsService } from './system-scripts.service';

const SCRIPT_ID = /^[a-z0-9-]{1,80}$/;

@ApiTags('Admin · Sistema · Scripts')
@ApiBearerAuth('access-token')
@Controller('control-center/scripts')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class SystemScriptsController {
  constructor(private readonly scripts: SystemScriptsService) {}

  @Get()
  @RequireCapabilities(Capability.SYSTEM_OPERATE)
  @ApiOperation({
    summary: 'Painel "Sistema → Scripts"',
    description:
      'Catálogo de crons, rotinas e scripts de terminal, com o estado da última execução manual dos crons.',
  })
  @ApiResponse({
    status: 200,
    description: 'Catálogo de scripts.',
    schema: zodSchemaToOpenApi(controlCenterScriptsResponseSchema),
  })
  @ApiResponse({ status: 403, description: 'Ator sem a capability SYSTEM_OPERATE.' })
  list(@CurrentUser() actor: AuthenticatedUser) {
    return this.scripts.list(actor);
  }

  @Post(':id/run')
  @HttpCode(200)
  @RequireCapabilities(Capability.SYSTEM_OPERATE)
  @ApiOperation({
    summary: 'Executa à força um cron ou rotina',
    description:
      'Crons: enfileira um job extra com `force: true`, sem alterar o agendamento padrão. Rotinas: executa na hora. Registra a ação na trilha de auditoria.',
  })
  @ApiParam({ name: 'id', description: 'Identificador do script no catálogo.' })
  @ApiResponse({
    status: 200,
    description: 'Execução enfileirada ou concluída.',
    schema: zodSchemaToOpenApi(controlCenterScriptRunResponseSchema),
  })
  @ApiResponse({ status: 400, description: 'Script só executável no terminal.' })
  @ApiResponse({ status: 403, description: 'Ator sem permissão para este script.' })
  @ApiResponse({ status: 404, description: 'Script inexistente.' })
  @ApiResponse({ status: 409, description: 'Já existe uma execução manual em andamento.' })
  run(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.scripts.run(actor, SCRIPT_ID.test(id) ? id : '');
  }
}
