/**
 * Estado do Aluno — a representação longitudinal de cada pessoa que os agentes consultam.
 *
 * Separa, de propósito, o que o aluno DECLAROU (perfil, objetivo, restrições, preferências
 * declaradas), o que os eventos MOSTRARAM (observações) e o que o sistema INFERIU
 * (preferências `INFERRED`, sempre com confiança). Uma inferência nunca vira fato em silêncio:
 * cada linha guarda origem e data, e mudanças criam linha nova (a anterior ganha
 * `superseded_at`) em vez de sobrescrever.
 *
 * Todas as tabelas daqui são dado de titular sob FORCE RLS (`security-policies.ts`). Dado de
 * saúde só existe cifrado (`student_health_records.payload`, `HealthCipherService`).
 */
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import {
  constraintKindSchema,
  goalStatusSchema,
  goalTaskKindSchema,
  goalTaskStatusSchema,
  healthRecordKindSchema,
  informationOriginSchema,
  milestoneStatusSchema,
  preferenceDomainSchema,
  preferenceStrengthSchema,
  type DeclaredGoal,
  type GoalMilestone,
  type GoalStrategy,
  type StudentConstraint,
  type StudentObservation,
  type StudentProfile,
} from '@movivo/shared';

import {
  bytea,
  checkOneOf,
  eventTimestamp,
  primaryKeyColumn,
  timestampColumns,
  userIdColumn,
} from './_shared';
import { coachingDecisions } from './coaching';
import { users } from './users';

const ownerColumn = () =>
  userIdColumn()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

/** Perfil estável (1 por aluno), versionado por contador para leitura otimista. */
export const studentProfiles = pgTable('student_profiles', {
  id: primaryKeyColumn(),
  userId: ownerColumn().unique(),
  profile: jsonb('profile').$type<StudentProfile>().notNull(),
  version: integer('version').notNull().default(1),
  ...timestampColumns,
});

/**
 * Registros de saúde (PAR-Q, condições, lesões, medicamentos…). `payload` é o `bytea` do
 * `pgp_sym_encrypt` de um `HealthRecordPayload` — nunca JSON em claro.
 */
export const studentHealthRecords = pgTable(
  'student_health_records',
  {
    id: primaryKeyColumn(),
    userId: ownerColumn(),
    kind: varchar('kind', { length: 32 }).notNull(),
    payload: bytea('payload').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('ACTIVE'),
    origin: varchar('origin', { length: 16 }).notNull(),
    recordedAt: eventTimestamp('recorded_at').notNull().defaultNow(),
    resolvedAt: eventTimestamp('resolved_at'),
    ...timestampColumns,
  },
  (t) => [
    index('idx_student_health_records_user').on(t.userId, t.status),
    checkOneOf('ck_student_health_records_kind', t.kind, healthRecordKindSchema.options),
    checkOneOf('ck_student_health_records_status', t.status, ['ACTIVE', 'RESOLVED']),
    checkOneOf('ck_student_health_records_origin', t.origin, informationOriginSchema.options),
  ],
);

/** Objetivo declarado + estratégia escolhida pelo Motor de Objetivos (versionados). */
export const studentGoals = pgTable(
  'student_goals',
  {
    id: primaryKeyColumn(),
    userId: ownerColumn(),
    version: integer('version').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('ACTIVE'),
    declared: jsonb('declared').$type<DeclaredGoal>().notNull(),
    /** Nula até o Motor de Objetivos decidir; a decisão fica em `strategy_decision_id`. */
    strategy: jsonb('strategy').$type<GoalStrategy>(),
    strategyDecisionId: uuid('strategy_decision_id').references(() => coachingDecisions.id, {
      onDelete: 'set null',
    }),
    startedOn: date('started_on').notNull(),
    reviewOn: date('review_on'),
    ...timestampColumns,
  },
  (t) => [
    unique('uq_student_goals_user_version').on(t.userId, t.version),
    index('idx_student_goals_user_status').on(t.userId, t.status),
    checkOneOf('ck_student_goals_status', t.status, goalStatusSchema.options),
  ],
);

export const goalMilestones = pgTable(
  'goal_milestones',
  {
    id: primaryKeyColumn(),
    userId: ownerColumn(),
    goalId: uuid('goal_id')
      .notNull()
      .references(() => studentGoals.id, { onDelete: 'cascade' }),
    ordinal: smallint('ordinal').notNull(),
    milestone: jsonb('milestone').$type<GoalMilestone>().notNull(),
    dueOn: date('due_on').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('PENDING'),
    /** Evidência da conclusão/perda (ids de medidas, execuções, check-ins). */
    evidence: jsonb('evidence')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    resolvedAt: eventTimestamp('resolved_at'),
    ...timestampColumns,
  },
  (t) => [
    unique('uq_goal_milestones_goal_ordinal').on(t.goalId, t.ordinal),
    index('idx_goal_milestones_user').on(t.userId, t.status),
    checkOneOf('ck_goal_milestones_status', t.status, milestoneStatusSchema.options),
  ],
);

