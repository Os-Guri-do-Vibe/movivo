/**
 * Unit — corpus indexer (US-3.3): chunking com overlap e escrita dos chunks.
 */
import { describe, expect, it, vi } from 'vitest';

import type { DrizzleClient } from '../../../core/database/database.module';
import { chunkText, indexCorpus } from './corpus-indexer';
import { FakeEmbedding } from './embedding.port';

describe('chunkText', () => {
  it('texto curto vira 1 chunk', () => {
    expect(chunkText('curto')).toEqual(['curto']);
  });

  it('texto longo vira múltiplos chunks com overlap', () => {
    const text = 'x'.repeat(5000);
    const chunks = chunkText(text, 1000, 200);
    expect(chunks.length).toBeGreaterThan(1);
    // Passo = size - overlap = 800; total 5000 → cobre todo o texto.
    expect(chunks.join('').length).toBeGreaterThanOrEqual(text.length);
  });
});

describe('indexCorpus', () => {
  it('gera embeddings e grava os chunks, retornando a contagem', async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const db = { insert: vi.fn(() => ({ values })) } as unknown as DrizzleClient;

    const count = await indexCorpus(
      db,
      [{ title: 'T', topic: 'tp', content: 'descanso entre séries' }],
      new FakeEmbedding(),
    );

    expect(count).toBe(1);
    expect(values).toHaveBeenCalledOnce();
  });

  it('corpus vazio não escreve', async () => {
    const db = { insert: vi.fn() } as unknown as DrizzleClient;
    const count = await indexCorpus(db, [], new FakeEmbedding());
    expect(count).toBe(0);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
