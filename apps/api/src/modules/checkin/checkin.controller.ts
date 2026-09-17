/**
 * Contratos REST do formulário de check-in semanal (achado 2026-09-13).
 *
 * Mesmo racional de segurança de `ProtocolRenewalController`: fluxo não autenticado, a
 * autorização é o token opaco da sessão (path param, nunca query string), toda resposta
 * leva `Referrer-Policy: no-referrer`. Diferente da renovação, não há PATCH por etapa — o
 * formulário é enviado de uma vez (`submit`).
 */
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { checkinWeeklySessionViewSchema, checkinWeeklySubmitSchema } from '@movivo/shared';

import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { CheckinService } from './checkin.service';

const TOKEN_PARAM = {
  name: 'token',
  description: 'Token opaco da sessão de check-in semanal, enviado por WhatsApp.',
} as const;

@ApiTags('Check-in')
@Controller('checkin')
@UseGuards(ThrottlerGuard)
export class CheckinController {
  constructor(private readonly checkin: CheckinService) {}

  @Get('session/:token')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Consulta o estado da sessão de check-in',
    description:
      'Projeção pública — nunca inclui os campos de texto livre cifrados de envios anteriores.',
  })
  @ApiParam(TOKEN_PARAM)
  @ApiResponse({
    status: 200,
    description: 'Estado da sessão.',
    schema: zodSchemaToOpenApi(checkinWeeklySessionViewSchema),
  })
  @ApiResponse({ status: 404, description: 'Token inexistente ou expirado.' })
  async get(@Param('token') token: string) {
    return this.checkin.getByToken(token);
  }

  @Post('session/:token/submit')
  @HttpCode(HttpStatus.OK)
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Envia o check-in semanal',
    description:
      'Envio único (sem salvamento por etapa — formulário curto). Ajusta o protocolo vigente com base nas 8 respostas.',
  })
  @ApiParam(TOKEN_PARAM)
  @ApiBody({ schema: zodSchemaToOpenApi(checkinWeeklySubmitSchema) })
  @ApiResponse({ status: 200, description: 'Check-in registrado.' })
  @ApiResponse({ status: 400, description: 'Corpo fora do schema.' })
  @ApiResponse({ status: 404, description: 'Token inexistente, expirado ou já enviado.' })
  async submit(@Param('token') token: string, @Body() body: unknown) {
    return this.checkin.submit(token, body);
  }
}
