/**
 * `intent_examples` — exemplos rotulados para o embedding-kNN do IntentClassifier (US-3.4).
 *
 * Mesma categoria de `knowledge_base` (US-3.3): corpus **global, curado, somente-leitura** —
 * não é dado de titular, então **fica fora da RLS por titular**; o controle é por permissão
 * (`movivo_app` só SELECT; a escrita — seed/indexação — usa a role de migração). Cresce com
 * red-team e logs reais. Índice HNSW criado no `migrate.ts`.
 */
import { index, pgTable, text, varchar } from 'drizzle-orm/pg-core';

import { primaryKeyColumn, timestampColumns } from './_shared';
import { embeddingVector } from './knowledge-base';

export const intentExamples = pgTable(
  'intent_examples',
  {
    id: primaryKeyColumn(),
    /** Rótulo da intenção (taxonomia do IntentClassifier). */
    intent: varchar('intent', { length: 40 }).notNull(),
    /** Frase-exemplo do usuário para aquela intenção. */
    text: text('text').notNull(),
    embedding: embeddingVector('embedding').notNull(),
    ...timestampColumns,
  },
  (table) => [index('idx_intent_examples_intent').on(table.intent)],
);

export type IntentExampleRow = typeof intentExamples.$inferSelect;
export type NewIntentExampleRow = typeof intentExamples.$inferInsert;
