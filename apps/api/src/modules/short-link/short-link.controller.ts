/**
 * Endpoint INTERNO de resolução do link curto — a API não é publicamente roteável (mesmo
 * motivo de `protocolo/[token]/pdf/route.ts`, que faz o mesmo proxy pro PDF). Quem o
 * navegador do aluno alcança é sempre uma rota do `apps/web` no domínio da marca
 * (`/check-in/[code]`, `/renovacao/[code]`), que chama este endpoint server-side e faz o
 * 302 de verdade. Sem guard de autenticação — é chamado antes de qualquer login existir
 * nesse fluxo (mesmo espírito de `WorkoutController#exchange`); `ThrottlerGuard` cobre o
 * único risco real (varredura de códigos).
 */
import { Controller, Get, GoneException, Param, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ShortLinkService } from './short-link.service';

const CODE_PATTERN = /^[A-Za-z0-9]{6,16}$/;

@ApiTags('Link Curto')
@Controller('short-links')
@UseGuards(ThrottlerGuard)
export class ShortLinkController {
  constructor(private readonly shortLinks: ShortLinkService) {}

  @Get(':code')
  @ApiOperation({
    summary: 'Resolve um código curto para a URL de destino (uso interno)',
    description:
      'Endpoint interno — não é roteável publicamente. Chamado server-side por rotas do `apps/web` (ex.: `/check-in/[code]`) que fazem o 302 real para o navegador do aluno.',
  })
  @ApiParam({ name: 'code', description: 'Código alfanumérico de 6 a 16 caracteres.' })
  @ApiResponse({ status: 200, description: 'URL de destino.' })
  @ApiResponse({ status: 410, description: 'Código inválido, inexistente ou expirado.' })
  async resolve(@Param('code') code: string): Promise<{ url: string }> {
    if (!CODE_PATTERN.test(code)) throw new GoneException('Link inválido ou expirado.');
    const target = await this.shortLinks.resolve(code);
    if (!target) throw new GoneException('Link inválido ou expirado.');
    return { url: target };
  }
}
