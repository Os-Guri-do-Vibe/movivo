/**
 * Treino integrado: plano × sessão × agenda × execução, para todas as modalidades.
 *
 * A separação é a decisão central do domínio:
 *  - `training_plans` define O QUÊ e POR QUÊ (fases, prioridades por modalidade), versionado;
 *  - `plan_sessions` são as sessões-modelo do plano, sem data;
 *  - `scheduled_sessions` dizem QUANDO — reagendar muda só esta tabela, nunca o plano;
 *  - `session_executions` registram o que de fato foi feito (fonte única de "treinou").
 *
 * Carga interna em todas as modalidades = sRPE (PSE × minutos), inclusive esporte externo.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import {
  daySlotSchema,
  executionSourceSchema,
  executionStatusSchema,
  planStatusSchema,
  scheduleChangeSourceSchema,
  scheduledSessionStatusSchema,
  sessionModalitySchema,
  sessionPrioritySchema,
  type EnduranceMetrics,
  type PainReport,
  type SessionAdjustment,
  type SessionContent,
  type TrainingPlanStructure,
} from '@movivo/shared';

import {
  checkOneOf,
  eventTimestamp,
  primaryKeyColumn,
  timestampColumns,
  userIdColumn,
} from './_shared';
import { coachingDecisions } from './coaching';
import { studentGoals } from './student-state';
import { users } from './users';

const ownerColumn = () =>
  userIdColumn()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

/**
 * Versões do plano do aluno. No máximo uma `ACTIVE` por aluno (índice parcial único); publicar
 * uma versão nova marca a anterior como `SUPERSEDED` na mesma transação.
 */
export const trainingPlans = pgTable(
  'training_plans',
  {
    id: primaryKeyColumn(),
    userId: ownerColumn(),
    version: integer('version').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('DRAFT'),
    goalId: uuid('goal_id').references(() => studentGoals.id, { onDelete: 'set null' }),
    structure: jsonb('structure').$type<TrainingPlanStructure>().notNull(),
    startsOn: date('starts_on').notNull(),
    /** Versões publicadas da metodologia usadas na geração (domínio → versão). */
    methodologyVersions: jsonb('methodology_versions')
      .$type<Record<string, number>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    publishedAt: eventTimestamp('published_at'),
    ...timestampColumns,
  },
  (t) => [
    unique('uq_training_plans_user_version').on(t.userId, t.version),
    uniqueIndex('uq_training_plans_one_active')
      .on(t.userId)
      .where(sql`${t.status} = 'ACTIVE'`),
    checkOneOf('ck_training_plans_status', t.status, planStatusSchema.options),
  ],
);

/** Sessões-modelo de uma versão do plano (cópia normalizada de `structure.sessions`). */
export const planSessions = pgTable(
  'plan_sessions',
  {
    id: primaryKeyColumn(),
    userId: ownerColumn(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => trainingPlans.id, { onDelete: 'cascade' }),
    key: varchar('key', { length: 24 }).notNull(),
    modality: varchar('modality', { length: 16 }).notNull(),
    title: varchar('title', { length: 80 }).notNull(),
    priority: varchar('priority', { length: 16 }).notNull(),
    weeklyFrequency: smallint('weekly_frequency').notNull(),
    estimatedMinutes: smallint('estimated_minutes').notNull(),
    /** sRPE previsto (PSE × minutos). */
    estimatedLoad: integer('estimated_load').notNull(),
    content: jsonb('content').$type<SessionContent>().notNull(),
    ...timestampColumns,
  },
  (t) => [
    unique('uq_plan_sessions_plan_key').on(t.planId, t.key),
    index('idx_plan_sessions_user').on(t.userId),
    checkOneOf('ck_plan_sessions_modality', t.modality, sessionModalitySchema.options),
    checkOneOf('ck_plan_sessions_priority', t.priority, sessionPrioritySchema.options),
  ],
);

