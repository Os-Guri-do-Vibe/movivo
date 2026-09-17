import { Body, Controller, Get, Header, Param, Patch, Post, Sse, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { protocolStructureSchema, publishExerciseCatalogEntrySchema } from '@movivo/shared';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { DashboardService } from './dashboard.service';
import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';

@ApiTags('Admin · Dashboard')
@ApiBearerAuth('access-token')
@Controller('professional/dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PROFESSIONAL')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('queue')
  @Roles('PROFESSIONAL', 'ADMIN')
  @ApiOperation({
    summary: 'Fila de trabalho do profissional CREF',
    description:
      'Itens pendentes de ação humana: protocolos aguardando assinatura/revisão, handoffs de IA, check-ins e substituições de exercício propostas pela IA.',
  })
  @ApiResponse({ status: 200, description: 'Itens da fila.' })
  @ApiResponse({ status: 403, description: 'Papel USER (rota exclusiva de PROFESSIONAL/ADMIN).' })
  queue(@CurrentUser() actor: AuthenticatedUser) {
    return this.dashboard.queue(actor);
  }

  @Sse('queue/events')
  @Roles('PROFESSIONAL', 'ADMIN')
  @Header('Cache-Control', 'private, no-store, no-transform')
  @Header('X-Accel-Buffering', 'no')
  @ApiOperation({
    summary: 'Stream de eventos da fila (Server-Sent Events)',
    description:
      'Atualiza a fila em tempo real sem polling. `Content-Type: text/event-stream` — não é chamável a partir do "Try it out" do Swagger UI.',
  })
  @ApiResponse({ status: 200, description: 'Stream SSE de eventos de fila.' })
  events(@CurrentUser() actor: AuthenticatedUser) {
    return this.dashboard.events(actor);
  }

  @Get('queue/:kind/:id')
  @Roles('PROFESSIONAL', 'ADMIN')
  @ApiOperation({ summary: 'Detalhe de um item da fila' })
  @ApiParam({ name: 'kind', enum: ['PROTOCOL', 'HANDOFF', 'CHECKIN', 'SUBSTITUTION'] })
  @ApiParam({
    name: 'id',
    description: 'UUID do item (protocolo, handoff, check-in ou substituição, conforme `kind`).',
  })
  @ApiResponse({ status: 200, description: 'Detalhe do item.' })
  @ApiResponse({ status: 404, description: 'Item inexistente para o `kind`/`id` informados.' })
  detail(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('kind') kind: string,
    @Param('id') id: string,
  ) {
    return this.dashboard.detail(actor, kind, id);
  }

  @Get('queue/protocol/:id/anamnesis')
  @Roles('PROFESSIONAL', 'ADMIN')
  @ApiOperation({
    summary: 'Respostas de anamnese que geraram o protocolo',
    description:
      'Contexto completo (dados pessoais, rotina, PAR-Q) para o profissional revisar antes de assinar.',
  })
  @ApiParam({ name: 'id', description: 'UUID do protocolo.' })
  @ApiResponse({ status: 200, description: 'Respostas de anamnese do titular do protocolo.' })
  @ApiResponse({ status: 404, description: 'Protocolo inexistente.' })
  anamnesisAnswers(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.dashboard.anamnesisAnswers(actor, id);
  }

  /**
   * `ADMIN` (conta fundador) tem acesso total à fila, inclusive assinatura de protocolo
   * (achado 2026-08-22, decisão do fundador): a MOVIVO no início só tem um profissional
   * CREF, também sócio-fundador, e a conta dele já usa o papel de fundador. Por isso todo
   * `ADMIN` ganha as mesmas ações de `PROFESSIONAL` aqui — a segunda barreira (crédito
   * CREF ativo) continua existindo só para contas `PROFESSIONAL`, ver `signProtocol` em
   * `dashboard.service.ts`.
   */
  @Patch('protocols/:id')
  @Roles('PROFESSIONAL', 'ADMIN')
  @ApiOperation({
    summary: 'Edita o conteúdo de um protocolo antes de assinar',
    description:
      '`ADMIN` (conta fundadora) tem o mesmo acesso de `PROFESSIONAL` aqui — no MVP o único profissional CREF já é sócio-fundador.',
  })
  @ApiParam({ name: 'id', description: 'UUID do protocolo.' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        content: zodSchemaToOpenApi(protocolStructureSchema),
        reason: { type: 'string', minLength: 5, maxLength: 500 },
      },
      required: ['content', 'reason'],
    },
  })
  @ApiResponse({ status: 200, description: 'Protocolo atualizado.' })
  @ApiResponse({
    status: 400,
    description: 'Corpo fora do schema, ou conteúdo reprovado pelo ValidationService.',
  })
  @ApiResponse({ status: 404, description: 'Protocolo inexistente.' })
  editProtocol(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.dashboard.editProtocol(actor, id, body);
  }

  @Post('protocols/:id/sign')
  @Roles('PROFESSIONAL', 'ADMIN')
  @ApiOperation({
    summary: 'Assina o protocolo (libera para o aluno)',
    description:
      'Exige `confirmation: true` explícito no corpo — sem fricção artificial escondida, mas sem assinatura por clique acidental. Papel `PROFESSIONAL` exige crédito CREF ativo (segunda barreira, verificada no serviço); `ADMIN` não.',
  })
  @ApiParam({ name: 'id', description: 'UUID do protocolo.' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { confirmation: { type: 'boolean', enum: [true] } },
      required: ['confirmation'],
    },
  })
  @ApiResponse({ status: 200, description: 'Protocolo assinado e enviado ao aluno.' })
  @ApiResponse({ status: 400, description: '`confirmation` ausente ou `false`.' })
  @ApiResponse({ status: 403, description: 'Papel PROFESSIONAL sem crédito CREF ativo.' })
  @ApiResponse({ status: 404, description: 'Protocolo inexistente.' })
  signProtocol(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.dashboard.signProtocol(actor, id, body);
  }

  @Post('substitutions/:id/approve')
  @Roles('PROFESSIONAL', 'ADMIN')
  @ApiOperation({
    summary: 'Aprova a substituição de exercício proposta pela IA',
    description: 'Reenvia o PDF do protocolo atualizado + resumo por WhatsApp ao aluno.',
  })
  @ApiParam({ name: 'id', description: 'UUID da proposta de substituição.' })
  @ApiResponse({ status: 200, description: 'Substituição aprovada e entregue ao aluno.' })
  @ApiResponse({ status: 404, description: 'Proposta inexistente.' })
  approveSubstitutionNow(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.dashboard.approveSubstitutionNow(actor, id);
  }

  @Post('substitutions/:id/discard')
  @Roles('PROFESSIONAL', 'ADMIN')
  @ApiOperation({
    summary: 'Descarta a substituição proposta pela IA',
    description: 'O protocolo permanece como estava — nenhuma troca é aplicada.',
  })
  @ApiParam({ name: 'id', description: 'UUID da proposta de substituição.' })
  @ApiResponse({ status: 200, description: 'Proposta descartada.' })
  @ApiResponse({ status: 404, description: 'Proposta inexistente.' })
  discardSubstitution(@CurrentUser() actor: AuthenticatedUser, @Param('id') id: string) {
    return this.dashboard.discardSubstitution(actor, id);
  }

  @Post('substitutions/:id/add-and-approve')
  @Roles('PROFESSIONAL', 'ADMIN')
  @ApiOperation({
    summary: 'Publica um exercício novo no catálogo e aprova a substituição',
    description:
      'Requer a capability `AI_CONFIG_WRITE` além do papel (verificado explicitamente no serviço) — `PROFESSIONAL` aprova conteúdo curado, mas publicar exercício novo é decisão deliberadamente mais restrita.',
  })
  @ApiParam({ name: 'id', description: 'UUID da proposta de substituição.' })
  @ApiBody({ schema: zodSchemaToOpenApi(publishExerciseCatalogEntrySchema) })
  @ApiResponse({
    status: 200,
    description: 'Exercício publicado no catálogo e substituição aprovada.',
  })
  @ApiResponse({ status: 400, description: 'Corpo fora do schema de publicação de catálogo.' })
  @ApiResponse({
    status: 403,
    description: 'Ator sem a capability AI_CONFIG_WRITE (mesmo tendo o papel PROFESSIONAL/ADMIN).',
  })
  @ApiResponse({ status: 404, description: 'Proposta inexistente.' })
  addCatalogExerciseAndApproveSubstitution(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.dashboard.addCatalogExerciseAndApproveSubstitution(actor, id, body);
  }

  @Post('handoffs/:id/resolve')
  @Roles('PROFESSIONAL', 'ADMIN')
  @ApiOperation({
    summary: 'Resolve um handoff (pedido de humano) da IA',
    description:
      'Exige `confirmation: true`, `resolution` (rótulo curto) e `notes` (o que foi feito/dito ao aluno).',
  })
  @ApiParam({ name: 'id', description: 'UUID do handoff.' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        resolution: { type: 'string', minLength: 3, maxLength: 80 },
        notes: { type: 'string', minLength: 3, maxLength: 1000 },
        confirmation: { type: 'boolean', enum: [true] },
      },
      required: ['resolution', 'notes', 'confirmation'],
    },
  })
  @ApiResponse({ status: 200, description: 'Handoff resolvido.' })
  @ApiResponse({ status: 400, description: 'Corpo fora do schema.' })
  @ApiResponse({ status: 404, description: 'Handoff inexistente.' })
  resolveHandoff(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.dashboard.resolveHandoff(actor, id, body);
  }

  @Get('operations')
  @Roles('PROFESSIONAL', 'ADMIN')
  @ApiOperation({
    summary: 'Painel operacional agregado do profissional',
    description:
      'Métricas de rotina do dia a dia (tamanho da fila por tipo, tempo médio de resolução, etc.) — não confundir com o pilar "Sistema" do Control Center.',
  })
  @ApiResponse({ status: 200, description: 'Métricas operacionais.' })
  operations(@CurrentUser() actor: AuthenticatedUser) {
    return this.dashboard.operations(actor);
  }
}
