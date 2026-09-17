/**
 * `ShortLinkModule` — utilitário de encurtamento de URL, sem regra de negócio própria.
 * Importado por qualquer módulo de domínio que precise mandar um link com token por
 * WhatsApp (hoje: `WorkoutModule` e `ProtocolModule`) — não é uma dependência entre módulos
 * de domínio (regra §12.5), é infraestrutura compartilhada como `JobsModule`.
 */
import { Module } from '@nestjs/common';

import { ShortLinkController } from './short-link.controller';
import { ShortLinkService } from './short-link.service';

@Module({
  controllers: [ShortLinkController],
  providers: [ShortLinkService],
  exports: [ShortLinkService],
})
export class ShortLinkModule {}
