import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ControlCenterCapability as Capability,
  l1GuardrailsResponseSchema,
  publishL1GuardrailSchema,
  retireL1GuardrailSchema,
  rollbackL1GuardrailSchema,
} from '@movivo/shared';

import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { L1GuardrailAdminService } from './l1-guardrail-admin.service';

@ApiTags('Admin · Guardrail L1')
@ApiBearerAuth('access-token')
@Controller('control-center/ai/guardrails')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class L1GuardrailAdminController {
  constructor(private readonly guardrails: L1GuardrailAdminService) {}

  @Get()
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  @ApiOperation({
    summary: 'Lista todas as versões de regra de guardrail L1',
    description:
      'Requer `AI_CONFIG_READ`. Guardrail L1 = bloqueio determinístico por frase, aplicado ANTES de qualquer chamada de LLM.',
  })
  @ApiResponse({
    status: 200,
    description: 'Versões de regras.',
    schema: zodSchemaToOpenApi(l1GuardrailsResponseSchema),
  })
  @ApiResponse({ status: 403, description: 'Ator sem a capability AI_CONFIG_READ.' })
  list() {
    return this.guardrails.list();
  }

  @Post()
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  @ApiOperation({
    summary: 'Publica uma regra de guardrail (nova ou nova versão)',
    description:
      'Escopo `INPUT`/`OUTPUT`/`BOTH` e lista de frases-gatilho (sem duplicatas, case-insensitive em pt-BR).',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(publishL1GuardrailSchema) })
  @ApiResponse({ status: 200, description: 'Regra publicada — nova versão criada.' })
  @ApiResponse({
    status: 400,
    description:
      'Corpo fora do schema (ex.: frases duplicadas, rótulo com caractere não permitido).',
  })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities AI_CONFIG_READ + AI_CONFIG_WRITE.',
  })
  publish(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.guardrails.publish(actor, body);
  }

  @Post('rollback')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  @ApiOperation({
    summary: 'Reverte um `ruleKey` para uma versão anterior',
    description:
      'Cria uma NOVA versão com o conteúdo da `targetVersion` — histórico nunca é reescrito.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(rollbackL1GuardrailSchema) })
  @ApiResponse({ status: 200, description: 'Rollback aplicado.' })
  @ApiResponse({ status: 400, description: '`ruleKey`/`targetVersion` inexistente.' })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities AI_CONFIG_READ + AI_CONFIG_WRITE.',
  })
  rollback(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.guardrails.rollback(actor, body);
  }

  @Post('retire')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  @ApiOperation({
    summary: 'Aposenta um `ruleKey`',
    description: 'Marca a regra como `RETIRED` — deixa de bloquear, histórico preservado.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(retireL1GuardrailSchema) })
  @ApiResponse({ status: 200, description: 'Regra aposentada.' })
  @ApiResponse({ status: 400, description: '`ruleKey` inexistente ou já `RETIRED`.' })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities AI_CONFIG_READ + AI_CONFIG_WRITE.',
  })
  retire(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.guardrails.retire(actor, body);
  }
}
