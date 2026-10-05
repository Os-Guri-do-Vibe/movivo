/** Leitura e PDF exigem credencial opaca revogável independente do ID do protocolo. */
import { Controller, Get, Header, NotFoundException, Param, Res, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiOperation, ApiParam, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { protocolReadSchema, type ProtocolRead } from '@movivo/shared';

import { zodSchemaToOpenApi } from '../../core/swagger/zod-openapi.util';
import { AccessLinkService } from '../../core/database/access-link.service';
import { ProtocolRepository } from './protocol.repository';

const TOKEN_PARAM = {
  name: 'token',
  description: 'Credencial opaca, expirável e revogável de leitura do protocolo.',
} as const;

@ApiTags('Protocolo')
@Controller('protocols')
@UseGuards(ThrottlerGuard)
export class ProtocolController {
  constructor(
    private readonly protocols: ProtocolRepository,
    private readonly accessLinks: AccessLinkService,
  ) {}

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
    description:
      'Token inválido, expirado ou revogado, protocolo inexistente ou não está `ACTIVE`.',
  })
  async byToken(@Param('token') token: string): Promise<ProtocolRead> {
    const verified = await this.accessLinks.verify(token, 'PROTOCOL');
    if (!verified) throw new NotFoundException();
    const protocol = await this.protocols.findById(verified.userId, verified.resourceId);
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
    description: 'Token inválido, expirado ou revogado ou PDF inexistente para o protocolo.',
  })
  async pdfByToken(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const verified = await this.accessLinks.verify(token, 'PROTOCOL');
    if (!verified) throw new NotFoundException();
    const pdf = await this.protocols.findPdfById(verified.userId, verified.resourceId);
    if (!pdf) throw new NotFoundException();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="protocolo-movivo.pdf"');
    res.send(pdf);
  }
}
