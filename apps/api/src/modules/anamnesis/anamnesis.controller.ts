/**
 * Contratos REST da anamnese (US-1.3 / TASK-1.3.1 — Rafael §§1160-1163).
 *
 * Fluxo **não autenticado**: a autorização é o token opaco da sessão (na URL, path
 * param — nunca query string, Sato §8.1). Cada resposta leva `Referrer-Policy:
 * no-referrer` para o token não vazar no header `Referer` de navegação. O token no
 * path é redigido do log pela camada de logger (`redaction.util`).
 *
 * Rate limit `/anamnesis/*` = 60 req/min por IP (Rafael §1217) via `ThrottlerGuard`.
 * Validação de entrada por Zod compartilhado (`@movivo/shared`) — fonte única com o
 * frontend (US-1.6).
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
import { anamnesisBlockSchemas, startAnamnesisSchema } from '@movivo/shared';

import { AnamnesisService, type BlockNumber } from './anamnesis.service';

@Controller('anamnesis')
@UseGuards(ThrottlerGuard)
export class AnamnesisController {
  constructor(private readonly anamnesis: AnamnesisService) {}

  @Post('start')
  @Header('Referrer-Policy', 'no-referrer')
  async start(@Body() body: unknown) {
    const input = startAnamnesisSchema.parse(body ?? {});
    return this.anamnesis.start(input);
  }

  @Get('session/:token')
  @Header('Referrer-Policy', 'no-referrer')
  async get(@Param('token') token: string) {
    return this.anamnesis.getByToken(token);
  }

  @Patch('session/:token/block/:n')
  @Header('Referrer-Policy', 'no-referrer')
  async patch(@Param('token') token: string, @Param('n') n: string, @Body() body: unknown) {
    const block = this.parseBlockNumber(n);
    const data = anamnesisBlockSchemas[block].parse(body);
    return this.anamnesis.patchBlock(token, block, data);
  }

  @Post('session/:token/submit')
  @HttpCode(HttpStatus.OK)
  @Header('Referrer-Policy', 'no-referrer')
  async submit(@Param('token') token: string) {
    return this.anamnesis.submit(token);
  }

  private parseBlockNumber(raw: string): BlockNumber {
    if (raw === '1' || raw === '2' || raw === '3') return Number(raw) as BlockNumber;
    throw new BadRequestException('Bloco inválido: use 1, 2 ou 3.');
  }
}
