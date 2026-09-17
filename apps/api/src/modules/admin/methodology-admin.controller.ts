import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  createMethodologyVersionSchema,
  methodologyNoteSchema,
  methodologyReviewSchema,
  methodologyVersionsResponseSchema,
} from '@movivo/shared';
import { BadRequestException } from '@nestjs/common';
import { ControlCenterCapability as Capability } from '@movivo/shared';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { MethodologyAdminService } from './methodology-admin.service';

const NOTE_BODY = { schema: zodSchemaToOpenApi(methodologyNoteSchema) };
const VERSION_ID_PARAM = { name: 'id', description: 'UUID da versão da metodologia.' } as const;

@ApiTags('Admin · Metodologia')
@ApiBearerAuth('access-token')
@Controller('control-center/ai/methodology')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class MethodologyAdminController {
  constructor(private readonly methodology: MethodologyAdminService) {}

  @Get()
  @RequireCapabilities(Capability.AI_CONFIG_READ)
  @ApiOperation({
    summary: 'Lista todas as versões da metodologia de treino',
    description:
      'Requer `AI_CONFIG_READ`. Fluxo maker-checker completo: DRAFT → IN_REVIEW → (REJECTED | APPROVED) → PUBLISHED → ARCHIVED. Conteúdo completo (sem resumo) é o que o gerador de protocolo e o AI Coach recebem.',
  })
  @ApiResponse({
    status: 200,
    description: 'Versões da metodologia.',
    schema: zodSchemaToOpenApi(methodologyVersionsResponseSchema),
  })
  @ApiResponse({ status: 403, description: 'Ator sem a capability AI_CONFIG_READ.' })
  list(@CurrentUser() actor: AuthenticatedUser) {
    return this.methodology.list(actor);
  }

  @Post()
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_KNOWLEDGE_WRITE)
  @ApiOperation({
    summary: 'Cria um rascunho de nova versão da metodologia (maker)',
    description: 'Sem teto de caracteres — o profissional CREF decide o quanto o conteúdo precisa.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(createMethodologyVersionSchema) })
  @ApiResponse({ status: 200, description: 'Rascunho (`DRAFT`) criado.' })
  @ApiResponse({
    status: 400,
    description: 'Corpo fora do schema (conteúdo abaixo de 200 caracteres, `changeNote` curta).',
  })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities AI_CONFIG_READ + AI_KNOWLEDGE_WRITE.',
  })
  create(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown) {
    return this.methodology.create(actor, body);
  }

  @Post(':id/submit')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_KNOWLEDGE_WRITE)
  @ApiOperation({
    summary: 'Envia o rascunho para revisão',
    description: 'DRAFT → IN_REVIEW. Não altera o conteúdo publicado vigente.',
  })
  @ApiParam(VERSION_ID_PARAM)
  @ApiBody(NOTE_BODY)
  @ApiResponse({ status: 200, description: 'Versão movida para IN_REVIEW.' })
  @ApiResponse({
    status: 400,
    description: 'Corpo fora do schema, ou versão fora do estágio DRAFT.',
  })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities AI_CONFIG_READ + AI_KNOWLEDGE_WRITE.',
  })
  submit(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    const note = methodologyNoteSchema.safeParse(body);
    if (!note.success) throw new BadRequestException({ code: 'INVALID_INPUT' });
    return this.methodology.submit(actor, { versionId: id, note: note.data.note });
  }

  @Post(':id/review')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_METHODOLOGY_APPROVE)
  @ApiOperation({
    summary: 'Aprova ou rejeita uma versão em revisão (checker)',
    description:
      'Requer `AI_METHODOLOGY_APPROVE`, separada de `AI_KNOWLEDGE_WRITE` (maker) — quem cria o rascunho nunca é quem aprova.',
  })
  @ApiParam(VERSION_ID_PARAM)
  @ApiBody({ schema: zodSchemaToOpenApi(methodologyReviewSchema) })
  @ApiResponse({ status: 200, description: 'Decisão registrada (APPROVED ou REJECTED).' })
  @ApiResponse({
    status: 400,
    description: 'Corpo fora do schema, ou versão fora do estágio IN_REVIEW.',
  })
  @ApiResponse({ status: 403, description: 'Ator sem a capability AI_METHODOLOGY_APPROVE.' })
  review(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    const review = methodologyReviewSchema.safeParse(body);
    if (!review.success) throw new BadRequestException({ code: 'INVALID_INPUT' });
    return this.methodology.review(
      actor,
      { versionId: id, note: review.data.note },
      review.data.decision,
    );
  }

  @Post(':id/publish')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_METHODOLOGY_APPROVE)
  @ApiOperation({
    summary: 'Publica uma versão aprovada',
    description:
      'APPROVED → PUBLISHED. Requer `AI_METHODOLOGY_APPROVE`. A versão publicada anterior é arquivada automaticamente.',
  })
  @ApiParam(VERSION_ID_PARAM)
  @ApiBody(NOTE_BODY)
  @ApiResponse({
    status: 200,
    description: 'Versão publicada — passa a valer para geração de protocolo e AI Coach.',
  })
  @ApiResponse({ status: 400, description: 'Versão fora do estágio APPROVED.' })
  @ApiResponse({ status: 403, description: 'Ator sem a capability AI_METHODOLOGY_APPROVE.' })
  publish(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string, @Body() body: unknown) {
    const note = methodologyNoteSchema.safeParse(body);
    if (!note.success) throw new BadRequestException({ code: 'INVALID_INPUT' });
    return this.methodology.publish(actor, { versionId: id, note: note.data.note });
  }

  @Post(':id/rollback')
  @RequireCapabilities(Capability.AI_CONFIG_READ, Capability.AI_KNOWLEDGE_WRITE)
  @ApiOperation({
    summary: 'Reverte para uma versão anterior já publicada',
    description:
      'Cria uma NOVA versão `PUBLISHED` com o conteúdo da versão-alvo — o histórico nunca é reescrito.',
  })
  @ApiParam(VERSION_ID_PARAM)
  @ApiBody(NOTE_BODY)
  @ApiResponse({ status: 200, description: 'Rollback aplicado.' })
  @ApiResponse({ status: 400, description: 'Versão-alvo inexistente ou nunca publicada.' })
  @ApiResponse({
    status: 403,
    description: 'Ator sem as capabilities AI_CONFIG_READ + AI_KNOWLEDGE_WRITE.',
  })
  rollback(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const note = methodologyNoteSchema.safeParse(body);
    if (!note.success) throw new BadRequestException({ code: 'INVALID_INPUT' });
    return this.methodology.rollback(actor, { versionId: id, note: note.data.note });
  }
}
