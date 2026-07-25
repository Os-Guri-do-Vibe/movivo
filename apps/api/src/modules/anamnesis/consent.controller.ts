/**
 * Endpoint público de consentimento da anamnese (US-1.2 / TASK-1.2.3).
 *
 * Fica no fluxo **não autenticado**: a tela-ponte (Sofia §9.4) roda antes do
 * Bloco 2, quando o usuário ainda não existe. A autorização é o próprio token
 * opaco da sessão — por isso o token vai na URL e o corpo nunca carrega
 * `userId`/`sessionId` (IDOR, Sato §8.1).
 */
import {
  Body,
  Controller,
  Ip,
  Param,
  Post,
  Headers,
  Header,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { recordConsentsSchema } from '@movivo/shared';

import { ConsentService } from './consent.service';

@Controller('anamnesis/session/:token/consents')
@UseGuards(ThrottlerGuard)
export class ConsentController {
  constructor(private readonly consents: ConsentService) {}

  /**
   * Registra o lote de consentimentos exibido na tela-ponte.
   *
   * 204: a resposta não devolve nada de propósito — o cliente não precisa de
   * eco, e ecoar consentimento abriria uma superfície de enumeração.
   */
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Referrer-Policy', 'no-referrer')
  async record(
    @Param('token') token: string,
    @Body() body: unknown,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<void> {
    // Zod aqui (e não só o ValidationPipe global): o contrato é o schema
    // compartilhado com o frontend — uma fonte, não duas.
    const { consents: inputs } = recordConsentsSchema.parse(body);

    await this.consents.recordForSessionToken(token, inputs, {
      ip: ip || null,
      userAgent: userAgent ?? null,
    });
  }
}
