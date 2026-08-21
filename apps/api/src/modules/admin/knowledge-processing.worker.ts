import { createHash } from 'node:crypto';

import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Job } from 'bullmq';
import { sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { TenantDatabase } from '../../core/database/tenant-database.service';
import { chunkText } from '../../core/knowledge/corpus-indexer';
import { EMBEDDING_PORT, type EmbeddingPort } from '../../core/knowledge/embedding.port';
import { QUEUE } from '../jobs/jobs.config';
import { WorkerFactory } from '../jobs/worker.factory';
import { knowledgeProcessingErrorCode, scanKnowledgeContent } from './knowledge-content-scanner';
import {
  appendKnowledgeEvent,
  currentKnowledgeState,
  lockKnowledgeDocument,
} from './knowledge-lifecycle';

export interface KnowledgeProcessingJob {
  documentId: string;
}

const PARSER_VERSION = 'plain-text-v1';
const EMBEDDING_MODEL = 'embedding-port-v1';

@Injectable()
export class KnowledgeProcessingWorker implements OnModuleInit {
  constructor(
    private readonly workers: WorkerFactory,
    private readonly db: TenantDatabase,
    @Inject(EMBEDDING_PORT) private readonly embedding: EmbeddingPort,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(KnowledgeProcessingWorker.name);
  }

  onModuleInit(): void {
    this.workers.create<KnowledgeProcessingJob>(QUEUE.knowledgeProcessing, (job) =>
      this.process(job),
    );
  }

  async process(job: Job<KnowledgeProcessingJob>): Promise<{ status: string; chunks?: number }> {
    try {
      return job.name === 'index' ? await this.index(job.data) : await this.ingest(job.data);
    } catch (error) {
      await this.recordFailure(
        job.data.documentId,
        job.name === 'index' ? 'INDEXING' : 'INGESTION',
        knowledgeProcessingErrorCode(error),
      );
      throw error;
    }
  }

  private async ingest(
    input: KnowledgeProcessingJob,
  ): Promise<{ status: string; chunks?: number }> {
    const loaded = await this.db.runAsSystem(async (tx) => {
      await lockKnowledgeDocument(tx, input.documentId);
      const state = await currentKnowledgeState(tx, input.documentId);
      if (!state) throw new Error('Documento sem evento inicial.');
      if (
        ['READY_FOR_REVIEW', 'APPROVED', 'INDEXING', 'PUBLISHED', 'REJECTED', 'ARCHIVED'].includes(
          state.status,
        )
      ) {
        return { terminal: state.status, row: null };
      }
      if (state.status === 'FAILED' && state.stage === 'INDEXING') {
        return { terminal: 'FAILED_INDEXING', row: null };
      }
      const rows = (await tx.execute(sql`
        SELECT document.mime_type, document.sha256, blob.payload
        FROM knowledge_documents document
        JOIN knowledge_document_blobs blob ON blob.document_id = document.id
        WHERE document.id = ${input.documentId}::uuid
      `)) as unknown as Array<{ mime_type: string; sha256: string; payload: Buffer }>;
      const row = rows[0];
      if (!row) throw new Error('Original de quarentena indisponível.');
      await appendKnowledgeEvent(tx, {
        documentId: input.documentId,
        status: 'PROCESSING',
        stage: 'INGESTION',
        note: 'Parsing e varredura iniciados.',
      });
      return { terminal: null, row };
    });
    if (!loaded.row) return { status: loaded.terminal ?? 'ALREADY_PROCESSED' };

    const content = loaded.row.payload.toString('utf8');
    scanKnowledgeContent(content);
    const contentSha256 = createHash('sha256').update(content).digest('hex');
    if (contentSha256 !== loaded.row.sha256) throw new Error('Hash do original não confere.');
    const chunks = chunkText(content);
    if (chunks.length === 0) throw new Error('Documento não gerou chunks.');

    await this.db.runAsSystem(async (tx) => {
      await lockKnowledgeDocument(tx, input.documentId);
      const state = await currentKnowledgeState(tx, input.documentId);
      if (state?.status === 'READY_FOR_REVIEW') return;
      if (state?.status !== 'PROCESSING') {
        throw new Error(`Estado inválido para staging: ${state?.status ?? 'ausente'}.`);
      }
      await tx.execute(sql`
        INSERT INTO knowledge_document_extractions (
          document_id, content, content_sha256, parser_version, detected_mime_type
        ) VALUES (
          ${input.documentId}::uuid, ${content}, ${contentSha256}, ${PARSER_VERSION},
          ${loaded.row.mime_type}
        ) ON CONFLICT (document_id) DO NOTHING
      `);
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const text = chunks[chunkIndex];
        if (!text) continue;
        const chunkSha256 = createHash('sha256').update(text).digest('hex');
        await tx.execute(sql`
          INSERT INTO knowledge_staged_chunks (
            document_id, chunk_index, chunk_text, chunk_sha256, extraction_sha256
          ) VALUES (
            ${input.documentId}::uuid, ${chunkIndex}, ${text}, ${chunkSha256}, ${contentSha256}
          ) ON CONFLICT (document_id, chunk_index) DO NOTHING
        `);
      }
      const verified = (await tx.execute(sql`
        SELECT count(*)::int AS count
        FROM knowledge_staged_chunks staged
        WHERE staged.document_id = ${input.documentId}::uuid
          AND staged.extraction_sha256 = ${contentSha256}
          AND encode(digest(convert_to(staged.chunk_text, 'UTF8'), 'sha256'), 'hex') = staged.chunk_sha256
      `)) as unknown as Array<{ count: number }>;
      if (Number(verified[0]?.count ?? 0) !== chunks.length) {
        throw new Error('Staging imutável divergiu do conteúdo extraído.');
      }
      await appendKnowledgeEvent(tx, {
        documentId: input.documentId,
        status: 'READY_FOR_REVIEW',
        stage: 'REVIEW',
        note: `${chunks.length} chunks prontos para revisão CREF.`,
      });
    });
    this.logger.info(
      { event: 'knowledge_ingestion_ready', documentId: input.documentId, chunks: chunks.length },
      'documento pronto para revisão',
    );
    return { status: 'READY_FOR_REVIEW', chunks: chunks.length };
  }

  private async index(input: KnowledgeProcessingJob): Promise<{ status: string; chunks?: number }> {
    const staged = await this.db.runAsSystem(async (tx) => {
      await lockKnowledgeDocument(tx, input.documentId);
      const state = await currentKnowledgeState(tx, input.documentId);
      if (state?.status === 'PUBLISHED') return [];
      const retryingIndex = state?.status === 'FAILED' && state.stage === 'INDEXING';
      if (state?.status !== 'APPROVED' && state?.status !== 'INDEXING' && !retryingIndex) {
        throw new Error(`Estado inválido para indexação: ${state?.status ?? 'ausente'}.`);
      }
      if (state.status !== 'INDEXING') {
        await appendKnowledgeEvent(tx, {
          documentId: input.documentId,
          status: 'INDEXING',
          stage: 'INDEXING',
          note: 'Cálculo de embeddings iniciado após aprovação CREF.',
        });
      }
      return (await tx.execute(sql`
        SELECT id, chunk_index, chunk_text, chunk_sha256
        FROM knowledge_staged_chunks
        WHERE document_id = ${input.documentId}::uuid
        ORDER BY chunk_index
      `)) as unknown as Array<{
        id: string;
        chunk_index: number;
        chunk_text: string;
        chunk_sha256: string;
      }>;
    });
    if (staged.length === 0) {
      const published = await this.db.runAsSystem((tx) =>
        currentKnowledgeState(tx, input.documentId),
      );
      if (published?.status === 'PUBLISHED') return { status: 'PUBLISHED' };
      throw new Error('Nenhum chunk canônico disponível para indexação.');
    }

    // Chamada externa/custosa deliberadamente fora da transação de aprovação/publicação.
    const vectors = await this.embedding.embedBatch(staged.map((chunk) => chunk.chunk_text));
    if (vectors.length !== staged.length || vectors.some((vector) => vector.length === 0)) {
      throw new Error('Provider de embedding devolveu lote incompleto.');
    }

    await this.db.runAsSystem(async (tx) => {
      await lockKnowledgeDocument(tx, input.documentId);
      const state = await currentKnowledgeState(tx, input.documentId);
      if (state?.status === 'PUBLISHED') return;
      if (state?.status !== 'INDEXING') throw new Error('Documento saiu do estado INDEXING.');
      for (let index = 0; index < staged.length; index++) {
        const chunk = staged[index];
        const vector = vectors[index];
        if (!chunk || !vector) throw new Error('Lote de embedding inconsistente.');
        const literal = `[${vector.join(',')}]`;
        await tx.execute(sql`
          INSERT INTO knowledge_chunk_embeddings (
            staged_chunk_id, chunk_sha256, embedding, model
          ) VALUES (
            ${chunk.id}::uuid, ${chunk.chunk_sha256}, ${literal}::vector, ${EMBEDDING_MODEL}
          ) ON CONFLICT (staged_chunk_id) DO NOTHING
        `);
      }
      const rows = (await tx.execute(
        sql`SELECT public.publish_knowledge_document(${input.documentId}::uuid) AS count`,
      )) as unknown as Array<{ count: number }>;
      if (Number(rows[0]?.count ?? 0) !== staged.length) {
        throw new Error('Publicação não confirmou todos os chunks canônicos.');
      }
      await appendKnowledgeEvent(tx, {
        documentId: input.documentId,
        status: 'PUBLISHED',
        stage: 'PUBLISHED',
        note: `${staged.length} chunks publicados com proveniência verificada.`,
      });
    });
    this.logger.info(
      {
        event: 'knowledge_document_published',
        documentId: input.documentId,
        chunks: staged.length,
      },
      'documento publicado',
    );
    return { status: 'PUBLISHED', chunks: staged.length };
  }

  private async recordFailure(documentId: string, stage: string, errorCode: string): Promise<void> {
    try {
      await this.db.runAsSystem(async (tx) => {
        await lockKnowledgeDocument(tx, documentId);
        const state = await currentKnowledgeState(tx, documentId);
        if (!state || ['PUBLISHED', 'REJECTED', 'ARCHIVED'].includes(state.status)) return;
        if (state.status === 'FAILED' && state.stage === stage && state.errorCode === errorCode)
          return;
        await appendKnowledgeEvent(tx, {
          documentId,
          status: 'FAILED',
          stage,
          errorCode,
          note: 'Processamento interrompido; detalhes técnicos permanecem nos logs estruturados.',
        });
      });
    } catch (recordError) {
      this.logger.error(
        { event: 'knowledge_failure_record_failed', documentId, err: recordError },
        'falha ao registrar estado FAILED',
      );
    }
  }
}
