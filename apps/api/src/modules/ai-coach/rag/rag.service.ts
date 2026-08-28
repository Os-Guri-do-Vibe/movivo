/**
 * Recuperação adaptativa e governada da Base de Conhecimento.
 *
 * Consulta simples → uma busca híbrida; consulta composta → busca por subconsulta, fusão e
 * diversidade. Só o último evento PUBLISHED é elegível. O resultado carrega proveniência e
 * autoridade para o gate de suficiência e para a verificação de afirmações.
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
import type {
  RagDoc,
  SemanticMemoryPort,
  SemanticRetrievalOptions,
} from '../context/semantic-memory.port';
import { EMBEDDING_PORT, type EmbeddingPort } from './embedding.port';
import { RERANKER_PORT, type RerankCandidate, type RerankerPort } from './reranker.port';
import { buildRetrievalPlan } from './retrieval-plan';

interface RetrievalRow {
  id: string;
  document_id: string | null;
  chunk_text: string;
  title: string;
  source_url: string | null;
  score: number;
  fusion_score?: number;
  document_version: number | null;
  document_sha256: string | null;
  publication_event_id: string | null;
  category?: RagDoc['category'];
  reliability?: number;
  topic?: string;
}

interface MergedRow extends RetrievalRow {
  queryHits: number;
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

  async retrieve(query: string, options?: SemanticRetrievalOptions): Promise<RagDoc[]> {
    const plan = buildRetrievalPlan(query);
    const batches = await Promise.all(
      plan.queries.map((plannedQuery) => this.search(plannedQuery)),
    );
    const merged = this.mergeRows(batches);
    const docs = await this.rerank(query, merged, plan.mode, options?.topK);
    await this.countUsage(docs.length > 0);
    this.logger.info(
      {
        event: 'rag_retrieval_completed',
        mode: plan.mode,
        queryCount: plan.queries.length,
        candidateCount: merged.length,
        resultCount: docs.length,
      },
      'recuperação adaptativa concluída',
    );
    return docs;
  }

  private mergeRows(batches: readonly RetrievalRow[][]): MergedRow[] {
    const merged = new Map<string, MergedRow>();
    for (const batch of batches) {
      for (const row of batch) {
        const current = merged.get(row.id);
        if (!current) {
          merged.set(row.id, { ...row, queryHits: 1 });
          continue;
        }
        current.queryHits += 1;
        current.score = Math.max(Number(current.score), Number(row.score));
        current.fusion_score = Math.max(
          Number(current.fusion_score ?? 0),
          Number(row.fusion_score ?? 0),
        );
      }
    }
    return [...merged.values()];
  }

  private async rerank(
    query: string,
    rows: readonly MergedRow[],
    retrievalMode: RagDoc['retrievalMode'],
    requestedTopK?: number,
  ): Promise<RagDoc[]> {
    if (rows.length === 0) return [];
    const { rerankMinScore, topK: defaultTopK, candidates } = this.config.rag;
    const topK = Math.max(1, Math.min(requestedTopK ?? defaultTopK, candidates));
    const cands: RerankCandidate[] = rows.map((row) => ({
      chunkId: row.id,
      documentId: row.document_id,
      chunkText: row.chunk_text,
      title: row.title,
      sourceUrl: row.source_url,
      denseScore: Number(row.score),
      fusionScore: Math.min(
        1,
        Number(row.fusion_score ?? row.score) + Math.max(0, row.queryHits - 1) * 0.05,
      ),
      reliability: Number(row.reliability ?? 3),
      category: row.category ?? 'OTHER',
    }));
    const reranked = await this.reranker.rerank(query, cands, candidates);
    const provenance = new Map(rows.map((row) => [row.id, row]));
    const diverse = this.selectDiverse(
      reranked.filter((result) => result.score >= rerankMinScore),
      topK,
    );

    return diverse.map((result) => {
      const source = provenance.get(result.chunkId);
      return {
        chunkId: result.chunkId,
        documentId: result.documentId,
        title: result.title,
        snippet: result.chunkText,
        sourceUrl: result.sourceUrl ?? undefined,
        score: result.score,
        category: source?.category ?? 'OTHER',
        reliability: Number(source?.reliability ?? 3),
        topic: source?.topic,
        retrievalMode,
        ...(source?.document_version ? { documentVersion: Number(source.document_version) } : {}),
        ...(source?.document_sha256 ? { documentSha256: source.document_sha256 } : {}),
        ...(source?.publication_event_id
          ? { publicationEventId: source.publication_event_id }
          : {}),
      };
    });
  }

  /** Evita top-K composto por cópias quase idênticas do mesmo documento. */
  private selectDiverse<T extends RerankCandidate>(rows: readonly T[], topK: number): T[] {
    const selected: T[] = [];
    const perDocument = new Map<string, number>();
    const seen = new Set<string>();
    for (const row of rows) {
      const document = row.documentId ?? `legacy:${row.chunkId}`;
      if ((perDocument.get(document) ?? 0) >= 2) continue;
      const fingerprint = row.chunkText.toLowerCase().replace(/\s+/gu, ' ').slice(0, 180);
      if (seen.has(fingerprint)) continue;
      selected.push(row);
      seen.add(fingerprint);
      perDocument.set(document, (perDocument.get(document) ?? 0) + 1);
      if (selected.length === topK) break;
    }
    return selected;
  }

  private async search(query: string): Promise<RetrievalRow[]> {
    const { minCosine, candidates } = this.config.rag;
    const vec = await this.embedding.embed(query);
    const literal = `[${vec.join(',')}]`;

    return (await this.db.execute(sql`
      WITH eligible AS (
        SELECT chunk.id, chunk.document_id, chunk.chunk_text, chunk.title, chunk.source_url,
          chunk.embedding, chunk.reliability, chunk.topic, document.category,
          document.version AS document_version, document.sha256 AS document_sha256,
          latest.id AS publication_event_id
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
            ORDER BY ts_rank_cd(to_tsvector('portuguese', chunk_text),
              plainto_tsquery('portuguese', ${query})) DESC
          ) AS rank
        FROM eligible
        WHERE to_tsvector('portuguese', chunk_text) @@ plainto_tsquery('portuguese', ${query})
        LIMIT ${candidates}
      ), fused AS (
        SELECT COALESCE(dense.id, lexical.id) AS id, dense.cosine,
          LEAST(1.0,
            31 * (COALESCE(1.0 / (60 + dense.rank), 0) +
                  COALESCE(1.0 / (60 + lexical.rank), 0))) AS fusion_score
        FROM dense FULL OUTER JOIN lexical ON lexical.id = dense.id
      )
      SELECT eligible.id, eligible.document_id, eligible.chunk_text, eligible.title,
        eligible.source_url, COALESCE(fused.cosine, 0)::float AS score,
        fused.fusion_score::float AS fusion_score, eligible.reliability, eligible.topic,
        eligible.category, eligible.document_version, eligible.document_sha256,
        eligible.publication_event_id
      FROM fused JOIN eligible ON eligible.id = fused.id
      ORDER BY fused.fusion_score DESC, fused.cosine DESC NULLS LAST
      LIMIT ${candidates}
    `)) as unknown as RetrievalRow[];
  }

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
}
