import { afterEach, describe, expect, it, vi } from 'vitest';

import { EMBEDDING_DIMENSIONS } from '../database/schema/vector';
import { OpenAiEmbedding } from './openai-embedding';

afterEach(() => vi.unstubAllGlobals());

describe('OpenAiEmbedding', () => {
  it('usa o modelo/dimensão aprovados e preserva a ordem do lote', async () => {
    const second = new Array<number>(EMBEDDING_DIMENSIONS).fill(0.2);
    const first = new Array<number>(EMBEDDING_DIMENSIONS).fill(0.1);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: second },
            { index: 0, embedding: first },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAiEmbedding('secret', 1000);
    await expect(provider.embedBatch(['primeiro', 'segundo'])).resolves.toEqual([first, second]);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toMatchObject({ authorization: 'Bearer secret' });
    expect(JSON.parse(String(request.body))).toMatchObject({
      model: 'text-embedding-3-small',
      dimensions: EMBEDDING_DIMENSIONS,
      input: ['primeiro', 'segundo'],
    });
  });

  it('rejeita lote incompleto ou vetor fora da dimensão', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ index: 0, embedding: [0.1] }] }), {
          status: 200,
        }),
      ),
    );

    await expect(new OpenAiEmbedding('secret', 1000).embed('texto')).rejects.toThrow(
      'vetor inválido',
    );
  });
});
