/**
 * Porta de reranking (US-3.3). O cross-encoder real (`bge-reranker-v2-m3`, container CPU do
 * Henrique — Victor §4.3, sem sub-processor externo) pluga atrás desta porta; no dev/CI usamos
 * um reranker determinístico simples, sem infra.
 */
import { Injectable } from '@nestjs/common';

export interface RerankCandidate {
  chunkText: string;
  title: string;
  sourceUrl: string | null;
  /** Score do retrieval denso (cosseno), já calculado. */
  denseScore: number;
}

export interface RerankResult extends RerankCandidate {
  /** Score do reranker, normalizado 0-1. */
  score: number;
}

export interface RerankerPort {
  rerank(query: string, candidates: RerankCandidate[], topK: number): Promise<RerankResult[]>;
}

export const RERANKER_PORT = Symbol('MOVIVO_RERANKER_PORT');

function terms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9à-ÿ]+/)
      .filter((t) => t.length > 1),
  );
}

/**
 * Reranker fake: score por sobreposição de termos (Jaccard) entre query e trecho, ordena e
 * corta em topK. Determinístico, sem rede.
 *
 * ponytail: Jaccard, não cross-encoder — não captura relevância semântica fina. O real pluga
 * atrás desta porta. Ceiling reconhecido.
 */
@Injectable()
export class FakeReranker implements RerankerPort {
  rerank(query: string, candidates: RerankCandidate[], topK: number): Promise<RerankResult[]> {
    const q = terms(query);
    const scored = candidates.map((c) => {
      const d = terms(c.chunkText);
      const inter = [...q].filter((t) => d.has(t)).length;
      const union = new Set([...q, ...d]).size || 1;
      return { ...c, score: inter / union };
    });
    scored.sort((a, b) => b.score - a.score);
    return Promise.resolve(scored.slice(0, topK));
  }
}
