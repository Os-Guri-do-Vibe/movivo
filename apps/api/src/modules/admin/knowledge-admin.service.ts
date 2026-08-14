import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MAX_KNOWLEDGE_DOCUMENT_BYTES,
  reviewKnowledgeDocumentSchema,
  uploadKnowledgeDocumentSchema,
  type KnowledgeDocumentsResponse,
} from '@movivo/shared';
import { z } from 'zod';
import { sql } from 'drizzle-orm';

import { knowledgeDocumentReviews, knowledgeDocuments } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { prepareCorpus } from '../../core/knowledge/corpus-indexer';
import { EMBEDDING_PORT, type EmbeddingPort } from '../../core/knowledge/embedding.port';
import { detectInjection } from '../protocol/validation/prompt-injection';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { AuditService } from './audit.service';
import { Inject } from '@nestjs/common';

const QUARANTINE_DAYS = 30;
const APPROVED_ORIGINAL_DAYS = 365;
// ponytail: blob no Postgres e suficiente com teto de 512 KiB; acima desse volume, migrar
// para object storage privado com URL assinada, mantendo metadados/revisoes no banco.
const ALLOWED_EXTENSIONS = new Set(['.txt', '.md']);
const MARKUP_OR_SCRIPT = /<\/?(?:script|iframe|object|embed|html|body)\b|javascript:/i;
const PERSONAL_DATA =
  /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b|\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b(?:\+?55\s*)?\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4}\b/;

export function scanKnowledgeContent(content: string): void {
  // ponytail: allowlist apenas de texto torna a varredura deterministica; se PDF/DOCX entrar
  // no escopo, extrair em sandbox e adicionar antimalware antes de aceitar o arquivo.
  const hasForbiddenControl = [...content].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 && code !== 9 && code !== 10 && code !== 13;
  });
  if (hasForbiddenControl || MARKUP_OR_SCRIPT.test(content)) {
    throw new BadRequestException('A varredura recusou conteudo ativo ou binario.');
  }
  if (PERSONAL_DATA.test(content)) {
    throw new BadRequestException('Remova dados pessoais antes do envio.');
  }
  if (detectInjection(content)) {
    throw new BadRequestException('A varredura recusou instrucoes direcionadas a agente.');
  }
}

interface KnowledgeListRow {
  id: string;
  title: string;
  topic: string;
  source_url: string | null;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  created_at: Date;
  uploaded_by_name: string | null;
  decision: 'APPROVED' | 'REJECTED' | null;
  review_note: string | null;
  reviewer_name: string | null;
  reviewed_at: Date | null;
  retained_until: Date | null;
  blob_available: boolean;
  chunk_count: number;
}

