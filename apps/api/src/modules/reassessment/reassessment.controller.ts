import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  NotFoundException,
  Delete,
  Param,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import 'multer';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';

import { cycleReassessmentAnswersSchema, photoAngleSchema, uuidSchema } from '@movivo/shared';

import { parseBody } from '../../core/validation/strict-input';
import { imageForVision } from '../nutrition/image-guard';
import { TrainingAccessService } from '../training/training-access.service';
import { ReassessmentPhotosService } from './reassessment-photos.service';
import { ReassessmentService } from './reassessment.service';

/** Reavaliação de fim de ciclo (mesma credencial de sessão do treino). */
@ApiTags('Reavaliação')
@Controller('reassessment')
@UseGuards(ThrottlerGuard)
export class ReassessmentController {
  constructor(
    private readonly access: TrainingAccessService,
    private readonly reassessments: ReassessmentService,
    private readonly photos: ReassessmentPhotosService,
  ) {}

  @Get('current')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Reavaliação de ciclo do aluno (aberta ou a última respondida)' })
  async current(@Headers('authorization') authorization?: string) {
    const userId = await this.access.requireUser(authorization);
    const current = await this.reassessments.current(userId);
    if (!current) throw new NotFoundException();
    return current;
  }

  @Post(':id/answers')
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Responde a reavaliação de ciclo' })
  async answer(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    const userId = await this.access.requireUser(authorization);
    await this.reassessments.submit(
      userId,
      uuidSchema.parse(id),
      parseBody(cycleReassessmentAnswersSchema, raw),
    );
  }

  @Put(':id/photos/:angle')
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Envia (ou substitui) a foto de uma posição da reavaliação' })
  async putPhoto(
    @Param('id') id: string,
    @Param('angle') angle: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Headers('authorization') authorization?: string,
  ) {
    const userId = await this.access.requireUser(authorization);
    imageForVision(file);
    await this.photos.put(
      userId,
      uuidSchema.parse(id),
      photoAngleSchema.parse(angle),
      file?.buffer ?? Buffer.alloc(0),
    );
  }

  @Delete(':id/photos/:angle')
  @HttpCode(204)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Remove a foto de uma posição da reavaliação' })
  async deletePhoto(
    @Param('id') id: string,
    @Param('angle') angle: string,
    @Headers('authorization') authorization?: string,
  ) {
    const userId = await this.access.requireUser(authorization);
    await this.photos.remove(userId, uuidSchema.parse(id), photoAngleSchema.parse(angle));
  }
}
