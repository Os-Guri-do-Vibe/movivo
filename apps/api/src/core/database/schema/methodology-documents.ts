/**
 * `methodology_documents` — metodologia da MOVIVO por domínio, escrita pelos profissionais no
 * estúdio, versionada e publicada só depois de passar nos casos de avaliação.
 *
 * Ciclo: DRAFT → TESTING (testes aprovados) → PUBLISHED → SUPERSEDED. No máximo uma versão
 * publicada por domínio (índice único parcial). Rollback = nova versão copiando uma antiga,
 * que também passa pelos testes.
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { methodologyDomainSchema, type MethodologyParameters } from '@movivo/shared';

import { checkOneOf, eventTimestamp, primaryKeyColumn, timestampColumns } from './_shared';
import { staff } from './staff';

export const METHODOLOGY_DOCUMENT_STATUSES = [
  'DRAFT',
  'TESTING',
  'PUBLISHED',
  'SUPERSEDED',
  'DISCARDED',
] as const;
export type MethodologyDocumentStatus = (typeof METHODOLOGY_DOCUMENT_STATUSES)[number];

export const methodologyDocuments = pgTable(
  'methodology_documents',
  {
    id: primaryKeyColumn(),
    domain: varchar('domain', { length: 16 }).notNull(),
    version: integer('version').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('DRAFT'),
    parameters: jsonb('parameters').$type<MethodologyParameters>().notNull(),
    /** Orientações em texto livre por tema (`guidance` do domínio). */
    guidance: jsonb('guidance').$type<Record<string, string>>().notNull(),
    /** Justificativa de cada valor fora da faixa plausível (caminho → texto). */
    justifications: jsonb('justifications')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    changeNote: text('change_note').notNull(),
    /** Execuções da avaliação que aprovaram a versão (ids de `eval_runs`). */
    evalRunIds: jsonb('eval_run_ids')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Nulo só na versão semeada pelo ambiente de desenvolvimento. */
    createdBy: uuid('created_by').references(() => staff.id, { onDelete: 'restrict' }),
    publishedBy: uuid('published_by').references(() => staff.id, { onDelete: 'restrict' }),
    publishedAt: eventTimestamp('published_at'),
    ...timestampColumns,
  },
  (t) => [
    unique('uq_methodology_documents_domain_version').on(t.domain, t.version),
    uniqueIndex('uq_methodology_documents_one_published')
      .on(t.domain)
      .where(sql`${t.status} = 'PUBLISHED'`),
    index('idx_methodology_documents_domain').on(t.domain, t.status),
    checkOneOf('ck_methodology_documents_domain', t.domain, methodologyDomainSchema.options),
    checkOneOf('ck_methodology_documents_status', t.status, METHODOLOGY_DOCUMENT_STATUSES),
  ],
);
