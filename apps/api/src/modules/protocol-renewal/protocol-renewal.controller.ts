/**
 * Contratos REST do formulário de troca de protocolo por fim de mesociclo.
 *
 * Mesmo racional de segurança de `AnamnesisController`: fluxo não autenticado, a
 * autorização é o token opaco da sessão (path param, nunca query string), toda resposta
 * leva `Referrer-Policy: no-referrer`. Diferente da anamnese, não há fase anônima — o
 * titular já existe desde a criação da sessão pelo `ProtocolRenewalScheduler`.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PROTOCOL_RENEWAL_STEP_SCHEMAS } from '@movivo/shared';

import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { ProtocolRenewalService, type RenewalStepNumber } from './protocol-renewal.service';

const TOKEN_PARAM = {
  name: 'token',
  description:
    'Token opaco da sessão de renovação (autorização do fluxo — o titular já existe, criado pelo ProtocolRenewalScheduler).',
} as const;

@ApiTags('Renovação de Protocolo')
@Controller('protocol-renewal')
@UseGuards(ThrottlerGuard)
export class ProtocolRenewalController {
  constructor(private readonly renewal: ProtocolRenewalService) {}

  @Get('session/:token')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Consulta o estado da sessão de renovação',
    description: 'Retorna o progresso salvo dos 5 blocos do formulário de fim de mesociclo.',
  })
  @ApiParam(TOKEN_PARAM)
  @ApiResponse({ status: 200, description: 'Estado atual da sessão de renovação.' })
  @ApiResponse({ status: 404, description: 'Token inexistente ou expirado.' })
  async get(@Param('token') token: string) {
    return this.renewal.getByToken(token);
  }

  @Patch('session/:token/step/:n')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Salva o progresso de um bloco (1 a 5)',
    description:
      'Bloco 1: desempenho/execução real. Bloco 2: fadiga e recuperação. Bloco 3: ' +
      'repescagem de PAR-Q (segurança, vai para o campo cifrado). Bloco 4: resultado ' +
      'percebido. Bloco 5: mudanças de contexto/logística. O corpo aceito varia por ' +
      'bloco — `oneOf` abaixo documenta as 5 variações.',
  })
  @ApiParam(TOKEN_PARAM)
  @ApiParam({
    name: 'n',
    enum: ['1', '2', '3', '4', '5'],
    description: 'Número do bloco do formulário.',
  })
  @ApiBody({
    schema: { oneOf: Object.values(PROTOCOL_RENEWAL_STEP_SCHEMAS).map(zodSchemaToOpenApi) },
  })
  @ApiResponse({ status: 200, description: 'Progresso do bloco salvo.' })
  @ApiResponse({
    status: 400,
    description: 'Bloco inválido (fora de 1..5) ou corpo fora do schema do bloco.',
  })
  @ApiResponse({ status: 404, description: 'Token inexistente ou expirado.' })
  async patchStep(@Param('token') token: string, @Param('n') n: string, @Body() body: unknown) {
    return this.renewal.patchStep(token, this.parseStepNumber(n), body);
  }

  @Post('session/:token/submit')
  @HttpCode(HttpStatus.OK)
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Envia o formulário de renovação',
    description:
      'Fecha a sessão e enfileira a geração do novo mesociclo, salvo se a repescagem de PAR-Q (Bloco 3) exigir revisão humana antes de gerar.',
  })
  @ApiParam(TOKEN_PARAM)
  @ApiResponse({ status: 200, description: 'Formulário enviado.' })
  @ApiResponse({ status: 400, description: 'Sessão incompleta (bloco faltante).' })
  @ApiResponse({ status: 404, description: 'Token inexistente ou expirado.' })
  async submit(@Param('token') token: string) {
    return this.renewal.submit(token);
  }

  private parseStepNumber(raw: string): RenewalStepNumber {
    if (raw === '1' || raw === '2' || raw === '3' || raw === '4' || raw === '5') {
      return Number(raw) as RenewalStepNumber;
    }
    throw new BadRequestException('Bloco inválido: use 1 a 5.');
  }
}
