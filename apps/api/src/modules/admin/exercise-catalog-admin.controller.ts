import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ControlCenterCapability as Capability,
  exerciseCatalogResponseSchema,
  publishExerciseCatalogEntrySchema,
  retireExerciseCatalogEntrySchema,
} from '@movivo/shared';

import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { ExerciseCatalogAdminService } from './exercise-catalog-admin.service';

@ApiTags('Admin · Catálogo de Exercícios')
@ApiBearerAuth('access-token')
@Controller('control-center/ai/exercise-catalog')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class ExerciseCatalogAdminController {
  constructor(private readonly exerciseCatalog: ExerciseCatalogAdminService) {}

  @Get()
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  @ApiOperation({
    summary: 'Lista todas as versões do catálogo de exercícios',
    description:
      'Requer `AI_CONFIG_READ`. Inclui histórico completo (`PUBLISHED`/`RETIRED`) por `exerciseKey`.',
  })
  @ApiResponse({
    status: 200,
    description: 'Versões do catálogo.',
    schema: zodSchemaToOpenApi(exerciseCatalogResponseSchema),
  })
  @ApiResponse({ status: 403, description: 'Ator sem a capability AI_CONFIG_READ.' })
  list() {
    return this.exerciseCatalog.list();
  }

  @Post()
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  @ApiOperation({
    summary: 'Publica uma entrada do catálogo (nova ou nova versão)',
    description:
      'Sem estágio de aprovação separado — o ADMIN publica direto, como o FAQ. A garantia de segurança clínica continua sendo o `ValidationService`, que lê esta mesma base publicada como gabarito.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(publishExerciseCatalogEntrySchema) })
  @ApiResponse({ status: 200, description: 'Entrada publicada — nova versão criada.' })
  @ApiResponse({
    status: 400,
    description:
      'Corpo fora do schema (ex.: `exerciseKey` fora do padrão, faixa de duração inválida).',
  })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities AI_CONFIG_READ + AI_CONFIG_WRITE.',
  })
  publish(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.exerciseCatalog.publish(actor, body);
  }

  @Post('retire')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  @ApiOperation({
    summary: 'Aposenta uma entrada do catálogo',
    description:
      'Marca o `exerciseKey` como `RETIRED` — deixa de ser oferecido à geração de protocolo, mas o histórico de versões é preservado.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(retireExerciseCatalogEntrySchema) })
  @ApiResponse({ status: 200, description: 'Entrada aposentada.' })
  @ApiResponse({ status: 400, description: '`exerciseKey` inexistente ou já `RETIRED`.' })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities AI_CONFIG_READ + AI_CONFIG_WRITE.',
  })
  retire(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.exerciseCatalog.retire(actor, body);
  }
}
