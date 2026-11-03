import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import {
  approveExceptionRequestSchema,
  closeExceptionRequestSchema,
  ControlCenterCapability as Capability,
  editProtocolRequestSchema,
  exceptionScopeSchema,
  exceptionStatusSchema,
  protocolAdjustmentRequestSchema,
  substituteForCaseRequestSchema,
} from '@movivo/shared';

import { parseBody } from '../../core/validation/strict-input';
import { RequireCapabilities } from '../auth/capabilities.decorator';
import { CapabilitiesGuard } from '../auth/capabilities.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUser } from '../auth/roles.decorator';
import { ExceptionsService } from './exceptions.service';

const listQuerySchema = z.object({
  status: exceptionStatusSchema.optional(),
  /** `QUEUE` = Fila do Profissional; `ALERTS` = Alertas. Sem o filtro, todos os casos. */
  scope: exceptionScopeSchema.optional(),
});
const amendParamsSchema = z.object({
  studentId: z.uuid(),
  kind: z.enum(['TRAINING', 'NUTRITION']),
});
const reviewHoldSchema = z.object({ active: z.boolean() }).strict();

@ApiTags('Admin · Fila de exceções')
@ApiBearerAuth('access-token')
@Controller('control-center/exceptions')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class ExceptionsController {
  constructor(private readonly exceptions: ExceptionsService) {}

  @Get()
  @RequireCapabilities(Capability.EXCEPTIONS_READ)
  @ApiOperation({ summary: 'Casos da fila, só do domínio do conselho do profissional' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    return this.exceptions.list(user, parseBody(listQuerySchema, query));
  }

  @Get('summary')
  @RequireCapabilities(Capability.EXCEPTIONS_READ)
  @ApiOperation({ summary: 'Quantos casos abertos (e urgentes) há para o profissional' })
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.exceptions.summary(user);
  }

  @Get(':id')
  @RequireCapabilities(Capability.EXCEPTIONS_READ, Capability.STUDENTS_READ)
  @ApiOperation({ summary: 'Caso com a proposta, a decisão e o Estado do Aluno' })
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.exceptions.detail(user, id);
  }

  @Get(':id/decisions')
  @RequireCapabilities(Capability.EXCEPTIONS_READ, Capability.STUDENTS_READ)
  @ApiOperation({ summary: 'Trilha de decisões do aluno do caso' })
  async decisions(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    const detail = await this.exceptions.detail(user, id);
    return this.exceptions.decisionsOf(detail.case.userId);
  }

  @Get(':id/protocol')
  @RequireCapabilities(Capability.EXCEPTIONS_READ, Capability.STUDENTS_READ)
  @ApiOperation({ summary: 'Protocolo em revisão (plano completo e prévia da primeira semana)' })
  protocol(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.exceptions.protocol(user, id);
  }

  @Get(':id/anamnesis')
  @RequireCapabilities(Capability.EXCEPTIONS_READ, Capability.STUDENTS_HEALTH_READ)
  @ApiOperation({ summary: 'Respostas da anamnese do aluno do caso (dado de saúde, auditado)' })
  anamnesis(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.exceptions.anamnesisOf(user, id);
  }

  @Get(':id/swap-options')
  @RequireCapabilities(Capability.EXCEPTIONS_READ, Capability.STUDENTS_READ)
  @ApiOperation({ summary: 'Exercícios seguros para a equipe escolher numa troca sem equivalente' })
  swapOptions(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.exceptions.swapOptions(user, id);
  }

  @Post(':id/substitute')
  @RequireCapabilities(Capability.EXCEPTIONS_RESOLVE)
  @ApiOperation({ summary: 'Aplica a troca escolhida pela equipe e envia o protocolo atualizado' })
  substitute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() raw: unknown,
  ) {
    const { toExerciseId } = parseBody(substituteForCaseRequestSchema, raw);
    return this.exceptions.substituteForCase(user, id, toExerciseId);
  }

  @Get(':id/exam-file')
  @RequireCapabilities(Capability.EXCEPTIONS_READ, Capability.STUDENTS_HEALTH_READ)
  @ApiOperation({ summary: 'Arquivo original do exame enviado pelo aluno (PDF ou foto)' })
  examFile(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.exceptions.examFile(user, id);
  }

  @Put(':id/protocol')
  @RequireCapabilities(Capability.EXCEPTIONS_RESOLVE)
  @ApiOperation({ summary: 'Edita à mão o protocolo em revisão (conferido antes de gravar)' })
  editProtocol(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() raw: unknown,
  ) {
    return this.exceptions.editProtocol(user, id, parseBody(editProtocolRequestSchema, raw));
  }

  @Post(':id/request-adjustment')
  @RequireCapabilities(Capability.EXCEPTIONS_RESOLVE)
  @ApiOperation({ summary: 'Pede aos agentes um novo protocolo com a orientação do profissional' })
  requestAdjustment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() raw: unknown,
  ) {
    const { instruction } = parseBody(protocolAdjustmentRequestSchema, raw);
    return this.exceptions.requestAdjustment(user, id, instruction);
  }

  @Post(':id/review-hold')
  @RequireCapabilities(Capability.EXCEPTIONS_RESOLVE)
  @ApiOperation({
    summary: 'Avisa que o protocolo está aberto (ou foi fechado) na tela de revisão',
    description:
      '`active: true` renova a trava enquanto a tela está aberta: se a janela de liberação automática vencer nesse intervalo, o envio espera. `active: false` solta a trava e libera na hora o protocolo que venceu. A trava expira sozinha em 2 min sem renovação.',
  })
  reviewHold(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() raw: unknown,
  ) {
    return this.exceptions.setReviewHold(user, id, parseBody(reviewHoldSchema, raw).active);
  }

  @Post(':id/claim')
  @RequireCapabilities(Capability.EXCEPTIONS_RESOLVE)
  @ApiOperation({ summary: 'Assume o caso' })
  claim(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.exceptions.claim(user, id);
  }

  @Post(':id/approve')
  @RequireCapabilities(Capability.EXCEPTIONS_RESOLVE)
  @ApiOperation({ summary: 'Aprova a proposta pendente e executa a mudança' })
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() raw: unknown,
  ) {
    return this.exceptions.approve(user, id, parseBody(approveExceptionRequestSchema, raw).note);
  }

  @Post(':id/reject')
  @RequireCapabilities(Capability.EXCEPTIONS_RESOLVE)
  @ApiOperation({ summary: 'Recusa a proposta pendente (nada muda no plano)' })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() raw: unknown,
  ) {
    return this.exceptions.reject(user, id, parseBody(closeExceptionRequestSchema, raw).note);
  }

  @Post(':id/resolve')
  @RequireCapabilities(Capability.EXCEPTIONS_RESOLVE)
  @ApiOperation({ summary: 'Encerra o caso (e o sinal de segurança, se o conselho puder)' })
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() raw: unknown,
  ) {
    return this.exceptions.resolve(user, id, parseBody(closeExceptionRequestSchema, raw).note);
  }
}

