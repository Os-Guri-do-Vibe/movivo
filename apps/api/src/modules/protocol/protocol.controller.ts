/**
 * Endpoint público read-only do protocolo por token (US-2.6 / TASK-2.6.1).
 *
 * Mesmo padrão de acesso não-autenticado da anamnese (ADR-006): o `token` é credencial
 * e vai no PATH (nunca query string, Sato §8.1); cada resposta leva `Referrer-Policy:
 * no-referrer` para o token não vazar no header `Referer`. Rate limit por `ThrottlerGuard`.
 *
 * IDOR-safe: o `token` É o `protocolId` (UUID v4 não-enumerável). O cliente nunca manda
 * `user_id`; o repositório lê sob `runAsSystem`, só expõe protocolo `ACTIVE` e omite a
 * coluna de titular da projeção. Token não-UUID ou protocolo inexistente/não-ACTIVE →
 * 404 uniforme, sem vazar a existência do dado.
 */
import { Controller, Get, Header, NotFoundException, Param, Res, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiOperation, ApiParam, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { protocolReadSchema, uuidSchema, type ProtocolRead } from '@movivo/shared';

import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { ProtocolRepository } from './protocol.repository';

const TOKEN_PARAM = {
  name: 'token',
  description: 'UUID v4 do protocolo (não-enumerável) — é o próprio token de acesso, IDOR-safe.',
} as const;

@ApiTags('Protocolo')
@Controller('protocols')
@UseGuards(ThrottlerGuard)
export class ProtocolController {
  constructor(private readonly protocols: ProtocolRepository) {}

  @Get('by-token/:token')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'Lê o protocolo vigente por token (público)',
    description:
      'Endpoint não autenticado usado pela página read-only `/protocolo/[token]`. Só expõe protocolo com status `ACTIVE`; qualquer outro caso retorna 404 uniforme, sem vazar a existência do dado.',
  })
  @ApiParam(TOKEN_PARAM)
  @ApiResponse({
    status: 200,
    description: 'Conteúdo do protocolo, periodização e assinatura.',
    schema: zodSchemaToOpenApi(protocolReadSchema),
  })
  @ApiResponse({
    status: 404,
    description: 'Token não é UUID, protocolo inexistente ou não está `ACTIVE`.',
  })
  async byToken(@Param('token') token: string): Promise<ProtocolRead> {
    if (!uuidSchema.safeParse(token).success) throw new NotFoundException();
    const protocol = await this.protocols.findByToken(token);
    if (!protocol) throw new NotFoundException();
    return protocol;
  }

  /**
   * PDF do protocolo assinado, para o link de documento enviado pelo WhatsApp
   * (`WhatsappOutboundWorker`). Mesma fronteira IDOR-safe do endpoint acima.
   */
  @Get('by-token/:token/pdf')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOperation({
    summary: 'PDF assinado do protocolo (público)',
    description:
      'Usado pelo fallback de documento do WhatsApp quando o deep-link cai fora da janela de 24h. Mesma fronteira IDOR-safe do endpoint de leitura.',
  })
  @ApiParam(TOKEN_PARAM)
  @ApiProduces('application/pdf')
  @ApiResponse({ status: 200, description: 'Bytes do PDF (`Content-Disposition: inline`).' })
  @ApiResponse({
    status: 404,
    description: 'Token não é UUID ou PDF inexistente para o protocolo.',
  })
  async pdfByToken(@Param('token') token: string, @Res() res: Response): Promise<void> {
    if (!uuidSchema.safeParse(token).success) throw new NotFoundException();
    const pdf = await this.protocols.findPdfByToken(token);
    if (!pdf) throw new NotFoundException();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="protocolo-movivo.pdf"');
    res.send(pdf);
  }
}
