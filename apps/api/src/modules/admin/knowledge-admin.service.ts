import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  knowledgeDocumentActionSchema,
  reviewKnowledgeDocumentSchema,
  uploadKnowledgeDocumentSchema,
  type KnowledgeDocumentsResponse,
} from '@movivo/shared';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { AppConfigService } from '../../core/config';
import { knowledgeDocumentReviews, knowledgeDocuments } from '../../core/database/schema';
import type { TenantTransaction } from '../../core/database/tenant-database.service';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { QUEUE } from '../jobs/jobs.config';
import { QueueManager } from '../jobs/queue-manager.service';
import { AuditService } from './audit.service';
import {
  appendKnowledgeEvent,
  currentKnowledgeState,
  lockKnowledgeDocument,
} from './knowledge-lifecycle';

export { scanKnowledgeContent } from './knowledge-content-scanner';

const QUARANTINE_DAYS = 30;
const APPROVED_ORIGINAL_DAYS = 365;

const EXTENSION_MIME = new Map([
  ['.txt', 'text/plain'],
  ['.md', 'text/markdown'],
]);

interface KnowledgeListRow {
  id: string;
  title: string;
  topic: string;
  category: 'METHODOLOGY' | 'SCIENTIFIC_EVIDENCE' | 'EXERCISE_LIBRARY' | 'SAFETY' | 'OTHER';
  logical_key: string;
  version: number;
  source_url: string | null;
  author: string | null;
  license: string | null;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  created_at: Date;
  uploaded_by_name: string | null;
  status:
    | 'QUARANTINED'
    | 'PROCESSING'
    | 'READY_FOR_REVIEW'
    | 'APPROVED'
    | 'INDEXING'
    | 'PUBLISHED'
    | 'REJECTED'
    | 'FAILED'
    | 'ARCHIVED';
  stage: string;
  error_code: string | null;
  status_updated_at: Date;
  review_note: string | null;
  reviewer_name: string | null;
  reviewed_at: Date | null;
  retained_until: Date | null;
  blob_available: boolean;
  chunk_count: number;
}

function logicalKeyFor(title: string): string {
  const key = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return key || `documento-${createHash('sha256').update(title).digest('hex').slice(0, 12)}`;
}

function extensionOf(filename: string): string {
  const offset = filename.lastIndexOf('.');
  return offset < 0 ? '' : filename.slice(offset).toLowerCase();
}

