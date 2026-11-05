/** Leitura do plano exige credencial opaca revogável, independente de qualquer ID interno. */
import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { planReadSchema, type PlanRead } from '@movivo/shared';

import { AccessLinkService } from '../../core/database/access-link.service';
import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { PLAN_PDF_KINDS, type PlanPdfKind } from './plan-pdf';
import { nutritionPlanPdf, trainingPlanPdf } from './protocol-pdf';
import { PlanViewService } from './plan-view.service';

@ApiTags('Plano')
@Controller('plans')
@UseGuards(ThrottlerGuard)
export class PlanController {
  constructor(
    private readonly plans: PlanViewService,
    private readonly accessLinks: AccessLinkService,
  ) {}

  @Get('by-token/:token')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Lê o plano vigente do aluno por token (público)',
    description:
      'Endpoint não autenticado usado pela página `/plano/[token]`. Token inválido, expirado ou revogado, ou aluno sem plano ativo, retorna 404 uniforme.',
  })
  @ApiParam({ name: 'token', description: 'Credencial opaca, expirável e revogável.' })
  @ApiResponse({ status: 200, schema: zodSchemaToOpenApi(planReadSchema) })
  @ApiResponse({ status: 404, description: 'Token inválido ou sem plano ativo.' })
  async byToken(@Param('token') token: string): Promise<PlanRead> {
    const verified = await this.accessLinks.verify(token, 'PLAN');
    if (!verified) throw new NotFoundException();
    const plan = await this.plans.read(verified.userId);
    if (!plan) throw new NotFoundException();
    return plan;
  }

  @Get('by-token/:token/pdf/:kind')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'PDF do protocolo de treino ou alimentar por token (público)',
    description:
      'Gerado na hora a partir do plano vigente e nunca armazenado. Mesmo token da página do plano; 404 uniforme.',
  })
  @ApiParam({ name: 'kind', enum: Object.keys(PLAN_PDF_KINDS) })
  async pdf(@Param('token') token: string, @Param('kind') kind: string): Promise<StreamableFile> {
    if (!Object.hasOwn(PLAN_PDF_KINDS, kind)) throw new NotFoundException();
    const verified = await this.accessLinks.verify(token, 'PLAN');
    if (!verified) throw new NotFoundException();
    const plan = await this.plans.read(verified.userId);
    const training = PLAN_PDF_KINDS[kind as PlanPdfKind] === 'training';
    if (!plan || !(training ? plan.training : plan.nutrition)) throw new NotFoundException();
    const buffer = await (training ? trainingPlanPdf(plan) : nutritionPlanPdf(plan));
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `inline; filename="MOVIVO-protocolo-${kind}.pdf"`,
    });
  }
}
