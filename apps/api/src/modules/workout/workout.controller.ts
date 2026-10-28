import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Logger,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
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
import { parseBody } from '../../core/validation/strict-input';
import { TrainingAccessService } from '../training/training-access.service';
import { WorkoutJournalService } from './workout-journal.service';
import { WorkoutLinkResendService } from './workout-link-resend.service';

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
  private readonly logger = new Logger(WorkoutController.name);

  constructor(
    private readonly access: TrainingAccessService,
    private readonly journalService: WorkoutJournalService,
    private readonly resendService: WorkoutLinkResendService,
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
    const { token } = parseBody(exchangeSchema, raw);
    return { sessionToken: await this.access.exchange(token) };
  }

  @Post('access/resend')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Reenvia um novo link de check-in para o WhatsApp do titular',
    description:
      'Para o aluno cujo link já foi usado (ex.: guia anônima). O novo link vai só para o WhatsApp do dono, nunca na resposta; no máximo um a cada 10 minutos.',
  })
  @ApiBody({ schema: zodSchemaToOpenApi(exchangeSchema) })
  @ApiResponse({ status: 200, description: '`SENT` ou `THROTTLED` (já enviado há pouco).' })
  @ApiResponse({ status: 410, description: 'Link desconhecido ou revogado.' })
  async resend(@Body() raw: unknown) {
    const { token } = parseBody(exchangeSchema, raw);
    return { status: await this.resendService.resend(token) };
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
    const { token } = parseBody(peekSchema, raw);
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

  @Post('sessions/:id/late-start')
  @Header('Cache-Control', 'private, no-store')
  @ApiHeader(SESSION_TOKEN_HEADER)
  @ApiOperation({
    summary: 'Abre o registro de um treino feito em um dia recente',
    description:
      'Registro tardio: o aluno treinou e não registrou na hora. Vale para os últimos dias (janela curta); ' +
      'abre o treino do dia para preenchimento SEM cronômetro. O resto do fluxo (séries, finalizar) é o de sempre.',
  })
  @ApiParam({ name: 'id', description: 'UUID da sessão de treino do dia que passou.' })
  @ApiResponse({ status: 200, description: 'Registro tardio aberto.' })
  @ApiResponse({
    status: 400,
    description: 'Dia fora da janela, de hoje, ou treino já finalizado.',
  })
  @ApiResponse({ status: 401, description: 'sessionToken ausente, inválido ou expirado.' })
  @ApiResponse({ status: 404, description: 'Sessão inexistente ou de outro titular.' })
  async lateStart(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') rawId: string,
  ) {
    const userId = await this.access.requireUser(authorization);
    await this.journalService.startLate(userId, uuidSchema.parse(rawId));
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
    const body = parseBody(saveWorkoutSetsSchema, raw);
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
    const id = uuidSchema.parse(rawId);
    await this.journalService.finish(userId, id, parseBody(finishWorkoutSchema, raw));
    // Pré-aquece o card de Story: quando o aluno abrir a tela de conclusão o PNG já está
    // desenhado e em cache. Best-effort — se falhar, o `GET share-card` desenha sob demanda.
    void this.journalService.shareCardImage(userId, id).catch((error: unknown) => {
      this.logger.warn(`pré-aquecimento do share-card falhou: ${String(error)}`);
    });
    return { ok: true };
  }

  @Get('sessions/:id/share-card')
  @SkipThrottle()
  @ApiHeader(SESSION_TOKEN_HEADER)
  @ApiOperation({
    summary: 'Card de Story (PNG 1080×1920, fundo transparente) de um treino concluído',
    description:
      'Desenhado no servidor e cacheado por conteúdo (gênero, músculos, duração) — resposta imediata mesmo quando muitos alunos concluem ao mesmo tempo. Não contém dados pessoais.',
  })
  @ApiParam({ name: 'id', description: 'UUID da sessão de treino concluída.' })
  @ApiResponse({ status: 200, description: 'PNG do card.' })
  @ApiResponse({ status: 304, description: 'O cliente já tem esta versão (ETag).' })
  @ApiResponse({ status: 401, description: 'sessionToken ausente, inválido ou expirado.' })
  @ApiResponse({
    status: 404,
    description: 'Sessão inexistente, de outro titular ou não concluída.',
  })
  async shareCard(
    @Headers('authorization') authorization: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Param('id') rawId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = await this.access.requireUser(authorization);
    const { png, etag } = await this.journalService.shareCardImage(userId, uuidSchema.parse(rawId));
    const quoted = `"${etag}"`;
    // `private`: a URL é por sessão do aluno; o conteúdo, uma vez concluído o treino, não muda.
    res.setHeader('Cache-Control', 'private, max-age=86400, stale-while-revalidate=604800');
    res.setHeader('ETag', quoted);
    if (ifNoneMatch === quoted) {
      res.status(304);
      return;
    }
    return new StreamableFile(png, { type: 'image/png', length: png.length });
  }
}
