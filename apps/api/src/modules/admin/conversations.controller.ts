import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  Sse,
  StreamableFile,
  UnauthorizedException,
  UseGuards,
  Header,
} from '@nestjs/common';
import type { Response } from 'express';
import { concatMap, takeUntil, timer } from 'rxjs';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ControlCenterCapability as Capability,
  controlCenterConversationAiAttendanceInputSchema,
  controlCenterConversationReadInputSchema,
  controlCenterConversationSendInputSchema,
} from '@movivo/shared';

import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { CurrentUser } from '../auth/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { ConversationEventsService } from '../../core/event-bus/conversation-events.service';
import { AuthService } from '../auth/auth.service';
import { ConversationsService } from './conversations.service';

/**
 * Conteúdo de conversa é dado de saúde: as rotas de leitura exigem `STUDENTS_READ` **e**
 * `STUDENTS_HEALTH_READ` (semântica AND). Sem a segunda, nem a lista é devolvida. As de
 * escrita (pausar o atendimento automático e enviar mensagem) exigem também `CONVERSATIONS_WRITE` — o
 * decorator do método SUBSTITUI o da classe, por isso as três são repetidas.
 */
@ApiTags('Admin · Central de Controle')
@ApiBearerAuth('access-token')
@Controller('control-center/conversations')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
@RequireCapabilities(Capability.STUDENTS_READ, Capability.STUDENTS_HEALTH_READ)
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly events: ConversationEventsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Conversas do WhatsApp — um item por aluno',
    description:
      'Alunos com ao menos uma mensagem, da conversa mais recente para a mais antiga. Acesso auditado.',
  })
  @ApiResponse({ status: 200, description: 'Lista de conversas.' })
  @ApiResponse({ status: 403, description: 'Ator sem STUDENTS_READ + STUDENTS_HEALTH_READ.' })
  list(@CurrentUser() actor: AuthenticatedUser) {
    return this.conversations.list(actor);
  }

  @Sse('events')
  @Header('Cache-Control', 'private, no-store, no-transform')
  @Header('X-Accel-Buffering', 'no')
  @ApiOperation({
    summary: 'Tempo real da aba Conversas (Server-Sent Events)',
    description:
      'Avisa mensagem nova (`conversation.message`) e mudança do atendimento automático (`conversation.attendance`). Só UUID e metadado — o conteúdo vem pela rota de mensagens, autorizada e auditada. Fecha em 5 min ou ao fim da sessão; o cliente reconecta. `Content-Type: text/event-stream` — não é chamável no "Try it out" do Swagger.',
  })
  @ApiResponse({ status: 200, description: 'Stream SSE.' })
  @ApiResponse({ status: 403, description: 'Ator sem STUDENTS_READ + STUDENTS_HEALTH_READ.' })
  stream(@CurrentUser() actor: AuthenticatedUser) {
    const remainingMs = (actor.expiresAt ?? 0) * 1000 - Date.now();
    if (remainingMs <= 0) throw new UnauthorizedException('Sessão expirada.');
    return this.events.stream().pipe(
      // A sessão pode ser revogada com o stream aberto: revalida a cada evento.
      concatMap(async (event) => {
        if ((actor.expiresAt ?? 0) * 1000 <= Date.now()) {
          throw new UnauthorizedException('Sessão expirada.');
        }
        await this.auth.assertActiveSession(actor.userId, actor.role, actor.jti);
        return event;
      }),
      takeUntil(timer(remainingMs)),
    );
  }

  @Get(':studentId/messages')
  @ApiOperation({
    summary: 'Histórico de mensagens de um aluno',
    description:
      'Página em ordem cronológica. `before` (ISO 8601) devolve mensagens anteriores a esse instante. Acesso auditado como leitura de dado de saúde.',
  })
  @ApiParam({ name: 'studentId', description: 'UUID do aluno.' })
  @ApiQuery({ name: 'before', required: false, description: 'ISO 8601 — paginação para trás.' })
  @ApiQuery({
    name: 'after',
    required: false,
    description:
      'ISO 8601 — só mensagens desde esse instante (inclusive), em ordem cronológica. Usado pelo tempo real.',
  })
  @ApiQuery({ name: 'limit', required: false, description: '1 a 100 (padrão 50).' })
  @ApiResponse({ status: 200, description: 'Mensagens decifradas do aluno.' })
  @ApiResponse({ status: 404, description: 'Aluno inexistente ou fora do escopo do ator.' })
  messages(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('studentId', new ParseUUIDPipe({ version: '4' })) studentId: string,
    @Query('before') before?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('after') after?: string,
  ) {
    const parseInstant = (value: string | undefined, name: string): Date | undefined => {
      if (value === undefined) return undefined;
      const instant = new Date(value);
      if (Number.isNaN(instant.getTime())) {
        throw new BadRequestException(`Parâmetro "${name}" inválido.`);
      }
      return instant;
    };
    return this.conversations.messages(
      actor,
      studentId,
      parseInstant(before, 'before'),
      limit,
      parseInstant(after, 'after'),
    );
  }

  @Get(':studentId/messages/:messageId/media')
  @ApiOperation({
    summary: 'Áudio ou imagem de uma mensagem do WhatsApp',
    description:
      'Bytes do arquivo original, decifrados. Mesma autorização do histórico (STUDENTS_READ + STUDENTS_HEALTH_READ, RLS do ator) e cada abertura é auditada como leitura de dado de saúde.',
  })
  @ApiParam({ name: 'studentId', description: 'UUID do aluno.' })
  @ApiParam({ name: 'messageId', description: 'UUID da mensagem.' })
  @ApiResponse({ status: 200, description: 'Arquivo (audio/* ou image/*).' })
  @ApiResponse({ status: 404, description: 'Sem mídia, ainda baixando ou fora do escopo.' })
  async media(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('studentId', new ParseUUIDPipe({ version: '4' })) studentId: string,
    @Param('messageId', new ParseUUIDPipe({ version: '4' })) messageId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { bytes, mimeType } = await this.conversations.media(actor, studentId, messageId);
    res.set({
      'Content-Type': mimeType,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    });
    return new StreamableFile(bytes);
  }

  @Get(':studentId/photo')
  @ApiOperation({
    summary: 'URL da foto de perfil do WhatsApp do aluno',
    description: '`url: null` quando o aluno não tem foto ou a mantém privada.',
  })
  @ApiParam({ name: 'studentId', description: 'UUID do aluno.' })
  @ApiResponse({ status: 200, description: 'URL da foto (ou null).' })
  @ApiResponse({ status: 404, description: 'Aluno inexistente ou fora do escopo do ator.' })
  async photo(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('studentId', new ParseUUIDPipe({ version: '4' })) studentId: string,
  ) {
    return { data: await this.conversations.photoUrl(actor, studentId) };
  }

  @Post(':studentId/read')
  @ApiOperation({
    summary: 'Marca a conversa de um aluno como lida',
    description:
      'Move o ponteiro de leitura (compartilhado pela equipe) até `upTo`, ou até agora. Só avança. Devolve a contagem de não lidas depois de marcar.',
  })
  @ApiParam({ name: 'studentId', description: 'UUID do aluno.' })
  @ApiBody({ schema: zodSchemaToOpenApi(controlCenterConversationReadInputSchema) })
  @ApiResponse({ status: 200, description: 'Contagem de não lidas depois da marca.' })
  @ApiResponse({ status: 400, description: 'Corpo fora do schema.' })
  @ApiResponse({ status: 404, description: 'Aluno inexistente ou fora do escopo do ator.' })
  markRead(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('studentId', new ParseUUIDPipe({ version: '4' })) studentId: string,
    @Body() body: unknown,
  ) {
    return this.conversations.markRead(actor, studentId, body);
  }

  @Post(':studentId/ai-attendance')
  @RequireCapabilities(
    Capability.STUDENTS_READ,
    Capability.STUDENTS_HEALTH_READ,
    Capability.CONVERSATIONS_WRITE,
  )
  @ApiOperation({
    summary: 'Pausa ou reativa o atendimento automático de um aluno',
    description:
      'Pausado, a IA não responde e a mensagem do aluno só é registrada no histórico. Vale até reativar à mão. Idempotente e auditado.',
  })
  @ApiParam({ name: 'studentId', description: 'UUID do aluno.' })
  @ApiBody({ schema: zodSchemaToOpenApi(controlCenterConversationAiAttendanceInputSchema) })
  @ApiResponse({ status: 200, description: 'Estado do atendimento depois da operação.' })
  @ApiResponse({ status: 400, description: 'Corpo fora do schema.' })
  @ApiResponse({ status: 403, description: 'Ator sem CONVERSATIONS_WRITE.' })
  @ApiResponse({ status: 404, description: 'Aluno inexistente ou fora do escopo do ator.' })
  setAiAttendance(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('studentId', new ParseUUIDPipe({ version: '4' })) studentId: string,
    @Body() body: unknown,
  ) {
    return this.conversations.setAiAttendance(actor, studentId, body);
  }

  @Post(':studentId/messages')
  @RequireCapabilities(
    Capability.STUDENTS_READ,
    Capability.STUDENTS_HEALTH_READ,
    Capability.CONVERSATIONS_WRITE,
  )
  @ApiOperation({
    summary: 'Envia ao WhatsApp do aluno uma mensagem escrita à mão',
    description:
      'Só com o atendimento automático pausado e com consentimento de saúde vigente. A mensagem entra no histórico e sai pelo worker de WhatsApp. Auditado (guarda só o tamanho do texto).',
  })
  @ApiParam({ name: 'studentId', description: 'UUID do aluno.' })
  @ApiBody({ schema: zodSchemaToOpenApi(controlCenterConversationSendInputSchema) })
  @ApiResponse({ status: 200, description: 'Mensagem registrada e enfileirada para envio.' })
  @ApiResponse({ status: 400, description: 'Texto vazio, longo demais ou fora do schema.' })
  @ApiResponse({ status: 403, description: 'Ator sem CONVERSATIONS_WRITE.' })
  @ApiResponse({ status: 404, description: 'Aluno inexistente ou fora do escopo do ator.' })
  @ApiResponse({
    status: 409,
    description: 'Atendimento automático ativo, ou aluno sem consentimento de saúde vigente.',
  })
  sendMessage(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('studentId', new ParseUUIDPipe({ version: '4' })) studentId: string,
    @Body() body: unknown,
  ) {
    return this.conversations.sendMessage(actor, studentId, body);
  }
}
