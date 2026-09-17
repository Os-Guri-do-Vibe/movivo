import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  finishWorkoutSchema,
  saveWorkoutSetsSchema,
  uuidSchema,
  workoutDateSchema,
  workoutJournalSchema,
} from '@movivo/shared';
import { z } from 'zod';

import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { WorkoutAccessService } from './workout-access.service';
import { WorkoutJournalService } from './workout-journal.service';

const exchangeSchema = z.object({ token: z.string().min(40).max(100) });
const peekSchema = z.object({ token: z.string().min(40).max(100) });

/**
 * Este módulo NÃO usa o Bearer JWT do dashboard (`access-token`): o aluno chega pelo
 * magic-link de WhatsApp, troca o token de uso único por um `sessionToken` opaco de 30
 * dias (`exchange`) e passa a mandá-lo no header `Authorization` das demais rotas.
 */
const SESSION_TOKEN_HEADER = {
  name: 'authorization',
  description:
    'sessionToken opaco obtido em POST /workouts/access/exchange (não é o JWT do dashboard).',
  required: true,
} as const;

@ApiTags('Treino')
@Controller('workouts')
@UseGuards(ThrottlerGuard)
export class WorkoutController {
  constructor(
    private readonly access: WorkoutAccessService,
    private readonly journalService: WorkoutJournalService,
  ) {}

  @Post('access/exchange')
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Troca o magic-link por um sessionToken',
    description:
      'Consome o token de uso único do link de WhatsApp e emite um `sessionToken` opaco de 30 dias, usado nas demais rotas deste módulo via header `Authorization`.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(exchangeSchema) })
  @ApiResponse({ status: 200, description: 'Troca bem-sucedida — retorna o `sessionToken`.' })
  @ApiResponse({ status: 401, description: 'Token de acesso inválido, expirado ou já consumido.' })
  async exchange(@Body() raw: unknown) {
    const { token } = exchangeSchema.parse(raw);
    return { sessionToken: await this.access.exchange(token) };
  }

  @Get('access/peek')
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Espia o primeiro nome do titular do magic-link',
    description:
      'Usado pela tela de transição do link ("Oi, {firstName}!") antes da troca efetiva do token — não consome o token.',
  })
  @ApiQuery({
    name: 'token',
    description: 'Token de uso único do magic-link (mesmo token de `access/exchange`).',
  })
  @ApiResponse({ status: 200, description: 'Primeiro nome do titular.' })
  @ApiResponse({ status: 401, description: 'Token inválido ou expirado.' })
  async peek(@Query() raw: unknown) {
    const { token } = peekSchema.parse(raw);
    return { firstName: await this.access.peekFirstName(token) };
  }

  @Get('journal')
  @Header('Cache-Control', 'private, no-store')
  @ApiHeader(SESSION_TOKEN_HEADER)
  @ApiOperation({
    summary: 'Diário de treino do dia (ou de uma data específica)',
    description:
      'Semana calendário com o estado de cada dia (futuro/descanso/planejado/em andamento/concluído/perdido) e o detalhe do treino selecionado.',
  })
  @ApiQuery({
    name: 'date',
    required: false,
    description: 'Data ISO (YYYY-MM-DD). Ausente = hoje.',
  })
  @ApiResponse({
    status: 200,
    description: 'Diário de treino.',
    schema: zodSchemaToOpenApi(workoutJournalSchema),
  })
  @ApiResponse({ status: 401, description: 'sessionToken ausente, inválido ou expirado.' })
  async journal(@Headers('authorization') authorization?: string, @Query('date') date?: string) {
    const userId = await this.access.requireUser(authorization);
    return this.journalService.journal(
      userId,
      date === undefined ? undefined : workoutDateSchema.parse(date),
    );
  }

  @Post('sessions/:id/start')
  @Header('Cache-Control', 'private, no-store')
  @ApiHeader(SESSION_TOKEN_HEADER)
  @ApiOperation({
    summary: 'Inicia a execução de uma sessão de treino',
    description:
      'Marca a sessão planejada do dia como `IN_PROGRESS` e registra o horário de início.',
  })
  @ApiParam({ name: 'id', description: 'UUID da sessão de treino do protocolo.' })
  @ApiResponse({ status: 200, description: 'Sessão iniciada.' })
  @ApiResponse({ status: 401, description: 'sessionToken ausente, inválido ou expirado.' })
  @ApiResponse({ status: 404, description: 'Sessão inexistente ou de outro titular.' })
  async start(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
  ) {
    const userId = await this.access.requireUser(authorization);
    await this.journalService.start(userId, uuidSchema.parse(rawId));
    return { ok: true };
  }

  @Patch('sessions/:id/sets')
  @Header('Cache-Control', 'private, no-store')
  @ApiHeader(SESSION_TOKEN_HEADER)
  @ApiOperation({
    summary: 'Salva as séries executadas (upsert em lote)',
    description:
      'Reps, carga e status (feita/pulada) de cada série registrada durante a sessão em andamento.',
  })
  @ApiParam({ name: 'id', description: 'UUID da sessão de treino do protocolo.' })
  @ApiBody({ schema: zodSchemaToOpenApi(saveWorkoutSetsSchema) })
  @ApiResponse({ status: 200, description: 'Séries salvas.' })
  @ApiResponse({
    status: 400,
    description: 'Corpo fora do schema (ex.: série marcada como feita e pulada ao mesmo tempo).',
  })
  @ApiResponse({ status: 401, description: 'sessionToken ausente, inválido ou expirado.' })
  async sets(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
    @Body() raw: unknown,
  ) {
    const userId = await this.access.requireUser(authorization);
    const body = saveWorkoutSetsSchema.parse(raw);
    await this.journalService.saveSets(userId, uuidSchema.parse(rawId), body.entries);
    return { ok: true };
  }

  @Post('sessions/:id/finish')
  @Header('Cache-Control', 'private, no-store')
  @ApiHeader(SESSION_TOKEN_HEADER)
  @ApiOperation({
    summary: 'Finaliza a sessão de treino',
    description:
      'Registra esforço percebido, notas e dor reportada (por exercício). Marca a sessão como `COMPLETED` e calcula a duração.',
  })
  @ApiParam({ name: 'id', description: 'UUID da sessão de treino do protocolo.' })
  @ApiBody({ schema: zodSchemaToOpenApi(finishWorkoutSchema) })
  @ApiResponse({ status: 200, description: 'Sessão finalizada.' })
  @ApiResponse({
    status: 400,
    description: 'Corpo fora do schema (ex.: dor reportada sem exercício/nota associada).',
  })
  @ApiResponse({ status: 401, description: 'sessionToken ausente, inválido ou expirado.' })
  async finish(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
    @Body() raw: unknown,
  ) {
    const userId = await this.access.requireUser(authorization);
    await this.journalService.finish(
      userId,
      uuidSchema.parse(rawId),
      finishWorkoutSchema.parse(raw),
    );
    return { ok: true };
  }
}
