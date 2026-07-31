/**
 * Unit — FakeReranker (US-3.3): ordena por sobreposição de termos, corta em topK.
 */
import { describe, expect, it } from 'vitest';

import { FakeReranker, type RerankCandidate } from './reranker.port';

const reranker = new FakeReranker();

function cand(chunkText: string): RerankCandidate {
  return { chunkText, title: chunkText.slice(0, 10), sourceUrl: null, denseScore: 0.9 };
}

describe('FakeReranker', () => {
  it('ordena o mais relevante primeiro e corta em topK', async () => {
    const out = await reranker.rerank(
      'descanso entre séries',
      [
        cand('bicicleta cardio leve'),
        cand('descanso entre séries hipertrofia'),
        cand('nada a ver'),
      ],
      2,
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.chunkText).toContain('descanso entre séries');
    expect(out[0]?.score).toBeGreaterThan(out[1]?.score ?? 1);
  });

  it('score fica em 0-1', async () => {
    const [r] = await reranker.rerank('descanso séries', [cand('descanso séries')], 1);
    expect(r?.score).toBeGreaterThan(0);
    expect(r?.score).toBeLessThanOrEqual(1);
  });

  it('lista vazia → []', async () => {
    expect(await reranker.rerank('x', [], 3)).toEqual([]);
  });
});
