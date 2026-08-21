import { Global, Module } from '@nestjs/common';

import { AppConfigService } from '../config';
import { EMBEDDING_PORT, FakeEmbedding } from './embedding.port';
import { OpenAiEmbedding } from './openai-embedding';

@Global()
@Module({
  providers: [
    {
      provide: EMBEDDING_PORT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const apiKey = config.llm.openaiApiKey;
        if (apiKey) return new OpenAiEmbedding(apiKey, config.llm.timeoutMs);
        if (config.isProduction) {
          throw new Error('OPENAI_API_KEY é obrigatória para embeddings em produção.');
        }
        return new FakeEmbedding();
      },
    },
  ],
  exports: [EMBEDDING_PORT],
})
export class KnowledgeModule {}
