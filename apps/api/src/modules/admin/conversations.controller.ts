import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ControlCenterCapability as Capability } from '@movivo/shared';

import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { CurrentUser } from '../auth/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { ConversationsService } from './conversations.service';

/**
 * Conteúdo de conversa é dado de saúde: as três rotas exigem `STUDENTS_READ` **e**
 * `STUDENTS_HEALTH_READ` (semântica AND). Sem a segunda, nem a lista é devolvida.
 */
@ApiTags('Admin · Central de Controle')
@ApiBearerAuth('access-token')
@Controller('control-center/conversations')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
@RequireCapabilities(Capability.STUDENTS_READ, Capability.STUDENTS_HEALTH_READ)
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

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

  @Get(':studentId/messages')
  @ApiOperation({
    summary: 'Histórico de mensagens de um aluno',
    description:
      'Página em ordem cronológica. `before` (ISO 8601) devolve mensagens anteriores a esse instante. Acesso auditado como leitura de dado de saúde.',
  })
  @ApiParam({ name: 'studentId', description: 'UUID do aluno.' })
  @ApiQuery({ name: 'before', required: false, description: 'ISO 8601 — paginação para trás.' })
  @ApiQuery({ name: 'limit', required: false, description: '1 a 100 (padrão 50).' })
  @ApiResponse({ status: 200, description: 'Mensagens decifradas do aluno.' })
  @ApiResponse({ status: 404, description: 'Aluno inexistente ou fora do escopo do ator.' })
  messages(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('studentId', new ParseUUIDPipe({ version: '4' })) studentId: string,
    @Query('before') before?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    let cursor: Date | undefined;
    if (before !== undefined) {
      cursor = new Date(before);
      if (Number.isNaN(cursor.getTime())) {
        throw new BadRequestException('Parâmetro "before" inválido.');
      }
    }
    return this.conversations.messages(actor, studentId, cursor, limit);
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
}
