import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
// Tipo `Express.Multer.File` de `@types/multer` (o tsconfig restringe `types`).
import 'multer';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
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
  MAX_KNOWLEDGE_DOCUMENT_BYTES,
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
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_KNOWLEDGE_DOCUMENT_BYTES, files: 1, fields: 10 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Envia um artigo científico para a base',
    description:
      'Upload `multipart/form-data` (campo `file`): PDF, Word (.docx), planilha (.xlsx/.csv), Markdown ou TXT, até o teto da política. Sem revisão nem justificativa: o artigo é extraído, indexado e publicado automaticamente. Reenviar um arquivo que ficou arquivado (fluxo antigo) o reativa.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        title: { type: 'string', description: 'Opcional; padrão: nome do arquivo.' },
        author: { type: 'string' },
        sourceUrl: { type: 'string', format: 'uri' },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 200, description: 'Artigo aceito e enfileirado para processamento.' })
  @ApiResponse({
    status: 400,
    description: 'Formato fora da allowlist, assinatura divergente ou tamanho acima do teto.',
  })
  @ApiResponse({ status: 409, description: 'O mesmo arquivo já está na base.' })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities AI_CONFIG_READ + AI_KNOWLEDGE_WRITE.',
  })
  upload(
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
  ) {
    return this.knowledge.upload(actor, file, body);
  }

  @Post(':id/delete')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_KNOWLEDGE_WRITE)
  @ApiOperation({
    summary: 'Exclui definitivamente um artigo da base',
    description:
      'Requer `AI_KNOWLEDGE_WRITE`. Sem justificativa. Remove do banco o documento, o original, o texto extraído, os trechos e os vetores (função `delete_knowledge_document`). Só a trilha de auditoria permanece, sem título nem conteúdo. Não há como desfazer; reenviar o arquivo recria o artigo.',
  })
  @ApiParam({ name: 'id', description: 'UUID do documento.' })
  @ApiResponse({ status: 200, description: 'Artigo excluído.' })
  @ApiResponse({ status: 404, description: 'Documento inexistente.' })
  remove(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.knowledge.remove(actor, id);
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
