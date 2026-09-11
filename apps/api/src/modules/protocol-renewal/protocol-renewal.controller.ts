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

import { ProtocolRenewalService, type RenewalStepNumber } from './protocol-renewal.service';

@Controller('protocol-renewal')
@UseGuards(ThrottlerGuard)
export class ProtocolRenewalController {
  constructor(private readonly renewal: ProtocolRenewalService) {}

  @Get('session/:token')
  @Header('Referrer-Policy', 'no-referrer')
  async get(@Param('token') token: string) {
    return this.renewal.getByToken(token);
  }

  @Patch('session/:token/step/:n')
  @Header('Referrer-Policy', 'no-referrer')
  async patchStep(@Param('token') token: string, @Param('n') n: string, @Body() body: unknown) {
    return this.renewal.patchStep(token, this.parseStepNumber(n), body);
  }

  @Post('session/:token/submit')
  @HttpCode(HttpStatus.OK)
  @Header('Referrer-Policy', 'no-referrer')
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
