import { z } from 'zod';

import { controlCenterMetaSchema } from './control-center.schema';

/** Teto de upload de um artigo (PDF/Word/planilha cabem; o BFF, o nginx e a API usam o mesmo). */
export const MAX_KNOWLEDGE_DOCUMENT_BYTES = 10 * 1024 * 1024;

/**
 * Teto das notas de uma versão da metodologia (motivo da mudança e justificativa de cada
 * transição). Era 500 e estourava ao descrever uma revisão grande da metodologia; o texto da
 * metodologia em si (`content`) segue sem teto de caracteres.
 */
export const MAX_METHODOLOGY_NOTE_LENGTH = 5000;

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

export const methodologyStatusSchema = z.enum([
  'DRAFT',
  'IN_REVIEW',
  'REJECTED',
  'APPROVED',
  'PUBLISHED',
  'ARCHIVED',
]);

/**
 * Achado 2026-09-02 (decisão do fundador): removido o campo `summary` ("Resumo para o
 * Coach") que existia aqui. O AI Coach não deve raciocinar sobre um resumo comprimido da
 * metodologia — ele recebe o `content` completo (mesmo texto que o gerador de protocolo
 * usa), mais o contexto individualizado do aluno (anamnese, protocolo completo). Sem
 * resumo, "a metodologia dele" É a metodologia da MOVIVO, não uma versão editada à parte.
 * `content` também deixou de ter teto de caracteres: o profissional CREF decide o quanto a
 * metodologia precisa, sem um limite arbitrário de produto.
 */
export const createMethodologyVersionSchema = z.object({
  content: z.string().trim().min(200),
  /** Opcional: o histórico mostra o resumo, mas escrever não é pré-requisito para salvar. */
  changeNote: z.string().trim().max(MAX_METHODOLOGY_NOTE_LENGTH).optional(),
});
export type CreateMethodologyVersionInput = z.infer<typeof createMethodologyVersionSchema>;

export const methodologyActionSchema = z.object({
  versionId: z.uuid(),
  note: z.string().trim().min(5).max(MAX_METHODOLOGY_NOTE_LENGTH),
});
export type MethodologyActionInput = z.infer<typeof methodologyActionSchema>;

export const methodologyNoteSchema = z.object({
  note: z.string().trim().min(5).max(MAX_METHODOLOGY_NOTE_LENGTH),
});

/** Publicação e restauração não exigem justificativa; a observação é opcional. */
export const methodologyOptionalNoteSchema = z.object({
  note: z.string().trim().max(MAX_METHODOLOGY_NOTE_LENGTH).optional(),
});
export const methodologyPublishActionSchema = methodologyOptionalNoteSchema.extend({
  versionId: z.uuid(),
});
export type MethodologyPublishActionInput = z.infer<typeof methodologyPublishActionSchema>;
export const methodologyReviewSchema = methodologyNoteSchema.extend({
  decision: z.enum(['APPROVED', 'REJECTED']),
});

export const methodologyVersionSchema = z.object({
  id: z.uuid(),
  version: z.int().positive(),
  versionLabel: z.string(),
  content: z.string(),
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
