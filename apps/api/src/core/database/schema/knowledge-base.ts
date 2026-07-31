/**
 * `knowledge_base` — corpus curado do RAG (US-3.3 / TASK-3.3.1).
 *
 * ## Decisão de RLS (Sato §10.4)
 * Esta tabela **NÃO** entra na RLS por titular: é conteúdo curado, global e **somente-leitura**
 * — não é dado pessoal de nenhum usuário. O controle é por **permissão**: `movivo_app` recebe
 * só `SELECT` (a escrita — indexação — usa a role privilegiada de migração, offline). Isso
 * impede envenenamento do corpus (RAG poisoning) por um app comprometido, sem o overhead de RLS.
 *
 * ## Realidade (decisão do fundador 2026-07)
 * O corpus real é alimentado pelo profissional CREF via dashboard (Sprint 5). Aqui entregamos
 * o **pipeline** (schema + indexação + retrieval) e um corpus-semente pequeno para dev.
 *
 * O índice HNSW (`m=16/ef_construction=64`, `vector_cosine_ops`) é criado no `migrate.ts`
 * (o drizzle-kit não expressa operator class de pgvector) — mesmo padrão de extensões/RLS.
 */
import { customType, index, integer, pgTable, text, varchar } from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn, timestampColumns } from './_shared';

/** Dimensão do `text-embedding-3-small` (OpenAI) — e do embedding fake de dev. */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Coluna `vector(N)` do pgvector. O drizzle-kit não expõe o tipo; declaramos o custom type
 * uma vez (mesmo padrão do `bytea` em `_shared.ts`). `number[]` ⇄ literal `[a,b,c]`.
 */
export const embeddingVector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `vector(${EMBEDDING_DIMENSIONS})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(',').filter(Boolean).map(Number);
  },
});

export const knowledgeBase = pgTable(
  'knowledge_base',
  {
    id: primaryKeyColumn(),
    /** Trecho (chunk) de ~400-512 tokens indexado. */
    chunkText: text('chunk_text').notNull(),
    embedding: embeddingVector('embedding').notNull(),
    /** Tópico para filtro no retrieval (ex.: 'hipertrofia', 'descanso'). */
    topic: varchar('topic', { length: 60 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    sourceUrl: varchar('source_url', { length: 500 }),
    /** Confiabilidade da fonte 1-5 (curadoria). */
    reliability: integer('reliability').notNull().default(3),
    publishedAt: eventTimestamp('published_at'),
    ...timestampColumns,
  },
  (table) => [
    // Filtro por tópico no retrieval. O índice HNSW do `embedding` é criado no migrate.ts.
    index('idx_knowledge_base_topic').on(table.topic),
  ],
);

export type KnowledgeChunkRow = typeof knowledgeBase.$inferSelect;
export type NewKnowledgeChunkRow = typeof knowledgeBase.$inferInsert;
