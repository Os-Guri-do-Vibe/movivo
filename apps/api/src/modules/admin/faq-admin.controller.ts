import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ControlCenterCapability as Capability,
  faqEntriesResponseSchema,
  publishFaqEntrySchema,
  retireFaqEntrySchema,
  rollbackFaqEntrySchema,
} from '@movivo/shared';

import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { FaqAdminService } from './faq-admin.service';

@ApiTags('Admin · FAQ')
@ApiBearerAuth('access-token')
@Controller('control-center/ai/faq')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class FaqAdminController {
  constructor(private readonly faq: FaqAdminService) {}

  @Get()
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  @ApiOperation({
    summary: 'Lista todas as versões de FAQ',
    description:
      'Requer `AI_CONFIG_READ`. Inclui histórico completo (`PUBLISHED`/`RETIRED`) por `faqKey`.',
  })
  @ApiResponse({
    status: 200,
    description: 'Versões de FAQ.',
    schema: zodSchemaToOpenApi(faqEntriesResponseSchema),
  })
  @ApiResponse({ status: 403, description: 'Ator sem a capability AI_CONFIG_READ.' })
  list() {
    return this.faq.list();
  }

  @Post()
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  @ApiOperation({
    summary: 'Publica uma entrada de FAQ (nova ou nova versão)',
    description:
      'Servida pelo AI Coach ao responder perguntas frequentes. `changeNote` é obrigatória (rastreabilidade de por que o conteúdo mudou).',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(publishFaqEntrySchema) })
  @ApiResponse({ status: 200, description: 'Entrada publicada — nova versão criada.' })
  @ApiResponse({
    status: 400,
    description: 'Corpo fora do schema (ex.: pergunta com marcação, resposta muito curta).',
  })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities AI_CONFIG_READ + AI_CONFIG_WRITE.',
  })
  publish(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.faq.publish(actor, body);
  }

  @Post('rollback')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  @ApiOperation({
    summary: 'Reverte um `faqKey` para uma versão anterior',
    description:
      'Cria uma NOVA versão com o conteúdo da `targetVersion` — o histórico nunca é reescrito, só estendido.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(rollbackFaqEntrySchema) })
  @ApiResponse({
    status: 200,
    description: 'Rollback aplicado — nova versão criada com o conteúdo da versão-alvo.',
  })
  @ApiResponse({ status: 400, description: '`faqKey`/`targetVersion` inexistente.' })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities AI_CONFIG_READ + AI_CONFIG_WRITE.',
  })
  rollback(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.faq.rollback(actor, body);
  }

  @Post('retire')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  @ApiOperation({
    summary: 'Aposenta um `faqKey`',
    description:
      'Marca a entrada como `RETIRED` — deixa de ser servida ao AI Coach, histórico preservado.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(retireFaqEntrySchema) })
  @ApiResponse({ status: 200, description: 'Entrada aposentada.' })
  @ApiResponse({ status: 400, description: '`faqKey` inexistente ou já `RETIRED`.' })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities AI_CONFIG_READ + AI_CONFIG_WRITE.',
  })
  retire(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.faq.retire(actor, body);
  }
}
