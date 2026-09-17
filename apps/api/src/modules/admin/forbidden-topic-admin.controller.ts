import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ControlCenterCapability as Capability,
  createForbiddenTopicSchema,
  forbiddenTopicActionSchema,
  forbiddenTopicsResponseSchema,
} from '@movivo/shared';

import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { ForbiddenTopicAdminService } from './forbidden-topic-admin.service';

@ApiTags('Admin · Tópicos Proibidos')
@ApiBearerAuth('access-token')
@Controller('control-center/ai/forbidden-topics')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class ForbiddenTopicAdminController {
  constructor(private readonly topics: ForbiddenTopicAdminService) {}

  @Get()
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  @ApiOperation({
    summary: 'Lista todas as versões de tema proibido',
    description:
      'Requer `AI_CONFIG_READ`. Fluxo maker-checker (propose → submit → approve/retire) — `action` é sempre `BLOCK` por construção, o vocabulário não sabe expressar "permitir".',
  })
  @ApiResponse({
    status: 200,
    description: 'Versões de tema proibido + rótulos ativos no prompt + limites.',
    schema: zodSchemaToOpenApi(forbiddenTopicsResponseSchema),
  })
  @ApiResponse({ status: 403, description: 'Ator sem a capability AI_CONFIG_READ.' })
  list() {
    return this.topics.list();
  }

  @Post()
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  @ApiOperation({
    summary: 'Propõe um tema proibido (rascunho — maker)',
    description:
      '`topicKey` em kebab-case; `phrases` nunca vai para o prompt do LLM, só o comparador determinístico do servidor lê. Termos-âncora do domínio (ex.: "treino", "dor") são recusados por denylist.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(createForbiddenTopicSchema) })
  @ApiResponse({ status: 200, description: 'Rascunho criado.' })
  @ApiResponse({
    status: 400,
    description: 'Corpo fora do schema, termo na denylist, ou teto de frases/temas excedido.',
  })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities AI_CONFIG_READ + AI_CONFIG_WRITE.',
  })
  propose(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.topics.propose(actor, body);
  }

  @Post('submit')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_CONFIG_WRITE)
  @ApiOperation({
    summary: 'Envia o rascunho para aprovação',
    description:
      'Passo intermediário do maker-checker — ainda não ativa o bloqueio, só torna a proposta visível para quem tem AI_GUARDRAIL_APPROVE.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(forbiddenTopicActionSchema) })
  @ApiResponse({ status: 200, description: 'Proposta enviada para aprovação.' })
  @ApiResponse({ status: 400, description: '`topicKey` inexistente ou fora do estágio esperado.' })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities AI_CONFIG_READ + AI_CONFIG_WRITE.',
  })
  submit(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.topics.submit(actor, body);
  }

  @Post('approve')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_GUARDRAIL_APPROVE)
  @ApiOperation({
    summary: 'Aprova e ativa o tema proibido (checker)',
    description:
      'Requer `AI_GUARDRAIL_APPROVE` — separado de `AI_CONFIG_WRITE` de propósito: quem propõe (maker) nunca é quem aprova (checker), regra reforçada também por `CHECK` no banco.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(forbiddenTopicActionSchema) })
  @ApiResponse({
    status: 200,
    description: 'Tema aprovado — passa a ser reforçado no prompt do AI Coach.',
  })
  @ApiResponse({
    status: 400,
    description: '`topicKey` fora do estágio SUBMITTED, ou aprovador é o mesmo ator que propôs.',
  })
  @ApiResponse({ status: 403, description: 'Ator sem a capability AI_GUARDRAIL_APPROVE.' })
  approve(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.topics.approve(actor, body);
  }

  @Post('retire')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_GUARDRAIL_APPROVE)
  @ApiOperation({
    summary: 'Aposenta um tema proibido ativo',
    description:
      'Requer `AI_GUARDRAIL_APPROVE`. Remove o tema do reforço do prompt — histórico preservado.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(forbiddenTopicActionSchema) })
  @ApiResponse({ status: 200, description: 'Tema aposentado.' })
  @ApiResponse({ status: 400, description: '`topicKey` inexistente ou já `RETIRED`.' })
  @ApiResponse({ status: 403, description: 'Ator sem a capability AI_GUARDRAIL_APPROVE.' })
  retire(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.topics.retire(actor, body);
  }
}
