/**
 * Unit — FakeReranker (US-3.3): ordena por sobreposição de termos, corta em topK.
 */
import { describe, expect, it } from 'vitest';

import {
  DenseScoreReranker,
  FakeReranker,
  HybridReranker,
  type RerankCandidate,
} from './reranker.port';

const reranker = new FakeReranker();

function cand(chunkText: string): RerankCandidate {
  return {
    chunkId: '00000000-0000-0000-0000-000000000001',
    documentId: null,
    chunkText,
    title: chunkText.slice(0, 10),
    sourceUrl: null,
    denseScore: 0.9,
  };
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

describe('DenseScoreReranker', () => {
  it('preserva o score semântico real e ordena pelo pgvector', async () => {
    const dense = new DenseScoreReranker();
    const weak = { ...cand('match lexical exato'), chunkId: 'weak', denseScore: 0.2 };
    const strong = { ...cand('sem termos em comum'), chunkId: 'strong', denseScore: 0.91 };

    await expect(dense.rerank('match lexical exato', [weak, strong], 1)).resolves.toEqual([
      expect.objectContaining({ chunkId: 'strong', score: 0.91 }),
    ]);
  });
});

describe('HybridReranker', () => {
  it('combina semântica, termos e autoridade em vez de ignorar sinais híbridos', async () => {
    const hybrid = new HybridReranker();
    const generic = { ...cand('texto genérico'), chunkId: 'generic', denseScore: 0.81 };
    const governed = {
      ...cand('descanso entre séries hipertrofia'),
      chunkId: 'governed',
      denseScore: 0.78,
      fusionScore: 1,
      reliability: 5,
      category: 'METHODOLOGY',
    };
    const [first] = await hybrid.rerank('descanso entre séries', [generic, governed], 2);
    expect(first?.chunkId).toBe('governed');
  });

  it('preserva correspondência lexical exata quando o embedding não recupera o trecho', async () => {
    const [result] = await new HybridReranker().rerank(
      'descanso hipertrofia',
      [
        {
          chunkId: 'lexical-only',
          documentId: 'd1',
          chunkText: 'Descanso para hipertrofia conforme a metodologia.',
          title: 'Método',
          sourceUrl: null,
          denseScore: 0,
          fusionScore: 0.51,
          reliability: 5,
          category: 'METHODOLOGY',
        },
      ],
      1,
    );

    expect(result?.score).toBeGreaterThan(0.5);
  });
});
