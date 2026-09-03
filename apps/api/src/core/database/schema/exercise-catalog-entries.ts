/**
 * `exercise_catalog_entries` — base de referência de exercícios, parametrizada (achado
 * 2026-09-02). Substitui o array `const` de `exercise-catalog.ts` como fonte de runtime:
 * aquele arquivo passa a alimentar só o `ensureBootstrap()` do `ExerciseCatalogProvider`,
 * no mesmo papel que `METHODOLOGY_GUIDELINES` tem para `methodology_versions`.
 *
 * Mesmo molde de `faq_entries`: append-only, `PUBLISHED`/`RETIRED` (sem estágio de
 * aprovação separado — o `ValidationService` continua sendo o veto de segurança de
 * verdade, não o fluxo de edição), versionado por `exercise_key`, a linha mais recente de
 * cada chave é o estado atual.
 *
 * Sem RLS por titular — catálogo é configuração global do produto, mesmo raciocínio de
 * `agent_config`/`ai_forbidden_topics`.
 */
import { index, integer, jsonb, pgEnum, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import type {
  ContraindicationTag,
  ExerciseLevel,
  ExerciseLocation,
  ExerciseMeasurement,
  MovementPattern,
} from '../../../modules/protocol/exercise-catalog';
import { eventTimestamp, primaryKeyColumn } from './_shared';
import { users } from './users';

export const exerciseCatalogEntryStatusEnum = pgEnum('exercise_catalog_entry_status', [
  'PUBLISHED',
  'RETIRED',
]);

export const exerciseCatalogEntries = pgTable(
  'exercise_catalog_entries',
  {
    id: primaryKeyColumn(),
    /** Identidade lógica e estável do exercício (kebab/snake_case) — o "id" que o prompt e
     *  o `ProtocolStructure` gerado referenciam; nunca muda entre versões. */
    exerciseKey: text('exercise_key').notNull(),
    name: text('name').notNull(),
    pattern: text('pattern').notNull().$type<MovementPattern>(),
    muscleGroups: jsonb('muscle_groups').$type<string[]>().notNull(),
    equipment: jsonb('equipment').$type<string[]>().notNull(),
    locations: jsonb('locations').$type<ExerciseLocation[]>().notNull(),
    minLevel: text('min_level').notNull().$type<ExerciseLevel>(),
    contraindicatedFor: jsonb('contraindicated_for').$type<ContraindicationTag[]>().notNull(),
    substitutes: jsonb('substitutes').$type<string[]>().notNull(),
    measurement: text('measurement').$type<ExerciseMeasurement>(),
    durationSecondsRange: jsonb('duration_seconds_range').$type<{
      min: number;
      max: number;
    } | null>(),
    minRestSeconds: integer('min_rest_seconds'),
    /** Vídeo de execução curado (achado 2026-09-02) — auto-vinculado pela geração, nunca
     *  preenchido pela IA. Ver `protocol.schema.ts#protocolExerciseSchema.videoUrl`. */
    videoUrl: text('video_url'),
    version: integer('version').notNull(),
    status: exerciseCatalogEntryStatusEnum('status').notNull().default('PUBLISHED'),
    changeNote: text('change_note').notNull(),
    /** Nulo só na linha de bootstrap (migração automática do array legado — sem ator humano). */
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: eventTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('uq_exercise_catalog_entries_key_version').on(table.exerciseKey, table.version),
    index('idx_exercise_catalog_entries_key').on(table.exerciseKey, table.version),
    index('idx_exercise_catalog_entries_pattern').on(table.pattern),
  ],
);

export type ExerciseCatalogEntryRow = typeof exerciseCatalogEntries.$inferSelect;