@Injectable()
export class KnowledgeAdminService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly queues: QueueManager,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthenticatedUser): Promise<KnowledgeDocumentsResponse> {
    const rows = await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      const result = (await tx.execute(sql`
        SELECT document.id, document.title, document.topic, document.category,
          document.logical_key, document.version, document.source_url, document.author,
          document.license, document.original_filename, document.mime_type,
          document.size_bytes, document.sha256, document.created_at,
          uploader.name AS uploaded_by_name, latest.status, latest.stage,
          latest.error_code, latest.created_at AS status_updated_at,
          review.note AS review_note, reviewer.name AS reviewer_name,
          review.created_at AS reviewed_at, blob.retained_until,
          (blob.document_id IS NOT NULL) AS blob_available,
          count(chunk.id)::int AS chunk_count
        FROM knowledge_documents document
        JOIN LATERAL (
          SELECT event.status, event.stage, event.error_code, event.created_at
          FROM knowledge_document_events event
          WHERE event.document_id = document.id
          ORDER BY event.sequence DESC, event.created_at DESC, event.id DESC LIMIT 1
        ) latest ON true
        LEFT JOIN users uploader ON uploader.id = document.uploaded_by
        LEFT JOIN LATERAL (
          SELECT item.note, item.reviewer_id, item.created_at
          FROM knowledge_document_reviews item WHERE item.document_id = document.id
          ORDER BY item.created_at DESC, item.id DESC LIMIT 1
        ) review ON true
        LEFT JOIN users reviewer ON reviewer.id = review.reviewer_id
        LEFT JOIN knowledge_document_blobs blob ON blob.document_id = document.id
        LEFT JOIN knowledge_base chunk ON chunk.document_id = document.id
        GROUP BY document.id, uploader.name, latest.status, latest.stage,
          latest.error_code, latest.created_at, review.note, reviewer.name,
          review.created_at, blob.retained_until, blob.document_id
        ORDER BY document.created_at DESC
      `)) as unknown as KnowledgeListRow[];
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action: 'knowledge.list',
        entityType: 'knowledge_document',
        entityId: actor.userId,
        changes: { count: result.length },
      });
      return result;
    });

    return this.envelope({
      documents: rows.map((row) => ({
        id: row.id,
        title: row.title,
        topic: row.topic,
        category: row.category,
        logicalKey: row.logical_key,
        version: Number(row.version),
        sourceUrl: row.source_url,
        author: row.author,
        license: row.license,
        originalFilename: row.original_filename,
        mimeType: row.mime_type,
        sizeBytes: Number(row.size_bytes),
        sha256: row.sha256,
        status: row.status,
        stage: row.stage,
        errorCode: row.error_code,
        canRetry: row.status === 'FAILED',
        uploadedBy: row.uploaded_by_name,
        reviewer: row.reviewer_name,
        reviewNote: row.review_note,
        createdAt: new Date(row.created_at).toISOString(),
        reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
        retainedUntil: row.retained_until ? new Date(row.retained_until).toISOString() : null,
        blobAvailable: row.blob_available,
        chunkCount: Number(row.chunk_count),
        // Compatibilidade progressiva do dashboard durante a transição do contrato.
        processingStage: row.stage,
        processingError: row.error_code,
        statusUpdatedAt: new Date(row.status_updated_at).toISOString(),
      })),
      policy: {
        allowedTypes: [...this.config.knowledge.allowedMimeTypes],
        maxBytes: this.config.knowledge.uploadMaxBytes,
        quarantineDays: QUARANTINE_DAYS,
        approvedOriginalDays: APPROVED_ORIGINAL_DAYS,
      },
    });
  }

  async upload(actor: AuthenticatedUser, body: unknown): Promise<KnowledgeDocumentsResponse> {
    const parsed = uploadKnowledgeDocumentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_INPUT', issues: parsed.error.issues });
    }
    const input = parsed.data;
    if (this.config.knowledge.complexFormatsEnabled) {
      throw new ServiceUnavailableException('Formatos complexos ainda não foram homologados.');
    }
    if (/[/\\]/.test(input.originalFilename)) {
      throw new BadRequestException('O nome do arquivo não pode conter caminho.');
    }
    const extension = extensionOf(input.originalFilename);
    const expectedMime = EXTENSION_MIME.get(extension);
    if (!expectedMime || expectedMime !== input.mimeType) {
      throw new BadRequestException('Extensão e MIME devem corresponder a .txt ou .md.');
    }
    if (!this.config.knowledge.allowedMimeTypes.includes(input.mimeType)) {
      throw new BadRequestException('O MIME informado não está na allowlist ativa.');
    }

    const payload = Buffer.from(input.content, 'utf8');
    if (payload.byteLength > this.config.knowledge.uploadMaxBytes) {
      throw new BadRequestException('O arquivo excede o limite configurado.');
    }
    const sha256 = createHash('sha256').update(payload).digest('hex');
    const logicalKey = input.logicalKey ?? logicalKeyFor(input.title);

    let documentId: string;
    try {
      documentId = await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`knowledge-version:${logicalKey}`}, 0))`,
        );
        const versions = (await tx.execute(sql`
          SELECT COALESCE(max(version), 0)::int AS version
          FROM knowledge_documents WHERE logical_key = ${logicalKey}
        `)) as unknown as Array<{ version: number }>;
        const version = Number(versions[0]?.version ?? 0) + 1;
        const [document] = await tx
          .insert(knowledgeDocuments)
          .values({
            title: input.title,
            topic: input.topic,
            category: input.category,
            logicalKey,
            version,
            sourceUrl: input.sourceUrl ?? null,
            author: input.author ?? null,
            license: input.license ?? null,
            originalFilename: input.originalFilename,
            mimeType: input.mimeType,
            sizeBytes: payload.byteLength,
            sha256,
            uploadedBy: actor.userId,
          })
          .returning({ id: knowledgeDocuments.id });
        if (!document) throw new BadRequestException('Não foi possível criar o documento.');
        await tx.execute(sql`
          INSERT INTO knowledge_document_blobs (document_id, payload, retained_until)
          VALUES (${document.id}::uuid, ${payload}, now() + interval '30 days')
        `);
        await appendKnowledgeEvent(tx, {
          documentId: document.id,
          status: 'QUARANTINED',
          stage: 'QUEUE',
          actorId: actor.userId,
          note: 'Original validado por extensão, MIME e tamanho; aguardando processamento.',
        });
        await this.audit.append(tx, {
          actorId: actor.userId,
          userId: actor.userId,
          action: 'knowledge.upload',
          entityType: 'knowledge_document',
          entityId: document.id,
          changes: {
            sha256,
            sizeBytes: payload.byteLength,
            mimeType: input.mimeType,
            category: input.category,
            logicalKey,
            version,
          },
        });
        return document.id;
      });
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
        throw new ConflictException('Este arquivo ou versão já foi enviado.');
      }
      throw error;
    }

    try {
      await this.queues.enqueue(QUEUE.knowledgeProcessing, 'ingest', { documentId });
    } catch (_error) {
      await this.recordQueueFailure(documentId, 'INGESTION');
      throw new ServiceUnavailableException({
        code: 'KNOWLEDGE_QUEUE_UNAVAILABLE',
        message: 'Documento salvo em quarentena; use “Tentar novamente” quando a fila voltar.',
      });
    }
    return this.list(actor);
  }

  async content(actor: AuthenticatedUser, id: string) {
    const documentId = z.uuid().safeParse(id);
    if (!documentId.success) throw new BadRequestException('Identificador inválido.');
    return this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT extraction.content, blob.payload
        FROM knowledge_documents document
        LEFT JOIN knowledge_document_extractions extraction ON extraction.document_id = document.id
        LEFT JOIN knowledge_document_blobs blob ON blob.document_id = document.id
        WHERE document.id = ${id}::uuid
      `)) as unknown as Array<{ content: string | null; payload: Buffer | null }>;
      const row = rows[0];
      if (!row) throw new NotFoundException('Documento inexistente.');
      const content = row.content ?? row.payload?.toString('utf8');
      if (!content) throw new NotFoundException('O conteúdo não está mais disponível.');
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action: 'knowledge.content.view',
        entityType: 'knowledge_document',
        entityId: id,
        changes: {},
      });
      return this.envelope({ id, content });
    });
  }

  async review(actor: AuthenticatedUser, body: unknown): Promise<KnowledgeDocumentsResponse> {
    const parsed = reviewKnowledgeDocumentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_INPUT', issues: parsed.error.issues });
    }
    const input = parsed.data;
    await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      await lockKnowledgeDocument(tx, input.documentId);
      await this.assertRegulatedActionActor(tx, actor);
      const state = await currentKnowledgeState(tx, input.documentId);
      if (!state) throw new NotFoundException('Documento inexistente.');
      if (state.status !== 'READY_FOR_REVIEW') {
        throw new ConflictException('Somente documento pronto para revisão pode receber parecer.');
      }
      const extraction = (await tx.execute(sql`
        SELECT 1 FROM knowledge_document_extractions
        WHERE document_id = ${input.documentId}::uuid
      `)) as unknown as unknown[];
      if (!extraction.length) {
        throw new ConflictException('Extração canônica indisponível para revisão.');
      }
      const [review] = await tx
        .insert(knowledgeDocumentReviews)
        .values({
          documentId: input.documentId,
          decision: input.decision,
          note: input.note,
          reviewerId: actor.userId,
        })
        .returning({ id: knowledgeDocumentReviews.id });
      if (!review) throw new BadRequestException('Não foi possível registrar a revisão.');
      await appendKnowledgeEvent(tx, {
        documentId: input.documentId,
        status: input.decision,
        stage: input.decision === 'APPROVED' ? 'INDEXING' : 'REVIEW',
        actorId: actor.userId,
        note: input.note,
      });
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action: input.decision === 'APPROVED' ? 'knowledge.approve' : 'knowledge.reject',
        entityType: 'knowledge_document',
        entityId: input.documentId,
        changes: { reviewId: review.id, note: input.note },
      });
    });

    if (input.decision === 'APPROVED') {
      try {
        await this.queues.enqueue(QUEUE.knowledgeProcessing, 'index', {
          documentId: input.documentId,
        });
      } catch (_error) {
        await this.recordQueueFailure(input.documentId, 'INDEXING');
        throw new ServiceUnavailableException({
          code: 'KNOWLEDGE_QUEUE_UNAVAILABLE',
          message: 'Aprovação registrada; use “Tentar novamente” quando a fila voltar.',
        });
      }
    }
    return this.list(actor);
  }

  async retry(actor: AuthenticatedUser, id: string): Promise<KnowledgeDocumentsResponse> {
    const documentId = z.uuid().safeParse(id);
    if (!documentId.success) throw new BadRequestException('Identificador inválido.');
    const jobName = await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      await lockKnowledgeDocument(tx, id);
      const state = await currentKnowledgeState(tx, id);
      if (!state) throw new NotFoundException('Documento inexistente.');
      if (state.status !== 'FAILED') {
        throw new ConflictException('Somente processamento com falha pode ser repetido.');
      }
      const nextJob = state.stage === 'INDEXING' ? 'index' : 'ingest';
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action: 'knowledge.retry',
        entityType: 'knowledge_document',
        entityId: id,
        changes: { stage: state.stage, job: nextJob },
      });
      return nextJob;
    });
    try {
      await this.queues.enqueue(QUEUE.knowledgeProcessing, jobName, { documentId: id });
    } catch (_error) {
      throw new ServiceUnavailableException('A fila continua indisponível.');
    }
    return this.list(actor);
  }

  async archive(
    actor: AuthenticatedUser,
    id: string,
    body: unknown,
  ): Promise<KnowledgeDocumentsResponse> {
    const parsed = knowledgeDocumentActionSchema.safeParse({
      ...(typeof body === 'object' && body !== null ? body : {}),
      documentId: id,
    });
    if (!parsed.success) {
      throw new BadRequestException({ code: 'INVALID_INPUT', issues: parsed.error.issues });
    }
    const input = parsed.data;
    await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      await lockKnowledgeDocument(tx, input.documentId);
      await this.assertRegulatedActionActor(tx, actor);
      const state = await currentKnowledgeState(tx, input.documentId);
      if (!state) throw new NotFoundException('Documento inexistente.');
      if (state.status !== 'PUBLISHED') {
        throw new ConflictException('Somente documento publicado pode ser arquivado.');
      }
      await appendKnowledgeEvent(tx, {
        documentId: input.documentId,
        status: 'ARCHIVED',
        stage: 'ARCHIVED',
        actorId: actor.userId,
        note: input.note,
      });
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action: 'knowledge.archive',
        entityType: 'knowledge_document',
        entityId: input.documentId,
        changes: { note: input.note },
      });
    });
    return this.list(actor);
  }

  private async assertRegulatedActionActor(
    tx: TenantTransaction,
    actor: AuthenticatedUser,
  ): Promise<void> {
    if (actor.role === 'ADMIN') return;
    const rows = (await tx.execute(sql`
      SELECT 1 FROM users
      WHERE id = ${actor.userId}::uuid AND role = 'PROFESSIONAL' AND cref_active = true
    `)) as unknown as unknown[];
    if (!rows.length) throw new ConflictException('A ação exige profissional CREF ativo.');
  }

  private async recordQueueFailure(documentId: string, stage: string): Promise<void> {
    await this.db.runAsSystem(async (tx) => {
      await lockKnowledgeDocument(tx, documentId);
      const state = await currentKnowledgeState(tx, documentId);
      if (!state || ['PUBLISHED', 'REJECTED', 'ARCHIVED'].includes(state.status)) return;
      await appendKnowledgeEvent(tx, {
        documentId,
        status: 'FAILED',
        stage,
        errorCode: 'QUEUE_UNAVAILABLE',
        note: 'Documento preservado; processamento pode ser repetido de forma idempotente.',
      });
    });
  }

  private envelope<T>(data: T): KnowledgeDocumentsResponse {
    return {
      data,
      meta: {
        generatedAt: new Date().toISOString(),
        timezone: 'America/Sao_Paulo',
        dataQuality: [],
      },
    } as KnowledgeDocumentsResponse;
  }
}
