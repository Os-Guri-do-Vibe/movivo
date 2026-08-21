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
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { AppConfigService } from '../../../core/config';
import { DRIZZLE } from '../../../core/database/database.constants';
import type { DrizzleClient } from '../../../core/database/database.module';
import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../../core/redis';
import { RAG_USAGE_TTL_SECONDS, ragUsageDay, ragUsageKeys } from './rag-usage.keys';
import type { RagDoc, SemanticMemoryPort } from '../context/semantic-memory.port';
import { EMBEDDING_PORT, type EmbeddingPort } from './embedding.port';
import { RERANKER_PORT, type RerankCandidate, type RerankerPort } from './reranker.port';

interface DenseRow {
  id: string;
  document_id: string | null;
  chunk_text: string;
  title: string;
  source_url: string | null;
  score: number;
  document_version: number | null;
  document_sha256: string | null;
  publication_event_id: string | null;
}

@Injectable()
export class RagService implements SemanticMemoryPort {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleClient,
    @Inject(EMBEDDING_PORT) private readonly embedding: EmbeddingPort,
    @Inject(RERANKER_PORT) private readonly reranker: RerankerPort,
    private readonly config: AppConfigService,
    private readonly logger: PinoLogger,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
  ) {
    this.logger.setContext(RagService.name);
  }

  async retrieve(query: string): Promise<RagDoc[]> {
    const docs = await this.search(query);
    await this.countUsage(docs.length > 0);
    return docs;
  }

  /**
   * Telemetria de uso (TASK-7.5.3). Nunca derruba a resposta do coach: falha de
   * Redis vira log, e o painel prefere "indisponível" a um número inventado.
   */
  private async countUsage(useful: boolean): Promise<void> {
    try {
      const keys = ragUsageKeys(this.keys, ragUsageDay());
      const pipeline = this.redis.pipeline();
      pipeline.incr(keys.queries).expire(keys.queries, RAG_USAGE_TTL_SECONDS);
      if (useful) pipeline.incr(keys.useful).expire(keys.useful, RAG_USAGE_TTL_SECONDS);
      await pipeline.exec();
    } catch (error) {
      this.logger.warn({ err: error }, 'falha ao contabilizar uso do RAG');
    }
  }

  private async search(query: string): Promise<RagDoc[]> {
    const { minCosine, rerankMinScore, topK, candidates } = this.config.rag;
    const vec = await this.embedding.embed(query);
    const literal = `[${vec.join(',')}]`;

    // Hybrid search: dense HNSW + FTS português combinados por Reciprocal Rank Fusion.
    // Documento governado só é elegível quando seu ÚLTIMO evento é PUBLISHED; ARCHIVED
    // funciona como kill switch imediato sem apagar a trilha nem os vetores. Chunk sem
    // `document_id` é corpus-semente legado (`corpus-seed.ts`, fora do pipeline de
    // governança) e continua elegível — nunca passou a ter uma trilha de eventos.
    const rows = (await this.db.execute(sql`
      WITH eligible AS (
        SELECT chunk.id, chunk.document_id, chunk.chunk_text, chunk.title, chunk.source_url,
          chunk.embedding, document.version AS document_version,
          document.sha256 AS document_sha256, latest.id AS publication_event_id
        FROM knowledge_base chunk
        LEFT JOIN knowledge_documents document ON document.id = chunk.document_id
        LEFT JOIN LATERAL (
          SELECT event.id, event.status
          FROM knowledge_document_events event
          WHERE event.document_id = chunk.document_id
          ORDER BY event.sequence DESC, event.created_at DESC, event.id DESC LIMIT 1
        ) latest ON true
        WHERE chunk.document_id IS NULL
          OR latest.status = 'PUBLISHED'::knowledge_document_status
      ), dense AS (
        SELECT id, 1 - (embedding <=> ${literal}::vector) AS cosine,
          row_number() OVER (ORDER BY embedding <=> ${literal}::vector) AS rank
        FROM eligible
        WHERE 1 - (embedding <=> ${literal}::vector) > ${minCosine}
        ORDER BY embedding <=> ${literal}::vector
        LIMIT ${candidates}
      ), lexical AS (
        SELECT id,
          row_number() OVER (
            ORDER BY ts_rank_cd(
              to_tsvector('portuguese', chunk_text), plainto_tsquery('portuguese', ${query})
            ) DESC
          ) AS rank
        FROM eligible
        WHERE to_tsvector('portuguese', chunk_text) @@ plainto_tsquery('portuguese', ${query})
        LIMIT ${candidates}
      ), fused AS (
        SELECT COALESCE(dense.id, lexical.id) AS id, dense.cosine,
          COALESCE(1.0 / (60 + dense.rank), 0) + COALESCE(1.0 / (60 + lexical.rank), 0) AS rrf
        FROM dense FULL OUTER JOIN lexical ON lexical.id = dense.id
      )
      SELECT eligible.id, eligible.document_id, eligible.chunk_text, eligible.title,
        eligible.source_url, COALESCE(fused.cosine, 0)::float AS score,
        eligible.document_version, eligible.document_sha256, eligible.publication_event_id
      FROM fused JOIN eligible ON eligible.id = fused.id
      ORDER BY fused.rrf DESC
      LIMIT ${candidates}
    `)) as unknown as DenseRow[];

    // Fail-safe: nada relevante o bastante → sem RAG (não força alucinação).
    if (rows.length === 0) return [];

    const cands: RerankCandidate[] = rows.map((r) => ({
      chunkId: r.id,
      documentId: r.document_id,
      chunkText: r.chunk_text,
      title: r.title,
      sourceUrl: r.source_url,
      denseScore: Number(r.score),
    }));
    const reranked = await this.reranker.rerank(query, cands, topK);

    const provenance = new Map(rows.map((row) => [row.id, row]));
    return reranked
      .filter((r) => r.score >= rerankMinScore)
      .map((r) => {
        const source = provenance.get(r.chunkId);
        return {
          chunkId: r.chunkId,
          documentId: r.documentId,
          title: r.title,
          snippet: r.chunkText,
          sourceUrl: r.sourceUrl ?? undefined,
          score: r.score,
          ...(source?.document_version ? { documentVersion: Number(source.document_version) } : {}),
          ...(source?.document_sha256 ? { documentSha256: source.document_sha256 } : {}),
          ...(source?.publication_event_id
            ? { publicationEventId: source.publication_event_id }
            : {}),
        };
      });
  }
}
