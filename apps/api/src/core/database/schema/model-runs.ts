/**
 * Gateway de modelos: configuração dos tiers e registro de cada chamada.
 *
 * `model_tiers` é configuração global (sem titular): qual modelo atende cada capacidade, em
 * que ordem de failover. Trocar uma linha muda o modelo em produção sem deploy — por isso a
 * troca passa pelos casos de avaliação antes (gate do M2/M10).
 *
 * `model_runs` registra TODA chamada (sucesso ou falha) com tarefa, tier, modelo, versão do
 * prompt, tokens, custo e latência. Nunca guarda o prompt em claro: só hashes e tamanhos.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { MODEL_TIERS, MODEL_VENDORS } from '../../ai/ai.types';
import {
  checkOneOf,
  eventTimestamp,
  primaryKeyColumn,
  timestampColumns,
  userIdColumn,
} from './_shared';
import { staff } from './staff';
import { users } from './users';

export const modelTiers = pgTable(
  'model_tiers',
  {
    id: primaryKeyColumn(),
    tier: varchar('tier', { length: 16 }).notNull(),
    /** Ordem de failover dentro do tier (1 = primeiro). */
    position: smallint('position').notNull(),
    vendor: varchar('vendor', { length: 16 }).notNull(),
    model: varchar('model', { length: 80 }).notNull(),
    maxOutputTokens: integer('max_output_tokens').notNull(),
    timeoutMs: integer('timeout_ms').notNull(),
    temperature: numeric('temperature', { precision: 3, scale: 2, mode: 'number' }).notNull(),
    vision: boolean('vision').notNull().default(false),
    enabled: boolean('enabled').notNull().default(true),
    updatedBy: uuid('updated_by').references(() => staff.id, { onDelete: 'restrict' }),
    ...timestampColumns,
  },
  (t) => [
    unique('uq_model_tiers_tier_position').on(t.tier, t.position),
    checkOneOf('ck_model_tiers_tier', t.tier, MODEL_TIERS),
    checkOneOf('ck_model_tiers_vendor', t.vendor, MODEL_VENDORS),
  ],
);

export const modelRuns = pgTable(
  'model_runs',
  {
    id: primaryKeyColumn(),
    /** Titular da chamada; nulo em execuções sem aluno (avaliação, metodologia). */
    userId: userIdColumn().references(() => users.id, { onDelete: 'cascade' }),
    taskId: varchar('task_id', { length: 60 }).notNull(),
    promptVersion: varchar('prompt_version', { length: 64 }).notNull(),
    tier: varchar('tier', { length: 16 }).notNull(),
    vendor: varchar('vendor', { length: 16 }),
    model: varchar('model', { length: 80 }),
    dataClass: varchar('data_class', { length: 16 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    /** Posição da rota que respondeu (ou que falhou por último). */
    attempt: smallint('attempt').notNull(),
    tokensInput: integer('tokens_input').notNull().default(0),
    tokensCached: integer('tokens_cached').notNull().default(0),
    tokensOutput: integer('tokens_output').notNull().default(0),
    costBrl: numeric('cost_brl', { precision: 10, scale: 5, mode: 'number' }).notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    errorCode: varchar('error_code', { length: 40 }),
    /** Hashes e tamanhos do prompt — correlação sem guardar conteúdo. */
    inputSnapshot: jsonb('input_snapshot').$type<Record<string, string | number>>().notNull(),
    createdAt: eventTimestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_model_runs_user').on(t.userId, t.createdAt),
    index('idx_model_runs_task').on(t.taskId, t.createdAt),
    checkOneOf('ck_model_runs_tier', t.tier, MODEL_TIERS),
    checkOneOf('ck_model_runs_status', t.status, ['COMPLETED', 'FAILED']),
    checkOneOf('ck_model_runs_data_class', t.dataClass, ['HEALTH', 'NON_HEALTH']),
  ],
);
