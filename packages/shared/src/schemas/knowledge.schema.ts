import { z } from 'zod';

import { controlCenterMetaSchema } from './control-center.schema';

/** Teto de upload de um artigo (PDF/Word/planilha cabem; o BFF, o nginx e a API usam o mesmo). */
export const MAX_KNOWLEDGE_DOCUMENT_BYTES = 10 * 1024 * 1024;

export const knowledgeDocumentCategorySchema = z.enum([
  'METHODOLOGY',
  'SCIENTIFIC_EVIDENCE',
  'EXERCISE_LIBRARY',
  'SAFETY',
  'OTHER',
]);

export const knowledgeDocumentStatusSchema = z.enum([
  'QUARANTINED',
  'PROCESSING',
  'READY_FOR_REVIEW',
  'APPROVED',
  'INDEXING',
  'PUBLISHED',
  'REJECTED',
  'FAILED',
  'ARCHIVED',
]);

/**
 * Metadados opcionais do upload de um artigo científico (o arquivo vai em multipart, campo
 * `file`). Sem título, o nome do arquivo vira o título; categoria e tópico são fixos.
 */
export const uploadKnowledgeArticleSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  author: z.string().trim().min(2).max(200).optional(),
  sourceUrl: z.url().max(500).optional(),
});
export type UploadKnowledgeArticleInput = z.infer<typeof uploadKnowledgeArticleSchema>;

export const reviewKnowledgeDocumentSchema = z.object({
  documentId: z.uuid(),
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().trim().min(5).max(500),
});
export type ReviewKnowledgeDocumentInput = z.infer<typeof reviewKnowledgeDocumentSchema>;

export const knowledgeDocumentSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  topic: z.string(),
  category: knowledgeDocumentCategorySchema,
  logicalKey: z.string(),
  version: z.int().positive(),
  sourceUrl: z.string().nullable(),
  author: z.string().nullable(),
  license: z.string().nullable(),
  originalFilename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.int().nonnegative(),
  sha256: z.string().length(64),
  status: knowledgeDocumentStatusSchema,
  stage: z.string(),
  errorCode: z.string().nullable(),
  canRetry: z.boolean(),
  uploadedBy: z.string().nullable(),
  reviewer: z.string().nullable(),
  reviewNote: z.string().nullable(),
  createdAt: z.iso.datetime(),
  reviewedAt: z.iso.datetime().nullable(),
  retainedUntil: z.iso.datetime().nullable(),
  blobAvailable: z.boolean(),
  chunkCount: z.int().nonnegative(),
});
export type KnowledgeDocument = z.infer<typeof knowledgeDocumentSchema>;

export const knowledgeDocumentsResponseSchema = z.object({
  data: z.object({
    documents: z.array(knowledgeDocumentSchema),
    policy: z.object({
      allowedTypes: z.array(z.string()),
      /** Extensões aceitas no upload (ex.: ".pdf"). Ausente em respostas de versões antigas. */
      allowedExtensions: z.array(z.string()).optional(),
      maxBytes: z.int().positive(),
      quarantineDays: z.int().positive(),
      approvedOriginalDays: z.int().positive(),
    }),
  }),
  meta: controlCenterMetaSchema,
});
export type KnowledgeDocumentsResponse = z.infer<typeof knowledgeDocumentsResponseSchema>;

export const knowledgeDocumentContentResponseSchema = z.object({
  data: z.object({ id: z.uuid(), content: z.string() }),
  meta: controlCenterMetaSchema,
});
export type KnowledgeDocumentContentResponse = z.infer<
  typeof knowledgeDocumentContentResponseSchema
>;

export const knowledgeDocumentActionSchema = z.object({
  documentId: z.uuid(),
  note: z.string().trim().min(5).max(500),
});
export type KnowledgeDocumentActionInput = z.infer<typeof knowledgeDocumentActionSchema>;
