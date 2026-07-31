/**
 * Unit — FakeEmbedding (US-3.3): determinístico, normalizado, e cosseno reflete sobreposição.
 */
import { describe, expect, it } from 'vitest';

import { EMBEDDING_DIMENSIONS } from '../../../core/database/schema/knowledge-base';
import { FakeEmbedding } from './embedding.port';

const embed = new FakeEmbedding();

function cosine(a: number[], b: number[]): number {
  return a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0);
}

describe('FakeEmbedding', () => {
  it('gera vetor da dimensão certa e L2-normalizado', async () => {
    const v = await embed.embed('descanso entre séries');
    expect(v).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(cosine(v, v)).toBeCloseTo(1, 5);
  });

  it('é determinístico', async () => {
    expect(await embed.embed('hipertrofia')).toEqual(await embed.embed('hipertrofia'));
  });

  it('cosseno maior para textos com sobreposição de termos', async () => {
    const q = await embed.embed('descanso entre séries');
    const relevant = await embed.embed('descanso entre séries para hipertrofia');
    const other = await embed.embed('bicicleta ergométrica cardio');
    expect(cosine(q, relevant)).toBeGreaterThan(cosine(q, other));
  });

  it('embedBatch mapeia cada texto', async () => {
    const vs = await embed.embedBatch(['a bb', 'c dd']);
    expect(vs).toHaveLength(2);
  });
});
