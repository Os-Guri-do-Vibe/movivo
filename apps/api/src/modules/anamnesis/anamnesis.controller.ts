/**
 * Contratos REST do onboarding v2 (Sprint 6 — substitui os da anamnese v1).
 *
 * Fluxo **não autenticado**: a autorização é o token opaco da sessão (na URL, path
 * param — nunca query string, Sato §8.1). Cada resposta leva `Referrer-Policy:
 * no-referrer` para o token não vazar no header `Referer` de navegação. O token no
 * path é redigido do log pela camada de logger (`redaction.util`).
 *
 * Rate limit `/anamnesis/*` = 60 req/min por IP (Rafael §1217) via `ThrottlerGuard`;
 * os endpoints de código de verificação têm limites próprios **de negócio** no serviço
 * (por sessão e por número), porque limite por IP não protege quem troca de IP.
 *
 * Validação de entrada por Zod compartilhado (`@movivo/shared`) — fonte única com o
 * frontend. O `PATCH .../block/{n}` da v1 **não existe mais** (D1).
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
import { sendPhoneCodeSchema, startAnamnesisSchema, verifyPhoneCodeSchema } from '@movivo/shared';

import { AnamnesisService, type StepNumber } from './anamnesis.service';

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

  /** Salvamento de progresso por ETAPA (1..3). O schema de cada etapa é aplicado no serviço. */
  @Patch('session/:token/step/:n')
  @Header('Referrer-Policy', 'no-referrer')
  async patchStep(@Param('token') token: string, @Param('n') n: string, @Body() body: unknown) {
    return this.anamnesis.patchStep(token, this.parseStepNumber(n), body);
  }

  /**
   * Envia o código de verificação pelo WhatsApp. Resposta idêntica para envio novo e
   * para reenvio em cooldown (`sent: false`): a UI já mostra o contador, e diferenciar
   * dá ao atacante um sinal de estado que ele não precisa ter.
   */
  @Post('session/:token/phone/send-code')
  @HttpCode(HttpStatus.OK)
  @Header('Referrer-Policy', 'no-referrer')
  async sendPhoneCode(@Param('token') token: string, @Body() body: unknown) {
    const { phoneNumber } = sendPhoneCodeSchema.parse(body);
    return this.anamnesis.sendPhoneCode(token, phoneNumber);
  }

  @Post('session/:token/phone/verify')
  @HttpCode(HttpStatus.OK)
  @Header('Referrer-Policy', 'no-referrer')
  async verifyPhoneCode(@Param('token') token: string, @Body() body: unknown) {
    const { code } = verifyPhoneCodeSchema.parse(body);
    return this.anamnesis.verifyPhoneCode(token, code);
  }

  @Post('session/:token/submit')
  @HttpCode(HttpStatus.OK)
  @Header('Referrer-Policy', 'no-referrer')
  async submit(@Param('token') token: string) {
    return this.anamnesis.submit(token);
  }

  private parseStepNumber(raw: string): StepNumber {
    if (raw === '1' || raw === '2' || raw === '3') return Number(raw) as StepNumber;
    throw new BadRequestException('Etapa inválida: use 1, 2 ou 3.');
  }
}
