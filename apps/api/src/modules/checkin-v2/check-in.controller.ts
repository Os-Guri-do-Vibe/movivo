import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { checkInAnswersSchema, measurementInputSchema, uuidSchema } from '@movivo/shared';

import { parseBody } from '../../core/validation/strict-input';
import { TrainingAccessService } from '../training/training-access.service';
import { CheckInService } from './check-in.service';
import { EvolutionService } from './evolution.service';

const answersBody = z.object({ answers: checkInAnswersSchema });
const measurementsBody = z.object({ measurements: z.array(measurementInputSchema).min(1).max(12) });

/** Check-in adaptativo e evolução do aluno (mesma credencial de sessão do treino). */
@ApiTags('Check-in')
@Controller()
@UseGuards(ThrottlerGuard)
export class CheckInController {
  constructor(
    private readonly access: TrainingAccessService,
    private readonly checkIns: CheckInService,
    private readonly evolution: EvolutionService,
  ) {}

  @Get('check-ins/current')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Check-in aberto do aluno (perguntas escolhidas pelos sinais da semana)',
  })
  async current(@Headers('authorization') authorization?: string) {
    const userId = await this.access.requireUser(authorization);
    const current = await this.checkIns.current(userId);
    if (!current) throw new NotFoundException();
    return current;
  }

  @Post('check-ins/:id/answers')
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Responde o check-in' })
  async answer(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    const userId = await this.access.requireUser(authorization);
    await this.checkIns.answer(userId, uuidSchema.parse(id), parseBody(answersBody, raw).answers);
  }

  @Get('evolution')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Metas, medidas e treinos das últimas semanas' })
  async read(@Headers('authorization') authorization?: string) {
    const userId = await this.access.requireUser(authorization);
    return this.evolution.read(userId);
  }

  @Post('evolution/measurements')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Registra medidas corporais (opcionais)' })
  async measurements(@Body() raw: unknown, @Headers('authorization') authorization?: string) {
    const userId = await this.access.requireUser(authorization);
    const { measurements } = parseBody(measurementsBody, raw);
    return { saved: await this.evolution.addMeasurements(userId, measurements) };
  }
}
