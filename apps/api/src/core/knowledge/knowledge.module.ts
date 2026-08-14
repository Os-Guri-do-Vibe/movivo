import { Global, Module } from '@nestjs/common';

import { EMBEDDING_PORT, FakeEmbedding } from './embedding.port';

@Global()
@Module({
  providers: [{ provide: EMBEDDING_PORT, useClass: FakeEmbedding }],
  exports: [EMBEDDING_PORT],
})
export class KnowledgeModule {}
