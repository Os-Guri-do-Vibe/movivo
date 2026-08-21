import { z } from 'zod';

import { controlCenterMetaSchema } from './control-center.schema';

export const MAX_KNOWLEDGE_DOCUMENT_BYTES = 512 * 1024;

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

export const uploadKnowledgeDocumentSchema = z.object({
  title: z.string().trim().min(3).max(200),
  topic: z
    .string()
    .trim()
    .regex(/^[A-Za-zÀ-ú0-9 _-]{2,60}$/),
  category: knowledgeDocumentCategorySchema.default('OTHER'),
  logicalKey: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(120)
    .optional(),
  sourceUrl: z.url().max(500).optional(),
  author: z.string().trim().min(2).max(200).optional(),
  license: z.string().trim().min(2).max(120).optional(),
  originalFilename: z.string().trim().min(1).max(255),
  // A API valida a allowlist e devolve um erro operacional específico para formatos
  // complexos; não escondemos isso num `invalid_enum_value` genérico do Zod.
  mimeType: z.string().trim().min(1).max(100),
  content: z.string().min(1).max(MAX_KNOWLEDGE_DOCUMENT_BYTES),
});
export type UploadKnowledgeDocumentInput = z.infer<typeof uploadKnowledgeDocumentSchema>;

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

export const methodologyStatusSchema = z.enum([
  'DRAFT',
  'IN_REVIEW',
  'REJECTED',
  'APPROVED',
  'PUBLISHED',
  'ARCHIVED',
]);

/**
 * `summary` — resumo curto que o RT publica junto com a metodologia completa.
 *
 * Existe porque o gerador de protocolo lê `methodology_versions`, mas o coach conversacional
 * não: a metodologia não está indexada em `knowledge_base`, então ele não a alcança nem por
 * prompt nem por RAG (achado do Victor). O resumo é a ponte barata (~200 tokens) — injetado
 * só em `DUVIDA_TECNICA` e `SUBSTITUICAO_EXERCICIO`, para EXPLICAR decisões do protocolo.
 * Opcional de propósito: versão sem resumo simplesmente omite o bloco, sem resumo automático.
 */
export const createMethodologyVersionSchema = z.object({
  content: z.string().trim().min(200).max(100_000),
  summary: z.string().trim().min(200).max(1000).optional(),
  changeNote: z.string().trim().min(10).max(500),
});
export type CreateMethodologyVersionInput = z.infer<typeof createMethodologyVersionSchema>;

export const methodologyActionSchema = z.object({
  versionId: z.uuid(),
  note: z.string().trim().min(5).max(500),
});
export type MethodologyActionInput = z.infer<typeof methodologyActionSchema>;

export const methodologyNoteSchema = z.object({
  note: z.string().trim().min(5).max(500),
});
export const methodologyReviewSchema = methodologyNoteSchema.extend({
  decision: z.enum(['APPROVED', 'REJECTED']),
});

export const methodologyVersionSchema = z.object({
  id: z.uuid(),
  version: z.int().positive(),
  versionLabel: z.string(),
  content: z.string(),
  summary: z.string().nullable(),
  contentSha256: z.string().length(64),
  changeNote: z.string(),
  status: methodologyStatusSchema,
  createdBy: z.string().nullable(),
  lastActor: z.string().nullable(),
  createdAt: z.iso.datetime(),
  statusChangedAt: z.iso.datetime(),
});
export type MethodologyVersion = z.infer<typeof methodologyVersionSchema>;

export const methodologyVersionsResponseSchema = z.object({
  data: z.object({
    versions: z.array(methodologyVersionSchema),
    currentVersionId: z.uuid().nullable(),
  }),
  meta: controlCenterMetaSchema,
});
export type MethodologyVersionsResponse = z.infer<typeof methodologyVersionsResponseSchema>;