/** Microtarefa numa janela (dia/semana). Concluída por EVENTO, nunca só por declaração. */
export const goalTasks = pgTable(
  'goal_tasks',
  {
    id: primaryKeyColumn(),
    userId: ownerColumn(),
    goalId: uuid('goal_id')
      .notNull()
      .references(() => studentGoals.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 32 }).notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    windowStart: date('window_start').notNull(),
    windowEnd: date('window_end').notNull(),
    target: smallint('target').notNull(),
    progress: smallint('progress').notNull().default(0),
    status: varchar('status', { length: 16 }).notNull().default('OPEN'),
    completedAt: eventTimestamp('completed_at'),
    ...timestampColumns,
  },
  (t) => [
    unique('uq_goal_tasks_window').on(t.goalId, t.kind, t.windowStart),
    index('idx_goal_tasks_user_window').on(t.userId, t.windowEnd),
    checkOneOf('ck_goal_tasks_kind', t.kind, goalTaskKindSchema.options),
    checkOneOf('ck_goal_tasks_status', t.status, goalTaskStatusSchema.options),
  ],
);

/** Restrições (disponibilidade, movimento, equipamento, alimentação). Append-only. */
export const studentConstraints = pgTable(
  'student_constraints',
  {
    id: primaryKeyColumn(),
    userId: ownerColumn(),
    kind: varchar('kind', { length: 32 }).notNull(),
    constraint: jsonb('constraint').$type<StudentConstraint>().notNull(),
    origin: varchar('origin', { length: 16 }).notNull(),
    validFrom: date('valid_from').notNull(),
    validUntil: date('valid_until'),
    supersededAt: eventTimestamp('superseded_at'),
    ...timestampColumns,
  },
  (t) => [
    index('idx_student_constraints_user_active')
      .on(t.userId, t.kind)
      .where(sql`${t.supersededAt} is null`),
    checkOneOf('ck_student_constraints_kind', t.kind, constraintKindSchema.options),
    checkOneOf('ck_student_constraints_origin', t.origin, informationOriginSchema.options),
  ],
);

export const studentPreferences = pgTable(
  'student_preferences',
  {
    id: primaryKeyColumn(),
    userId: ownerColumn(),
    domain: varchar('domain', { length: 32 }).notNull(),
    key: varchar('key', { length: 80 }).notNull(),
    value: jsonb('value').$type<string | number>().notNull(),
    strength: varchar('strength', { length: 16 }).notNull(),
    origin: varchar('origin', { length: 16 }).notNull(),
    confidence: smallint('confidence').notNull(),
    /** Ids de eventos/observações que sustentam a preferência. */
    evidence: jsonb('evidence')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    supersededAt: eventTimestamp('superseded_at'),
    ...timestampColumns,
  },
  (t) => [
    index('idx_student_preferences_user_active')
      .on(t.userId, t.domain, t.key)
      .where(sql`${t.supersededAt} is null`),
    checkOneOf('ck_student_preferences_domain', t.domain, preferenceDomainSchema.options),
    checkOneOf('ck_student_preferences_strength', t.strength, preferenceStrengthSchema.options),
    checkOneOf('ck_student_preferences_origin', t.origin, informationOriginSchema.options),
    // Regra do Estado do Aluno repetida no banco: inferência não vira obrigatória sozinha.
    check(
      'ck_student_preferences_inferred_not_required',
      sql`not (${t.origin} = 'INFERRED' and ${t.strength} = 'REQUIRED')`,
    ),
  ],
);

/** Fatos derivados de eventos reais, com os eventos de origem. */
export const studentObservations = pgTable(
  'student_observations',
  {
    id: primaryKeyColumn(),
    userId: ownerColumn(),
    observation: jsonb('observation').$type<StudentObservation>().notNull(),
    sourceEventIds: jsonb('source_event_ids').$type<string[]>().notNull(),
    observedAt: eventTimestamp('observed_at').notNull().defaultNow(),
    validUntil: eventTimestamp('valid_until'),
    ...timestampColumns,
  },
  (t) => [index('idx_student_observations_user').on(t.userId, t.observedAt)],
);

/**
 * Projeção materializada do Estado do Aluno para leitura rápida pelos agentes. Não é fonte da
 * verdade: é recalculada por evento e pode ser apagada e reconstruída a qualquer momento.
 */
export const studentStateSnapshots = pgTable('student_state_snapshots', {
  id: primaryKeyColumn(),
  userId: ownerColumn().unique(),
  version: integer('version').notNull(),
  state: jsonb('state').$type<Record<string, unknown>>().notNull(),
  computedAt: eventTimestamp('computed_at').notNull().defaultNow(),
  ...timestampColumns,
});
