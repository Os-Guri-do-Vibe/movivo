import { describe, expect, it } from 'vitest';

import { NoopSemanticMemory } from './semantic-memory.port';

describe('NoopSemanticMemory', () => {
  it('nunca recupera nada até a US-3.3 plugar o RAG real (fail-safe)', async () => {
    expect(await new NoopSemanticMemory().retrieve()).toEqual([]);
  });
});
