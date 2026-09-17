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
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { recordConsentsSchema } from '@movivo/shared';

import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { ConsentService } from './consent.service';

@ApiTags('Consentimento')
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
  @ApiOperation({
    summary: 'Registra o lote de consentimentos LGPD',
    description:
      'Exibido na tela-ponte, entre os Blocos 1 e 2, antes de o usuário existir como conta. Sem eco do que foi consentido na resposta, para não abrir superfície de enumeração.',
  })
  @ApiParam({ name: 'token', description: 'Token opaco da sessão de anamnese.' })
  @ApiBody({ schema: zodSchemaToOpenApi(recordConsentsSchema) })
  @ApiResponse({ status: 204, description: 'Consentimentos registrados — sem corpo de resposta.' })
  @ApiResponse({ status: 400, description: 'Corpo fora do schema.' })
  @ApiResponse({ status: 404, description: 'Token inexistente ou expirado.' })
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
