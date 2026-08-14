/** Documentos enviados para o corpus RAG e suas revisoes profissionais imutaveis. */
import { index, integer, pgEnum, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';

import { bytea, eventTimestamp, primaryKeyColumn } from './_shared';
import { users } from './users';

export const knowledgeReviewDecisionEnum = pgEnum('knowledge_review_decision', [
  'APPROVED',
  'REJECTED',
]);

export const knowledgeDocuments = pgTable(
  'knowledge_documents',
  {
    id: primaryKeyColumn(),
    title: varchar('title', { length: 200 }).notNull(),
    topic: varchar('topic', { length: 60 }).notNull(),
    sourceUrl: varchar('source_url', { length: 500 }),
    originalFilename: varchar('original_filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull().unique(),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: eventTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [index('idx_knowledge_documents_created_at').on(table.createdAt)],
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

export type KnowledgeDocumentRow = typeof knowledgeDocuments.$inferSelect;
