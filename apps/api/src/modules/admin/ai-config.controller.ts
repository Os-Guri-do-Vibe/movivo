/**
 * Rotas do pilar IA do Control Center (US-7.7).
 *
 * Leitura sob `AI_CONFIG_READ`; **publicar e reverter exigem `AI_CONFIG_WRITE` no
 * servidor** — quem tem só leitura recebe 403 aqui mesmo chamando o endpoint direto, sem
 * depender de a UI esconder o botão (TASK-7.7.5).
 *
 * ## Slot da persona (Sprint 11)
 * Toda rota de persona é escopada a um dos dois públicos (`MALE`/`FEMALE`): `targetSex` é
 * **query param nos GETs** e **campo do corpo nos POSTs**. `POST /simulate` é a exceção
 * deliberada: os quatro checks do simulador não dependem do público, então exigir o slot ali
 * seria contrato morto.
 */
import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  agentConfigHistoryResponseSchema,
  agentPersonaResponseSchema,
  biologicalSexSchema,
  configSimulationResponseSchema,
  ControlCenterCapability as Capability,
  inviolableRulesResponseSchema,
  publishAgentConfigSchema,
  rollbackAgentConfigSchema,
  simulateAgentConfigSchema,
  type BiologicalSex,
} from '@movivo/shared';

import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { AiConfigService } from './ai-config.service';

/**
 * Slot da persona vindo da query string dos GETs.
 *
 * **Query param, nunca path param** (`persona/:targetSex`): a rota `persona/history` já
 * ocupa esse segmento, e um path param genérico competiria com ela na resolução de rotas do
 * Nest — `GET /persona/history` casaria com `targetSex = 'history'` dependendo da ordem de
 * registro. Nos POSTs o slot vai no corpo, validado pelo Zod junto do resto do payload.
 */
function parseTargetSex(raw: unknown): BiologicalSex {
  const parsed = biologicalSexSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestException({
      code: 'INVALID_INPUT',
      message: 'targetSex é obrigatório e precisa ser MALE ou FEMALE.',
    });
  }
  return parsed.data;
}

const TARGET_SEX_QUERY = {
  name: 'targetSex',
  enum: ['MALE', 'FEMALE'],
  description:
    'Slot da persona (público atendido). Obrigatório — duas personas coexistem publicadas, uma por sexo biológico informado na anamnese.',
} as const;

@ApiTags('Admin · Config de IA')
@ApiBearerAuth('access-token')
@Controller('control-center/ai')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class AiConfigController {
  constructor(private readonly aiConfig: AiConfigService) {}

  @Get('persona')
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  @ApiOperation({
    summary: 'Persona vigente de um slot',
    description:
      'Requer `AI_CONFIG_READ`. Se o slot pedido não tiver persona própria publicada, empresta a do outro sexo (`servedFromSex` na resposta indica de onde veio) ou cai no default compilado.',
  })
  @ApiQuery(TARGET_SEX_QUERY)
  @ApiResponse({
    status: 200,
    description: 'Persona resolvida para o slot.',
    schema: zodSchemaToOpenApi(agentPersonaResponseSchema),
  })
  @ApiResponse({ status: 400, description: '`targetSex` ausente ou fora de MALE/FEMALE.' })
  @ApiResponse({ status: 403, description: 'Ator sem a capability AI_CONFIG_READ.' })
  persona(@Query('targetSex') targetSex: unknown) {
    return this.aiConfig.persona(parseTargetSex(targetSex));
  }

  @Get('persona/history')
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  @ApiOperation({
    summary: 'Histórico de versões de persona de um slot',
    description:
      'Requer `AI_CONFIG_READ`. Parse tolerante — versão histórica sem os campos criados depois dela usa o default de código, nunca é descartada silenciosamente.',
  })
  @ApiQuery(TARGET_SEX_QUERY)
  @ApiResponse({
    status: 200,
    description: 'Versões do slot.',
    schema: zodSchemaToOpenApi(agentConfigHistoryResponseSchema),
  })
  @ApiResponse({ status: 400, description: '`targetSex` ausente ou fora de MALE/FEMALE.' })
  @ApiResponse({ status: 403, description: 'Ator sem a capability AI_CONFIG_READ.' })
  history(@Query('targetSex') targetSex: unknown) {
    return this.aiConfig.history(parseTargetSex(targetSex));
  }

  @Get('inviolable-rules')
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  @ApiOperation({
    summary: 'Blocos não editáveis do system prompt',
    description:
      'Requer `AI_CONFIG_READ`. Mostra as camadas (L0/L1/...) do prompt do AI Coach que o painel NÃO permite editar, com a justificativa de cada uma.',
  })
  @ApiQuery(TARGET_SEX_QUERY)
  @ApiResponse({
    status: 200,
    description: 'Blocos invioláveis do prompt.',
    schema: zodSchemaToOpenApi(inviolableRulesResponseSchema),
  })
  @ApiResponse({ status: 400, description: '`targetSex` ausente ou fora de MALE/FEMALE.' })
  @ApiResponse({ status: 403, description: 'Ator sem a capability AI_CONFIG_READ.' })
  inviolableRules(@Query('targetSex') targetSex: unknown) {
    return this.aiConfig.inviolableRules(parseTargetSex(targetSex));
  }

  @Post('simulate')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  @ApiOperation({
    summary: 'Roda os 4 checks de segurança sobre um candidato (dry-run)',
    description:
      'Não persiste nada. `kind` discrimina o tipo de candidato (PERSONA/FAQ/GUARDRAIL/' +
      'FORBIDDEN_TOPIC) — sem slot de sexo: os 4 checks (SCHEMA, GOLDEN_INPUT, ' +
      'GOLDEN_OUTPUT, PROMPT_INTEGRITY) não dependem do público.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(simulateAgentConfigSchema) })
  @ApiResponse({
    status: 200,
    description: 'Resultado dos 4 checks.',
    schema: zodSchemaToOpenApi(configSimulationResponseSchema),
  })
  @ApiResponse({ status: 400, description: 'Corpo fora do schema do `kind` informado.' })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities AI_CONFIG_READ + AI_CONFIG_WRITE.',
  })
  simulate(@Body() body: unknown) {
    return this.aiConfig.simulate(body);
  }

  @Post('persona')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  @ApiOperation({
    summary: 'Publica uma nova versão de persona para um slot',
    description:
      '`targetSex` vai no CORPO aqui (não na query, como nos GETs). `agentSelfIntro` passa pelo detector de injeção antes de gravar.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(publishAgentConfigSchema) })
  @ApiResponse({ status: 200, description: 'Persona publicada — nova versão vigente do slot.' })
  @ApiResponse({
    status: 400,
    description: 'Corpo fora do schema, ou `agentSelfIntro` reprovado no detector de injeção.',
  })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities AI_CONFIG_READ + AI_CONFIG_WRITE.',
  })
  publish(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.aiConfig.publish(actor, body);
  }

  @Post('persona/rollback')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  @ApiOperation({
    summary: 'Reverte um slot para uma versão anterior',
    description:
      'Chave real é o par `(targetSex, targetVersion)` — a numeração de versão é por slot, não global.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(rollbackAgentConfigSchema) })
  @ApiResponse({ status: 200, description: 'Rollback aplicado ao slot.' })
  @ApiResponse({ status: 400, description: '`(targetSex, targetVersion)` inexistente.' })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities AI_CONFIG_READ + AI_CONFIG_WRITE.',
  })
  rollback(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.aiConfig.rollback(actor, body);
  }
}