/** Uma ocorrência de sessão num dia. */
export const scheduledSessions = pgTable(
  'scheduled_sessions',
  {
    id: primaryKeyColumn(),
    userId: ownerColumn(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => trainingPlans.id, { onDelete: 'cascade' }),
    planSessionId: uuid('plan_session_id')
      .notNull()
      .references(() => planSessions.id, { onDelete: 'cascade' }),
    /** Segunda-feira da semana a que a ocorrência pertence (chave da semana planejada). */
    weekStart: date('week_start').notNull(),
    /** Índice da ocorrência na semana (sessão com frequência 2 tem ocorrências 1 e 2). */
    occurrence: smallint('occurrence').notNull(),
    scheduledOn: date('scheduled_on').notNull(),
    slot: varchar('slot', { length: 16 }).notNull().default('ANY'),
    status: varchar('status', { length: 16 }).notNull().default('PLANNED'),
    changeSource: varchar('change_source', { length: 16 }).notNull().default('PLANNER'),
    /**
     * Ajuste PONTUAL desta ocorrência (hoje só tenho 20 min; troca de exercício só nesta
     * sessão). O plano não muda: a página aplica o ajuste sobre o conteúdo do plano.
     */
    adjustment: jsonb('adjustment').$type<SessionAdjustment>(),
    /** Decisão que causou a última mudança (nula para o agendamento inicial do planejador). */
    decisionId: uuid('decision_id').references(() => coachingDecisions.id, {
      onDelete: 'set null',
    }),
    ...timestampColumns,
  },
  (t) => [
    unique('uq_scheduled_sessions_occurrence').on(t.planSessionId, t.weekStart, t.occurrence),
    index('idx_scheduled_sessions_user_day').on(t.userId, t.scheduledOn),
    checkOneOf('ck_scheduled_sessions_slot', t.slot, daySlotSchema.options),
    checkOneOf('ck_scheduled_sessions_status', t.status, scheduledSessionStatusSchema.options),
    checkOneOf(
      'ck_scheduled_sessions_change_source',
      t.changeSource,
      scheduleChangeSourceSchema.options,
    ),
  ],
);

/** O que foi feito. Pode existir sem agenda (treino fora do plano, esporte externo). */
export const sessionExecutions = pgTable(
  'session_executions',
  {
    id: primaryKeyColumn(),
    userId: ownerColumn(),
    scheduledSessionId: uuid('scheduled_session_id').references(() => scheduledSessions.id, {
      onDelete: 'set null',
    }),
    planSessionId: uuid('plan_session_id').references(() => planSessions.id, {
      onDelete: 'set null',
    }),
    modality: varchar('modality', { length: 16 }).notNull(),
    performedOn: date('performed_on').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('IN_PROGRESS'),
    source: varchar('source', { length: 24 }).notNull(),
    startedAt: eventTimestamp('started_at'),
    finishedAt: eventTimestamp('finished_at'),
    rpe: numeric('rpe', { precision: 3, scale: 1, mode: 'number' }),
    durationMinutes: smallint('duration_minutes'),
    /** sRPE realizado; calculado no fechamento a partir de `rpe` × `duration_minutes`. */
    load: integer('load'),
    enjoyment: smallint('enjoyment'),
    painReports: jsonb('pain_reports')
      .$type<PainReport[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Registro feito depois do dia (não conta como treino "no dia" para adesão). */
    loggedLate: boolean('logged_late').notNull().default(false),
    ...timestampColumns,
  },
  (t) => [
    // Uma execução por ocorrência agendada; execuções avulsas não têm essa restrição.
    uniqueIndex('uq_session_executions_scheduled')
      .on(t.scheduledSessionId)
      .where(sql`${t.scheduledSessionId} is not null`),
    index('idx_session_executions_user_day').on(t.userId, t.performedOn),
    checkOneOf('ck_session_executions_modality', t.modality, sessionModalitySchema.options),
    checkOneOf('ck_session_executions_status', t.status, executionStatusSchema.options),
    checkOneOf('ck_session_executions_source', t.source, executionSourceSchema.options),
  ],
);

/** Séries de força registradas. */
export const executionSets = pgTable(
  'execution_sets',
  {
    id: primaryKeyColumn(),
    userId: ownerColumn(),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => sessionExecutions.id, { onDelete: 'cascade' }),
    exerciseId: varchar('exercise_id', { length: 80 }).notNull(),
    setNumber: smallint('set_number').notNull(),
    reps: smallint('reps'),
    loadKg: numeric('load_kg', { precision: 6, scale: 2, mode: 'number' }),
    durationSeconds: integer('duration_seconds'),
    rir: smallint('rir'),
    completed: boolean('completed').notNull().default(false),
    ...timestampColumns,
  },
  (t) => [
    unique('uq_execution_sets_set').on(t.executionId, t.exerciseId, t.setNumber),
    index('idx_execution_sets_user_exercise').on(t.userId, t.exerciseId),
  ],
);

/** Métricas de corrida/HYROX (uma linha por execução). */
export const executionMetrics = pgTable(
  'execution_metrics',
  {
    id: primaryKeyColumn(),
    userId: ownerColumn(),
    executionId: uuid('execution_id')
      .notNull()
      .unique()
      .references(() => sessionExecutions.id, { onDelete: 'cascade' }),
    metrics: jsonb('metrics').$type<EnduranceMetrics>().notNull(),
    /** O aluno confirmou os números extraídos (obrigatório para print e arquivo). */
    confirmed: boolean('confirmed').notNull().default(false),
    ...timestampColumns,
  },
  (t) => [index('idx_execution_metrics_user').on(t.userId)],
);
