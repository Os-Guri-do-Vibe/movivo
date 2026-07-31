/**
 * RAGService — camada semantic do ContextService (US-3.3 / TASK-3.3.2).
 *
 * Fluxo: embedding da query → busca densa HNSW top-N (cosseno > threshold) → rerank (porta) →
 * top-K. **Fail-safe anti-alucinação**: nenhum chunk ≥ threshold → `[]` (sem RAG), e MOVI
 * reconhece o limite em vez de inventar. Lê `knowledge_base` via `movivo_app` (SELECT; corpus
 * global read-only, sem RLS por titular). Implementa `SemanticMemoryPort` — pluga no token
 * `SEMANTIC_MEMORY` do `AiCoachModule` no lugar do `NoopSemanticMemory` da US-3.2.
 */
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { AppConfigService } from '../../../core/config';
import { DRIZZLE } from '../../../core/database/database.constants';
import type { DrizzleClient } from '../../../core/database/database.module';
import type { RagDoc, SemanticMemoryPort } from '../context/semantic-memory.port';
import { EMBEDDING_PORT, type EmbeddingPort } from './embedding.port';
import { RERANKER_PORT, type RerankCandidate, type RerankerPort } from './reranker.port';

interface DenseRow {
  chunk_text: string;
  title: string;
  source_url: string | null;
  score: number;
}

@Injectable()
export class RagService implements SemanticMemoryPort {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleClient,
    @Inject(EMBEDDING_PORT) private readonly embedding: EmbeddingPort,
    @Inject(RERANKER_PORT) private readonly reranker: RerankerPort,
    private readonly config: AppConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RagService.name);
  }

  async retrieve(query: string): Promise<RagDoc[]> {
    const { minCosine, rerankMinScore, topK, candidates } = this.config.rag;
    const vec = await this.embedding.embed(query);
    const literal = `[${vec.join(',')}]`;

    // Busca densa HNSW: cosseno = 1 - distância. `::vector` casta o literal parametrizado.
    const rows = (await this.db.execute(sql`
      SELECT chunk_text, title, source_url, 1 - (embedding <=> ${literal}::vector) AS score
      FROM knowledge_base
      WHERE 1 - (embedding <=> ${literal}::vector) > ${minCosine}
      ORDER BY embedding <=> ${literal}::vector
      LIMIT ${candidates}
    `)) as unknown as DenseRow[];

    // Fail-safe: nada relevante o bastante → sem RAG (não força alucinação).
    if (rows.length === 0) return [];

    const cands: RerankCandidate[] = rows.map((r) => ({
      chunkText: r.chunk_text,
      title: r.title,
      sourceUrl: r.source_url,
      denseScore: Number(r.score),
    }));
    const reranked = await this.reranker.rerank(query, cands, topK);

    return reranked
      .filter((r) => r.score >= rerankMinScore)
      .map((r) => ({
        title: r.title,
        snippet: r.chunkText,
        sourceUrl: r.sourceUrl ?? undefined,
        score: r.score,
      }));
  }
}
