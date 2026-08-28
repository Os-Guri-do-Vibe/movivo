import { describe, expect, it } from 'vitest';

import type { AppConfigService } from '../config';
import { FakeEmbedding } from './embedding.port';
import { createEmbedding } from './knowledge.module';
import { OpenAiEmbedding } from './openai-embedding';

function config(overrides: {
  production?: boolean;
  key?: string;
  approved?: boolean;
}): AppConfigService {
  return {
    isProduction: overrides.production ?? false,
    llm: {
      openaiApiKey: overrides.key,
      timeoutMs: 8000,
    },
    knowledge: {
      openaiEmbeddingHealthDataApproved: overrides.approved ?? false,
    },
  } as unknown as AppConfigService;
}

describe('createEmbedding — gate neutro de dados', () => {
  it('só libera o endpoint externo quando chave e aprovação HEALTH existem', () => {
    expect(createEmbedding(config({ key: 'sk-test', approved: true }))).toBeInstanceOf(
      OpenAiEmbedding,
    );
  });

  it('usa fake local em desenvolvimento se o endpoint não foi aprovado', () => {
    expect(createEmbedding(config({ key: 'sk-test', approved: false }))).toBeInstanceOf(
      FakeEmbedding,
    );
  });

  it('falha fechado em produção sem aprovação, mesmo que haja uma chave', () => {
    expect(() => createEmbedding(config({ production: true, key: 'sk-test' }))).toThrow(
      'KNOWLEDGE_OPENAI_EMBEDDING_HEALTH_DATA_APPROVED=true',
    );
  });
});
