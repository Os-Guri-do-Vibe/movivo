import { Module } from '@nestjs/common';

import { PUBLISHED_METHODOLOGY } from '../../core/agents/agent-context';
import { PublishedMethodologyReader } from './published-methodology.reader';

/**
 * Leitura da metodologia publicada para o contexto dos agentes. Separada do estúdio para não
 * depender da avaliação (a avaliação depende dela).
 */
@Module({
  providers: [
    PublishedMethodologyReader,
    { provide: PUBLISHED_METHODOLOGY, useExisting: PublishedMethodologyReader },
  ],
  exports: [PublishedMethodologyReader, PUBLISHED_METHODOLOGY],
})
export class PublishedMethodologyModule {}
