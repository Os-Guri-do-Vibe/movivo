/**
 * Porta de reranking (US-3.3). O cross-encoder real (`bge-reranker-v2-m3`, container CPU do
 * Henrique — Victor §4.3, sem sub-processor externo) pluga atrás desta porta; no dev/CI usamos
 * um reranker determinístico simples, sem infra.
 */
import { Injectable } from '@nestjs/common';

export interface RerankCandidate {
  chunkId: string;
  documentId: string | null;
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

/**
 * Runtime seguro enquanto o cross-encoder self-hosted não está disponível: preserva a
 * relevância semântica real calculada pelo pgvector, sem substituir o score por heurística
 * lexical. O threshold continua centralizado na configuração do RAG.
 */
@Injectable()
export class DenseScoreReranker implements RerankerPort {
  rerank(_query: string, candidates: RerankCandidate[], topK: number): Promise<RerankResult[]> {
    return Promise.resolve(
      candidates
        .map((candidate) => ({
          ...candidate,
          score: Math.max(0, Math.min(1, candidate.denseScore)),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK),
    );
  }
}

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
