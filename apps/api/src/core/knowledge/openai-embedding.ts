import { EMBEDDING_DIMENSIONS } from '../database/schema/vector';
import type { EmbeddingPort } from './embedding.port';

const OPENAI_EMBEDDING_URL = 'https://api.openai.com/v1/embeddings';
const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';

interface OpenAiEmbeddingResponse {
  data?: Array<{ index?: number; embedding?: number[] }>;
}

/** Embedding real da base/RAG. O fake permanece restrito a teste ou desenvolvimento sem chave. */
export class OpenAiEmbedding implements EmbeddingPort {
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number,
  ) {}

  embed(text: string): Promise<number[]> {
    return this.embedBatch([text]).then((vectors) => {
      const vector = vectors[0];
      if (!vector) throw new Error('Provider de embedding devolveu resposta vazia.');
      return vector;
    });
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    let response: Response;
    try {
      response = await fetch(OPENAI_EMBEDDING_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: OPENAI_EMBEDDING_MODEL,
          input: texts,
          encoding_format: 'float',
          dimensions: EMBEDDING_DIMENSIONS,
        }),
      });
    } catch (cause) {
      throw new Error('Provider de embedding indisponível.', { cause });
    }

    if (!response.ok) {
      throw new Error(`Provider de embedding recusou a requisição (${response.status}).`);
    }

    const payload = (await response.json()) as OpenAiEmbeddingResponse;
    const ordered = [...(payload.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (ordered.length !== texts.length) {
      throw new Error('Provider de embedding devolveu lote incompleto.');
    }

    return ordered.map(({ embedding }) => {
      if (
        !embedding ||
        embedding.length !== EMBEDDING_DIMENSIONS ||
        embedding.some((value) => !Number.isFinite(value))
      ) {
        throw new Error('Provider de embedding devolveu vetor inválido.');
      }
      return embedding;
    });
  }
}
