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
import { Controller, Get, Header, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { uuidSchema, type ProtocolRead } from '@movivo/shared';

import { ProtocolRepository } from './protocol.repository';

@Controller('protocols')
@UseGuards(ThrottlerGuard)
export class ProtocolController {
  constructor(private readonly protocols: ProtocolRepository) {}

  @Get('by-token/:token')
  @Header('Referrer-Policy', 'no-referrer')
  async byToken(@Param('token') token: string): Promise<ProtocolRead> {
    if (!uuidSchema.safeParse(token).success) throw new NotFoundException();
    const protocol = await this.protocols.findByToken(token);
    if (!protocol) throw new NotFoundException();
    return protocol;
  }
}
