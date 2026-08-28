import { Global, Module } from '@nestjs/common';

import { AppConfigService } from '../config';
import { EMBEDDING_PORT, FakeEmbedding, type EmbeddingPort } from './embedding.port';
import { OpenAiEmbedding } from './openai-embedding';

/** O embedding também é transferência para um modelo e obedece ao mesmo gate de HEALTH. */
export function createEmbedding(config: AppConfigService): EmbeddingPort {
  const { openaiApiKey, timeoutMs } = config.llm;
  if (openaiApiKey && config.knowledge.openaiEmbeddingHealthDataApproved) {
    return new OpenAiEmbedding(openaiApiKey, timeoutMs);
  }
  if (config.isProduction) {
    throw new Error(
      'Embedding de produção exige OPENAI_API_KEY e ' +
        'KNOWLEDGE_OPENAI_EMBEDDING_HEALTH_DATA_APPROVED=true.',
    );
  }
  return new FakeEmbedding();
}

@Global()
@Module({
  providers: [
    {
      provide: EMBEDDING_PORT,
      inject: [AppConfigService],
      useFactory: createEmbedding,
    },
  ],
  exports: [EMBEDDING_PORT],
})
export class KnowledgeModule {}
