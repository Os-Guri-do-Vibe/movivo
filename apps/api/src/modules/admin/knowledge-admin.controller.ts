import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ControlCenterCapability as Capability,
  knowledgeDocumentContentResponseSchema,
  knowledgeDocumentsResponseSchema,
  reviewKnowledgeDocumentSchema,
  uploadKnowledgeDocumentSchema,
} from '@movivo/shared';

import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { KnowledgeAdminService } from './knowledge-admin.service';

@ApiTags('Admin · Base de Conhecimento')
@ApiBearerAuth('access-token')
@Controller('control-center/ai/knowledge')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class KnowledgeAdminController {
  constructor(private readonly knowledge: KnowledgeAdminService) {}

  @Get()
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  @ApiOperation({
    summary: 'Lista os documentos-fonte do RAG',
    description:
      'Requer `AI_CONFIG_READ`. Inclui o pipeline de status completo (quarentena → processamento → revisão → aprovação → indexação → publicado, ou rejeitado/falho/arquivado).',
  })
  @ApiResponse({
    status: 200,
    description: 'Documentos e política de upload vigente.',
    schema: zodSchemaToOpenApi(knowledgeDocumentsResponseSchema),
  })
  @ApiResponse({ status: 403, description: 'Ator sem a capability AI_CONFIG_READ.' })
  list(@CurrentUser() actor: AuthenticatedUser) {
    return this.knowledge.list(actor);
  }

  @Post('upload')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_KNOWLEDGE_WRITE)
  @ApiOperation({
    summary: 'Envia um novo documento-fonte',
    description:
      'Upload em JSON (não multipart) — `content` carrega o arquivo, respeitando o teto de tamanho e a allowlist de MIME type da política vigente. Entra em `QUARANTINED` até o pipeline de processamento assíncrono.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(uploadKnowledgeDocumentSchema) })
  @ApiResponse({ status: 200, description: 'Documento aceito e enfileirado para processamento.' })
  @ApiResponse({
    status: 400,
    description: 'MIME type fora da allowlist, tamanho acima do teto, ou corpo fora do schema.',
  })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities AI_CONFIG_READ + AI_KNOWLEDGE_WRITE.',
  })
  upload(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.knowledge.upload(actor, body);
  }

  @Post('review')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_KNOWLEDGE_APPROVE)
  @ApiOperation({
    summary: 'Aprova ou rejeita um documento em revisão',
    description:
      'Requer `AI_KNOWLEDGE_APPROVE` (checker) — separada de `AI_KNOWLEDGE_WRITE` (maker, quem fez o upload). Aprovar dispara a indexação (RAG); rejeitar encerra o pipeline.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(reviewKnowledgeDocumentSchema) })
  @ApiResponse({ status: 200, description: 'Decisão registrada.' })
  @ApiResponse({ status: 400, description: 'Documento fora do estágio READY_FOR_REVIEW.' })
  @ApiResponse({ status: 403, description: 'Ator sem a capability AI_KNOWLEDGE_APPROVE.' })
  review(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.knowledge.review(actor, body);
  }

  @Get(':id/content')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_KNOWLEDGE_APPROVE)
  @ApiOperation({
    summary: 'Lê o conteúdo bruto de um documento',
    description:
      'Requer `AI_KNOWLEDGE_APPROVE` — usado para o revisor ler o material antes de aprovar/rejeitar.',
  })
  @ApiParam({ name: 'id', description: 'UUID do documento.' })
  @ApiResponse({
    status: 200,
    description: 'Conteúdo do documento.',
    schema: zodSchemaToOpenApi(knowledgeDocumentContentResponseSchema),
  })
  @ApiResponse({ status: 403, description: 'Ator sem a capability AI_KNOWLEDGE_APPROVE.' })
  @ApiResponse({
    status: 404,
    description: 'Documento inexistente ou blob não mais disponível (retenção expirada).',
  })
  content(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.knowledge.content(actor, id);
  }

  @Post(':id/retry')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_KNOWLEDGE_WRITE)
  @ApiOperation({
    summary: 'Reprocessa um documento com falha',
    description:
      'Só aceito quando `canRetry` é `true` na listagem — reenfileira o pipeline de processamento a partir do estágio que falhou.',
  })
  @ApiParam({ name: 'id', description: 'UUID do documento.' })
  @ApiResponse({ status: 200, description: 'Reprocessamento enfileirado.' })
  @ApiResponse({
    status: 400,
    description: 'Documento não está em estado retentável (`canRetry: false`).',
  })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities AI_CONFIG_READ + AI_KNOWLEDGE_WRITE.',
  })
  retry(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.knowledge.retry(actor, id);
  }

  @Post(':id/archive')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_KNOWLEDGE_APPROVE)
  @ApiOperation({
    summary: 'Arquiva um documento publicado',
    description:
      'Requer `AI_KNOWLEDGE_APPROVE`. Remove o documento da base ativa do RAG — histórico preservado.',
  })
  @ApiParam({ name: 'id', description: 'UUID do documento.' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { note: { type: 'string', minLength: 5, maxLength: 500 } },
      required: ['note'],
    },
  })
  @ApiResponse({ status: 200, description: 'Documento arquivado.' })
  @ApiResponse({ status: 403, description: 'Ator sem a capability AI_KNOWLEDGE_APPROVE.' })
  @ApiResponse({ status: 404, description: 'Documento inexistente.' })
  archive(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    return this.knowledge.archive(actor, id, body);
  }
}
