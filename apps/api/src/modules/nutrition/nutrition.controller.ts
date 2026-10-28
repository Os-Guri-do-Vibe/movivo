import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
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
import 'multer';
import { z } from 'zod';

import {
  confirmFoodLogRequestSchema,
  interpretFoodTextRequestSchema,
  manualFoodLogRequestSchema,
  mealSlotSchema,
  uuidSchema,
} from '@movivo/shared';

import { parseBody } from '../../core/validation/strict-input';
import { TrainingAccessService } from '../training/training-access.service';
import { FoodLogService } from './food-log.service';
import { imageForVision } from './image-guard';

const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const dateSchema = z.iso.date();
const queryTextSchema = z.string().trim().min(2).max(60);

/** Registro alimentar do aluno (mesma credencial de sessão da página de treino). */
@ApiTags('Alimentação')
@Controller('nutrition')
@UseGuards(ThrottlerGuard)
export class NutritionController {
  constructor(
    private readonly access: TrainingAccessService,
    private readonly logs: FoodLogService,
  ) {}

  @Get('day')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Meta, refeições e totais do dia' })
  async day(@Headers('authorization') authorization?: string, @Query('date') date?: string) {
    const userId = await this.access.requireUser(authorization);
    return this.logs.day(userId, date === undefined ? undefined : dateSchema.parse(date));
  }

  @Get('foods')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Busca na base de alimentos' })
  async foods(@Query('q') q: string, @Headers('authorization') authorization?: string) {
    await this.access.requireUser(authorization);
    return this.logs.search(queryTextSchema.parse(q));
  }

  @Post('logs/text')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Interpreta um relato de refeição em rascunho' })
  async text(@Body() raw: unknown, @Headers('authorization') authorization?: string) {
    const userId = await this.access.requireUser(authorization);
    return this.logs.draftFromText(userId, parseBody(interpretFoodTextRequestSchema, raw));
  }

  @Post('logs/photo')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Identifica os alimentos de uma foto em rascunho' })
  async photo(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('meal') meal?: string,
    @Headers('authorization') authorization?: string,
  ) {
    const userId = await this.access.requireUser(authorization);
    return this.logs.draftFromPhoto(userId, imageForVision(file), {
      meal: meal ? mealSlotSchema.parse(meal) : undefined,
    });
  }

  @Put('logs/:id/confirm')
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Confirma (e corrige) o rascunho: só então a refeição conta' })
  async confirm(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    const userId = await this.access.requireUser(authorization);
    await this.logs.confirm(
      userId,
      uuidSchema.parse(id),
      parseBody(confirmFoodLogRequestSchema, raw),
    );
  }

  @Post('logs')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Registra uma refeição já com os itens' })
  async manual(@Body() raw: unknown, @Headers('authorization') authorization?: string) {
    const userId = await this.access.requireUser(authorization);
    return this.logs.addManual(userId, parseBody(manualFoodLogRequestSchema, raw));
  }

  @Delete('logs/:id')
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Remove uma refeição registrada' })
  async remove(@Param('id') id: string, @Headers('authorization') authorization?: string) {
    const userId = await this.access.requireUser(authorization);
    await this.logs.remove(userId, uuidSchema.parse(id));
  }
}
