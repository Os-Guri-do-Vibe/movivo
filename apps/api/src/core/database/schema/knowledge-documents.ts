/** Documentos enviados para o corpus RAG e suas revisoes profissionais imutaveis. */
import { index, integer, pgEnum, pgTable, text, unique, uuid, varchar } from 'drizzle-orm/pg-core';

import { bytea, eventTimestamp, primaryKeyColumn } from './_shared';
import { embeddingVector } from './vector';
import { users } from './users';

export const knowledgeReviewDecisionEnum = pgEnum('knowledge_review_decision', [
  'APPROVED',
  'REJECTED',
]);

export const knowledgeDocumentCategoryEnum = pgEnum('knowledge_document_category', [
  'METHODOLOGY',
  'SCIENTIFIC_EVIDENCE',
  'EXERCISE_LIBRARY',
  'SAFETY',
  'OTHER',
]);

export const knowledgeDocumentStatusEnum = pgEnum('knowledge_document_status', [
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

export const knowledgeDocuments = pgTable(
  'knowledge_documents',
  {
    id: primaryKeyColumn(),
    title: varchar('title', { length: 200 }).notNull(),
    topic: varchar('topic', { length: 60 }).notNull(),
    category: knowledgeDocumentCategoryEnum('category').notNull().default('OTHER'),
    logicalKey: varchar('logical_key', { length: 120 }).notNull(),
    version: integer('version').notNull().default(1),
    sourceUrl: varchar('source_url', { length: 500 }),
    author: varchar('author', { length: 200 }),
    license: varchar('license', { length: 120 }),
    originalFilename: varchar('original_filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull().unique(),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: eventTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_knowledge_documents_created_at').on(table.createdAt),
    unique('uq_knowledge_documents_logical_version').on(table.logicalKey, table.version),
  ],
);

/** Payload em quarentena. Pode ser apagado ao vencer a retencao; metadados ficam. */
export const knowledgeDocumentBlobs = pgTable('knowledge_document_blobs', {
  documentId: uuid('document_id')
    .primaryKey()
    .references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
  payload: bytea('payload').notNull(),
  retainedUntil: eventTimestamp('retained_until').notNull(),
  createdAt: eventTimestamp('created_at').notNull().defaultNow(),
});

export const knowledgeDocumentReviews = pgTable(
  'knowledge_document_reviews',
  {
    id: primaryKeyColumn(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: 'restrict' }),
    decision: knowledgeReviewDecisionEnum('decision').notNull(),
    note: text('note').notNull(),
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: eventTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_knowledge_document_reviews_document').on(table.documentId, table.createdAt),
  ],
);

/** Eventos append-only: o estado atual é sempre o último `sequence` do documento. */
export const knowledgeDocumentEvents = pgTable(
  'knowledge_document_events',
  {
    id: primaryKeyColumn(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: 'restrict' }),
    sequence: integer('sequence').notNull(),
    status: knowledgeDocumentStatusEnum('status').notNull(),
    stage: varchar('stage', { length: 40 }).notNull(),
    errorCode: varchar('error_code', { length: 80 }),
    note: text('note'),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: eventTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('uq_knowledge_document_event_sequence').on(table.documentId, table.sequence),
    index('idx_knowledge_document_events_status').on(table.status, table.createdAt),
  ],
);

/** Texto canônico extraído e atestado por hash; nunca é alterado após o parsing. */
export const knowledgeDocumentExtractions = pgTable('knowledge_document_extractions', {
  documentId: uuid('document_id')
    .primaryKey()
    .references(() => knowledgeDocuments.id, { onDelete: 'restrict' }),
  content: text('content').notNull(),
  contentSha256: varchar('content_sha256', { length: 64 }).notNull(),
  parserVersion: varchar('parser_version', { length: 50 }).notNull(),
  detectedMimeType: varchar('detected_mime_type', { length: 100 }).notNull(),
  createdAt: eventTimestamp('created_at').notNull().defaultNow(),
});

/** Chunks canônicos, imutáveis e vinculados ao hash da extração. */
export const knowledgeStagedChunks = pgTable(
  'knowledge_staged_chunks',
  {
    id: primaryKeyColumn(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: 'restrict' }),
    chunkIndex: integer('chunk_index').notNull(),
    chunkText: text('chunk_text').notNull(),
    chunkSha256: varchar('chunk_sha256', { length: 64 }).notNull(),
    extractionSha256: varchar('extraction_sha256', { length: 64 }).notNull(),
    createdAt: eventTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [unique('uq_knowledge_staged_document_chunk').on(table.documentId, table.chunkIndex)],
);

/** Embedding calculado fora da transação de aprovação, atestado pelo hash do chunk. */
export const knowledgeChunkEmbeddings = pgTable('knowledge_chunk_embeddings', {
  stagedChunkId: uuid('staged_chunk_id')
    .primaryKey()
    .references(() => knowledgeStagedChunks.id, { onDelete: 'restrict' }),
  chunkSha256: varchar('chunk_sha256', { length: 64 }).notNull(),
  embedding: embeddingVector('embedding').notNull(),
  model: varchar('model', { length: 80 }).notNull(),
  createdAt: eventTimestamp('created_at').notNull().defaultNow(),
});

export type KnowledgeDocumentRow = typeof knowledgeDocuments.$inferSelect;
