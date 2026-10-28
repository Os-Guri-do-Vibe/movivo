import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
// Tipo `Express.Multer.File` de `@types/multer` (o tsconfig restringe `types`).
import 'multer';
import { z } from 'zod';

import {
  finishExecutionRequestSchema,
  logExternalRequestSchema,
  saveMetricsRequestSchema,
  saveSetsRequestSchema,
  uuidSchema,
} from '@movivo/shared';

import { parseBody } from '../../core/validation/strict-input';
import { ExecutionService } from './execution.service';
import { TrainingAccessService } from './training-access.service';

const tokenSchema = z.object({ token: z.string().min(40).max(100) });
const dateSchema = z.iso.date();
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/**
 * Página de treino do aluno. Não usa o JWT do painel: o aluno chega pelo link mágico do
 * WhatsApp, troca o token de uso único por um `sessionToken` opaco (30 dias) e o manda no
 * header `Authorization`.
 */
@ApiTags('Treino')
@Controller('training')
@UseGuards(ThrottlerGuard)
export class TrainingController {
  constructor(
    private readonly access: TrainingAccessService,
    private readonly executions: ExecutionService,
  ) {}

  @Post('access/exchange')
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({ summary: 'Troca o link mágico por um sessionToken' })
  async exchange(@Body() raw: unknown) {
    const { token } = parseBody(tokenSchema, raw);
    return { sessionToken: await this.access.exchange(token) };
  }

  @Get('access/peek')
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({ summary: 'Primeiro nome do dono do link, sem consumir o token' })
  async peek(@Query() raw: unknown) {
    const { token } = parseBody(tokenSchema, raw);
    return { firstName: await this.access.peekFirstName(token) };
  }

  @Get('day')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Semana e treino do dia (hoje, ou a data pedida)' })
  async day(@Headers('authorization') authorization?: string, @Query('date') date?: string) {
    const userId = await this.access.requireUser(authorization);
    return this.executions.day(userId, date === undefined ? undefined : dateSchema.parse(date));
  }

  @Post('sessions/:id/start')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Abre a execução de uma sessão agendada' })
  async start(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    const userId = await this.access.requireUser(authorization);
    return this.executions.start(userId, uuidSchema.parse(id));
  }

  @Put('executions/:id/sets')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Grava séries de força' })
  async sets(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    const userId = await this.access.requireUser(authorization);
    return this.executions.saveSets(
      userId,
      uuidSchema.parse(id),
      parseBody(saveSetsRequestSchema, raw),
    );
  }

  @Put('executions/:id/metrics')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Grava métricas de corrida/HYROX (manuais ou confirmadas)' })
  async metrics(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    const userId = await this.access.requireUser(authorization);
    return this.executions.saveMetrics(
      userId,
      uuidSchema.parse(id),
      parseBody(saveMetricsRequestSchema, raw),
    );
  }

  @Post('executions/:id/file')
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Importa um arquivo .fit ou .gpx para a execução' })
  async file(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Headers('authorization') authorization?: string,
  ) {
    const userId = await this.access.requireUser(authorization);
    if (!file) throw new BadRequestException('Envie o arquivo no campo "file".');
    return this.executions.importFile(
      userId,
      uuidSchema.parse(id),
      file.originalname,
      new Uint8Array(file.buffer),
    );
  }

  @Post('executions/:id/finish')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Conclui a execução (esforço, tempo, dor, gosto)' })
  async finish(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    const userId = await this.access.requireUser(authorization);
    return this.executions.finish(
      userId,
      uuidSchema.parse(id),
      parseBody(finishExecutionRequestSchema, raw),
    );
  }

  @Post('executions/external')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Registra um treino fora do plano (esporte externo ou avulso)' })
  async external(@Body() raw: unknown, @Headers('authorization') authorization?: string) {
    const userId = await this.access.requireUser(authorization);
    return this.executions.logExternal(userId, parseBody(logExternalRequestSchema, raw));
  }
}