@Injectable()
export class KnowledgeAdminService {
  constructor(
    private readonly db: TenantDatabase,
    @Inject(EMBEDDING_PORT) private readonly embedding: EmbeddingPort,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthenticatedUser): Promise<KnowledgeDocumentsResponse> {
    const rows = await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      // ponytail: expurgo oportunista evita scheduler para o volume inicial; ao crescer,
      // chamar a mesma funcao estreita por job diario monitorado.
      await tx.execute(sql`SELECT public.purge_expired_knowledge_blobs()`);
      const result = (await tx.execute(sql`
        SELECT document.id, document.title, document.topic, document.source_url,
          document.original_filename, document.mime_type, document.size_bytes, document.sha256,
          document.created_at, uploader.name AS uploaded_by_name,
          latest.decision, latest.note AS review_note, reviewer.name AS reviewer_name,
          latest.created_at AS reviewed_at, blob.retained_until,
          (blob.document_id IS NOT NULL) AS blob_available,
          count(chunk.id)::int AS chunk_count
        FROM knowledge_documents document
        LEFT JOIN users uploader ON uploader.id = document.uploaded_by
        LEFT JOIN LATERAL (
          SELECT review.decision, review.note, review.reviewer_id, review.created_at
          FROM knowledge_document_reviews review WHERE review.document_id = document.id
          ORDER BY review.created_at DESC, review.id DESC LIMIT 1
        ) latest ON true
        LEFT JOIN users reviewer ON reviewer.id = latest.reviewer_id
        LEFT JOIN knowledge_document_blobs blob ON blob.document_id = document.id
        LEFT JOIN knowledge_base chunk ON chunk.document_id = document.id
        GROUP BY document.id, uploader.name, latest.decision, latest.note, reviewer.name,
          latest.created_at, blob.retained_until, blob.document_id
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
        sourceUrl: row.source_url,
        originalFilename: row.original_filename,
        mimeType: row.mime_type,
        sizeBytes: Number(row.size_bytes),
        sha256: row.sha256,
        status: row.decision ?? 'PENDING',
        uploadedBy: row.uploaded_by_name,
        reviewer: row.reviewer_name,
        reviewNote: row.review_note,
        createdAt: new Date(row.created_at).toISOString(),
        reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
        retainedUntil: row.retained_until ? new Date(row.retained_until).toISOString() : null,
        blobAvailable: row.blob_available,
        chunkCount: Number(row.chunk_count),
      })),
      policy: {
        allowedTypes: ['text/plain', 'text/markdown'],
        maxBytes: MAX_KNOWLEDGE_DOCUMENT_BYTES,
        quarantineDays: QUARANTINE_DAYS,
        approvedOriginalDays: APPROVED_ORIGINAL_DAYS,
      },
    });
  }

  async upload(actor: AuthenticatedUser, body: unknown): Promise<KnowledgeDocumentsResponse> {
    const parsed = uploadKnowledgeDocumentSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException({ code: 'INVALID_INPUT', issues: parsed.error.issues });
    const input = parsed.data;
    const extension = input.originalFilename
      .slice(input.originalFilename.lastIndexOf('.'))
      .toLowerCase();
    const payload = Buffer.from(input.content, 'utf8');
    if (!ALLOWED_EXTENSIONS.has(extension))
      throw new BadRequestException('Envie somente arquivo .txt ou .md.');
    if (payload.byteLength > MAX_KNOWLEDGE_DOCUMENT_BYTES)
      throw new BadRequestException('O arquivo excede 512 KiB.');
    scanKnowledgeContent(input.content);
    const sha256 = createHash('sha256').update(payload).digest('hex');

    try {
      await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
        const [document] = await tx
          .insert(knowledgeDocuments)
          .values({
            title: input.title,
            topic: input.topic,
            sourceUrl: input.sourceUrl ?? null,
            originalFilename: input.originalFilename,
            mimeType: input.mimeType,
            sizeBytes: payload.byteLength,
            sha256,
            uploadedBy: actor.userId,
          })
          .returning({ id: knowledgeDocuments.id });
        if (!document)
          throw new BadRequestException('Nao foi possivel colocar o arquivo em quarentena.');
        await tx.execute(sql`
          INSERT INTO knowledge_document_blobs (document_id, payload, retained_until)
          VALUES (${document.id}::uuid, ${payload}, now() + interval '30 days')
        `);
        await this.audit.append(tx, {
          actorId: actor.userId,
          userId: actor.userId,
          action: 'knowledge.upload',
          entityType: 'knowledge_document',
          entityId: document.id,
          changes: { sha256, sizeBytes: payload.byteLength, mimeType: input.mimeType },
        });
      });
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
        throw new ConflictException('Este arquivo ja foi enviado.');
      }
      throw error;
    }
    return this.list(actor);
  }

  async content(actor: AuthenticatedUser, id: string) {
    const documentId = z.uuid().safeParse(id);
    if (!documentId.success) throw new BadRequestException('Identificador de documento invalido.');
    return this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT payload FROM knowledge_document_blobs WHERE document_id = ${id}::uuid
      `)) as unknown as Array<{ payload: Buffer }>;
      const row = rows[0];
      if (!row) throw new NotFoundException('O original nao esta mais disponivel.');
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action: 'knowledge.content.view',
        entityType: 'knowledge_document',
        entityId: id,
        changes: {},
      });
      return this.envelope({ id, content: row.payload.toString('utf8') });
    });
  }

  async review(actor: AuthenticatedUser, body: unknown): Promise<KnowledgeDocumentsResponse> {
    const parsed = reviewKnowledgeDocumentSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException({ code: 'INVALID_INPUT', issues: parsed.error.issues });
    const input = parsed.data;
    await this.db.runAsUser(actor.userId, actor.role, async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`knowledge:${input.documentId}`}, 0))`,
      );
      const docs = (await tx.execute(sql`
        SELECT document.title, document.topic, document.source_url, blob.payload
        FROM knowledge_documents document
        LEFT JOIN knowledge_document_blobs blob ON blob.document_id = document.id
        WHERE document.id = ${input.documentId}::uuid
      `)) as unknown as Array<{
        title: string;
        topic: string;
        source_url: string | null;
        payload: Buffer | null;
      }>;
      const document = docs[0];
      if (!document) throw new NotFoundException('Documento inexistente.');
      const reviewed = (await tx.execute(sql`
        SELECT 1 FROM knowledge_document_reviews WHERE document_id = ${input.documentId}::uuid LIMIT 1
      `)) as unknown as unknown[];
      if (reviewed.length) throw new ConflictException('Este documento ja foi revisado.');
      if (!document.payload)
        throw new BadRequestException('O original nao esta mais disponivel para revisao.');

      let chunks: Awaited<ReturnType<typeof prepareCorpus>> = [];
      if (input.decision === 'APPROVED') {
        const content = document.payload.toString('utf8');
        scanKnowledgeContent(content);
        chunks = await prepareCorpus(
          [
            {
              title: document.title,
              topic: document.topic,
              content,
              sourceUrl: document.source_url ?? undefined,
              reliability: 5,
            },
          ],
          this.embedding,
        );
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
      if (!review) throw new BadRequestException('Nao foi possivel registrar a revisao.');
      if (input.decision === 'APPROVED') {
        const [published] = (await tx.execute(sql`
          SELECT public.publish_knowledge_document(${input.documentId}::uuid, ${JSON.stringify(chunks)}::jsonb) AS count
        `)) as unknown as Array<{ count: number }>;
        if (Number(published?.count ?? 0) !== chunks.length) {
          throw new ConflictException('A publicacao nao gravou todos os trechos esperados.');
        }
      }
      await this.audit.append(tx, {
        actorId: actor.userId,
        userId: actor.userId,
        action: input.decision === 'APPROVED' ? 'knowledge.approve' : 'knowledge.reject',
        entityType: 'knowledge_document',
        entityId: input.documentId,
        changes: { reviewId: review.id, chunks: chunks.length, note: input.note },
      });
    });
    return this.list(actor);
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
