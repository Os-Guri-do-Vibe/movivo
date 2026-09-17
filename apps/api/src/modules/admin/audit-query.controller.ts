import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { auditSearchResponseSchema, ControlCenterCapability as Capability } from '@movivo/shared';

import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { AuditQueryService } from './audit-query.service';

@ApiTags('Admin · Auditoria')
@ApiBearerAuth('access-token')
@Controller('control-center/audit')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class AuditQueryController {
  constructor(private readonly auditQuery: AuditQueryService) {}

  @Get()
  @RequireCapabilities(Capability.AUDIT_READ)
  @ApiOperation({
    summary: 'Busca no log de auditoria imutável',
    description:
      'Requer a capability `AUDIT_READ`. Paginado; filtros combináveis por ator, ação e intervalo de datas.',
  })
  @ApiQuery({
    name: 'actorId',
    required: false,
    description: 'UUID do ator (quem executou a ação).',
  })
  @ApiQuery({
    name: 'action',
    required: false,
    description: 'Nome da ação auditada (ex.: `faq.publish`).',
  })
  @ApiQuery({ name: 'from', required: false, description: 'Data inicial (YYYY-MM-DD), inclusive.' })
  @ApiQuery({ name: 'to', required: false, description: 'Data final (YYYY-MM-DD), inclusive.' })
  @ApiQuery({ name: 'page', required: false, description: 'Página (default 1).' })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    description: 'Itens por página, 10 a 100 (default 25).',
  })
  @ApiResponse({
    status: 200,
    description: 'Eventos de auditoria paginados.',
    schema: zodSchemaToOpenApi(auditSearchResponseSchema),
  })
  @ApiResponse({ status: 403, description: 'Ator sem a capability AUDIT_READ.' })
  search(@CurrentUser() actor: AuthenticatedUser, @Query() query: Record<string, string>) {
    return this.auditQuery.search(actor, query);
  }
}
