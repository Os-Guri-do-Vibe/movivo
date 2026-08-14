import { z } from 'zod';

import { controlCenterMetaSchema } from './control-center.schema';

export const MAX_KNOWLEDGE_DOCUMENT_BYTES = 512 * 1024;

export const uploadKnowledgeDocumentSchema = z.object({
  title: z.string().trim().min(3).max(200),
  topic: z
    .string()
    .trim()
    .regex(/^[A-Za-zÀ-ú0-9 _-]{2,60}$/),
  sourceUrl: z.url().max(500).optional(),
  originalFilename: z.string().trim().min(1).max(255),
  mimeType: z.enum(['text/plain', 'text/markdown']),
  content: z.string().min(50).max(MAX_KNOWLEDGE_DOCUMENT_BYTES),
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
  sourceUrl: z.string().nullable(),
  originalFilename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.int().nonnegative(),
  sha256: z.string().length(64),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
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
