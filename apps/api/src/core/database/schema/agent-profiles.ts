/**
 * `agent_profiles` — ficha de cada agente de IA (markdown), versionada como a metodologia:
 * DRAFT → TESTING (casos de avaliação aprovados) → PUBLISHED → SUPERSEDED. No máximo uma
 * versão publicada por agente.
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

import { agentProfileKeySchema, agentProfileStatusSchema } from '@movivo/shared';

import { checkOneOf, eventTimestamp, primaryKeyColumn, timestampColumns } from './_shared';
import { staff } from './staff';

export const agentProfiles = pgTable(
  'agent_profiles',
  {
    id: primaryKeyColumn(),
    agent: varchar('agent', { length: 24 }).notNull(),
    version: integer('version').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('DRAFT'),
    content: text('content').notNull(),
    changeNote: text('change_note').notNull(),
    /** Execuções da avaliação que aprovaram a versão (ids de `eval_runs`). */
    evalRunIds: jsonb('eval_run_ids')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdBy: uuid('created_by').references(() => staff.id, { onDelete: 'restrict' }),
    publishedBy: uuid('published_by').references(() => staff.id, { onDelete: 'restrict' }),
    publishedAt: eventTimestamp('published_at'),
    ...timestampColumns,
  },
  (t) => [
    unique('uq_agent_profiles_agent_version').on(t.agent, t.version),
    uniqueIndex('uq_agent_profiles_one_published')
      .on(t.agent)
      .where(sql`${t.status} = 'PUBLISHED'`),
    index('idx_agent_profiles_agent').on(t.agent, t.status),
    checkOneOf('ck_agent_profiles_agent', t.agent, agentProfileKeySchema.options),
    checkOneOf('ck_agent_profiles_status', t.status, agentProfileStatusSchema.options),
  ],
);