/** Emenda do protocolo que o aluno já está usando (fora de qualquer caso da fila). */
@ApiTags('Admin · Protocolo ativo')
@ApiBearerAuth('access-token')
@Controller('control-center/protocols')
@UseGuards(JwtAuthGuard, CapabilitiesGuard)
export class ProtocolAmendmentController {
  constructor(private readonly exceptions: ExceptionsService) {}

  @Get(':studentId/:kind')
  @RequireCapabilities(Capability.STUDENTS_READ, Capability.STUDENTS_HEALTH_READ)
  @ApiOperation({ summary: 'Protocolo ativo do aluno, aberto para emenda' })
  active(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown) {
    const { studentId, kind } = parseBody(amendParamsSchema, params);
    return this.exceptions.activeProtocol(user, studentId, kind);
  }

  @Put(':studentId/:kind')
  @RequireCapabilities(Capability.EXCEPTIONS_RESOLVE)
  @ApiOperation({
    summary: 'Emenda o protocolo ativo (conferido antes de gravar) e envia a versão nova ao aluno',
  })
  amend(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown, @Body() raw: unknown) {
    const { studentId, kind } = parseBody(amendParamsSchema, params);
    const request = parseBody(editProtocolRequestSchema, raw);
    if (request.kind !== kind) {
      throw new BadRequestException('A edição não corresponde ao tipo de protocolo da rota.');
    }
    return this.exceptions.amendProtocol(user, studentId, request);
  }
}
