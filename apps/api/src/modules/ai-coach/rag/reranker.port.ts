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
  /** Score da fusão RRF denso+lexical, normalizado. */
  fusionScore?: number;
  reliability?: number;
  category?: string;
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
  const stopwords = new Set([
    'a',
    'as',
    'o',
    'os',
    'de',
    'da',
    'das',
    'do',
    'dos',
    'e',
    'em',
    'no',
    'na',
    'nos',
    'nas',
    'para',
    'por',
    'com',
    'um',
    'uma',
    'que',
    'qual',
    'quanto',
    'como',
    'meu',
    'minha',
  ]);
  return new Set(
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/gu, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !stopwords.has(t)),
  );
}

const AUTHORITY_WEIGHT: Readonly<Record<string, number>> = {
  SAFETY: 1,
  METHODOLOGY: 0.95,
  SCIENTIFIC_EVIDENCE: 0.85,
  EXERCISE_LIBRARY: 0.75,
  OTHER: 0.55,
};

/**
 * Reranker local de produção: preserva semântica, mas não descarta os sinais lexical,
 * governança e fusão. É determinístico e pode ser substituído pelo cross-encoder na mesma porta.
 */
@Injectable()
export class HybridReranker implements RerankerPort {
  rerank(query: string, candidates: RerankCandidate[], topK: number): Promise<RerankResult[]> {
    const queryTerms = terms(query);
    const scored = candidates.map((candidate) => {
      const bodyTerms = terms(`${candidate.title} ${candidate.chunkText}`);
      const overlap = [...queryTerms].filter((term) => bodyTerms.has(term)).length;
      const coverage = overlap / Math.max(1, queryTerms.size);
      const authority = AUTHORITY_WEIGHT[candidate.category ?? 'OTHER'] ?? 0.5;
      const reliability = Math.max(0, Math.min(1, (candidate.reliability ?? 3) / 5));
      const score =
        Math.max(0, Math.min(1, candidate.denseScore)) * 0.35 +
        Math.max(0, Math.min(1, candidate.fusionScore ?? candidate.denseScore)) * 0.25 +
        coverage * 0.25 +
        authority * reliability * 0.15;
      return { ...candidate, score: Math.max(0, Math.min(1, score)) };
    });
    scored.sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));
    return Promise.resolve(scored.slice(0, topK));
  }
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
