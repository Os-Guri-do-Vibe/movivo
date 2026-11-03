import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ControlCenterCapability as Capability,
  importTacoSchema,
  tacoCatalogResponseSchema,
  tacoFoodsResponseSchema,
} from '@movivo/shared';

import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { TacoAdminService } from './taco-admin.service';

@ApiTags('Admin · TACO')
@ApiBearerAuth('access-token')
@Controller('control-center/ai/taco')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class TacoAdminController {
  constructor(private readonly taco: TacoAdminService) {}

  @Get()
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  @ApiOperation({
    summary: 'Situação da base de alimentos (TACO)',
    description:
      'Requer `AI_CONFIG_READ`. Quantos alimentos ativos vêm da TACO e de outras fontes, categorias e data da última atualização.',
  })
  @ApiResponse({
    status: 200,
    description: 'Resumo da base de alimentos.',
    schema: zodSchemaToOpenApi(tacoCatalogResponseSchema),
  })
  @ApiResponse({ status: 403, description: 'Ator sem a capability AI_CONFIG_READ.' })
  status() {
    return this.taco.status();
  }

  @Get('foods')
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  @ApiOperation({
    summary: 'Alimentos importados da TACO',
    description:
      'Requer `AI_CONFIG_READ`. Todos os alimentos ativos da TACO, com a composição por 100 g, na ordem da planilha.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de alimentos da TACO.',
    schema: zodSchemaToOpenApi(tacoFoodsResponseSchema),
  })
  @ApiResponse({ status: 403, description: 'Ator sem a capability AI_CONFIG_READ.' })
  foods() {
    return this.taco.listFoods();
  }

  @Post('import')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_KNOWLEDGE_WRITE)
  @ApiOperation({
    summary: 'Importa a TACO a partir de um CSV',
    description:
      'Requer `AI_KNOWLEDGE_WRITE`. CSV com os cabeçalhos da planilha oficial (número, descrição, energia kcal, proteína, lipídeos, carboidrato, fibra e, opcionalmente, minerais). Idempotente pelo número do alimento. Valores implausíveis recusam o arquivo inteiro.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(importTacoSchema) })
  @ApiResponse({
    status: 200,
    description: 'Importado; devolve o novo resumo e quantos alimentos entraram.',
    schema: zodSchemaToOpenApi(tacoCatalogResponseSchema),
  })
  @ApiResponse({ status: 400, description: 'CSV ilegível, sem alimentos ou com valores absurdos.' })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities AI_CONFIG_READ + AI_KNOWLEDGE_WRITE.',
  })
  import(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.taco.importCsv(actor, body);
  }
}
