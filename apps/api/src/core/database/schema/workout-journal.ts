/**
 * Diário de execução do treino. O protocolo continua sendo a prescrição assinada;
 * estas tabelas registram apenas o que o aluno efetivamente realizou.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
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
import type { ProtocolSession } from '@movivo/shared';

import { bytea, eventTimestamp, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { protocols } from './protocols';
import { users } from './users';

export const workoutSessions = pgTable(
  'workout_sessions',
  {
    id: primaryKeyColumn(),
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    protocolId: uuid('protocol_id')
      .notNull()
      .references(() => protocols.id, { onDelete: 'restrict' }),
    protocolVersion: smallint('protocol_version').notNull(),
    weekNumber: smallint('week_number').notNull(),
    sessionKey: varchar('session_key', { length: 60 }).notNull(),
    scheduledDate: date('scheduled_date').notNull(),
    /** Snapshot imutável da prescrição válida para este dia. */
    prescription: jsonb('prescription').$type<ProtocolSession>().notNull(),
    status: varchar('status', { length: 20 })
      .$type<'PLANNED' | 'IN_PROGRESS' | 'COMPLETED'>()
      .notNull()
      .default('PLANNED'),
    startedAt: eventTimestamp('started_at'),
    finishedAt: eventTimestamp('finished_at'),
    durationSeconds: integer('duration_seconds'),
    perceivedEffort: smallint('perceived_effort'),
    /** Texto livre de sensação/dor cifrado com a mesma chave dos check-ins. */
    feedbackCipher: bytea('feedback_cipher'),
    painReported: boolean('pain_reported').notNull().default(false),
    painExerciseId: varchar('pain_exercise_id', { length: 80 }),
    ...timestampColumns,
  },
  (table) => [
    unique('uq_workout_sessions_user_day_session').on(
      table.userId,
      table.scheduledDate,
      table.sessionKey,
    ),
    index('idx_workout_sessions_user_date').on(table.userId, table.scheduledDate),
    check('ck_workout_sessions_week', sql`${table.weekNumber} between 1 and 52`),
    check(
      'ck_workout_sessions_status',
      sql`${table.status} in ('PLANNED', 'IN_PROGRESS', 'COMPLETED')`,
    ),
    check(
      'ck_workout_sessions_effort',
      sql`${table.perceivedEffort} is null or ${table.perceivedEffort} between 1 and 10`,
    ),
    check(
      'ck_workout_sessions_duration',
      sql`${table.durationSeconds} is null or ${table.durationSeconds} between 0 and 43200`,
    ),
  ],
);

export const workoutSetEntries = pgTable(
  'workout_set_entries',
  {
    id: primaryKeyColumn(),
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    workoutSessionId: uuid('workout_session_id')
      .notNull()
      .references(() => workoutSessions.id, { onDelete: 'restrict' }),
    exerciseId: varchar('exercise_id', { length: 80 }).notNull(),
    setNumber: smallint('set_number').notNull(),
    reps: smallint('reps'),
    loadValue: numeric('load_value', { precision: 7, scale: 2 }),
    loadUnit: varchar('load_unit', { length: 12 })
      .$type<'KG' | 'LB' | 'BODYWEIGHT' | 'NONE'>()
      .notNull()
      .default('KG'),
    durationSeconds: integer('duration_seconds'),
    completed: boolean('completed').notNull().default(false),
    skipped: boolean('skipped').notNull().default(false),
    ...timestampColumns,
  },
  (table) => [
    unique('uq_workout_set_entries_session_exercise_set').on(
      table.workoutSessionId,
      table.exerciseId,
      table.setNumber,
    ),
    index('idx_workout_set_entries_user_exercise').on(table.userId, table.exerciseId),
    check('ck_workout_set_entries_set', sql`${table.setNumber} between 1 and 20`),
    check(
      'ck_workout_set_entries_reps',
      sql`${table.reps} is null or ${table.reps} between 0 and 300`,
    ),
    check(
      'ck_workout_set_entries_load',
      sql`${table.loadValue} is null or ${table.loadValue} between 0 and 2000`,
    ),
    check(
      'ck_workout_set_entries_duration',
      sql`${table.durationSeconds} is null or ${table.durationSeconds} between 0 and 14400`,
    ),
    check(
      'ck_workout_set_entries_unit',
      sql`${table.loadUnit} in ('KG', 'LB', 'BODYWEIGHT', 'NONE')`,
    ),
    check('ck_workout_set_entries_outcome', sql`not (${table.completed} and ${table.skipped})`),
  ],
);

/** Tokens de bootstrap (WhatsApp) e sessões passwordless. Só o SHA-256 é persistido. */
export const workoutAccessTokens = pgTable(
  'workout_access_tokens',
  {
    id: primaryKeyColumn(),
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    workoutSessionId: uuid('workout_session_id').references(() => workoutSessions.id, {
      onDelete: 'restrict',
    }),
    kind: varchar('kind', { length: 12 }).$type<'MAGIC' | 'SESSION'>().notNull(),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    expiresAt: eventTimestamp('expires_at').notNull(),
    consumedAt: eventTimestamp('consumed_at'),
    revokedAt: eventTimestamp('revoked_at'),
    lastUsedAt: eventTimestamp('last_used_at'),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex('uq_workout_access_tokens_hash').on(table.tokenHash),
    index('idx_workout_access_tokens_user').on(table.userId, table.expiresAt),
    check('ck_workout_access_tokens_kind', sql`${table.kind} in ('MAGIC', 'SESSION')`),
  ],
);

/** Insights determinísticos e deduplicados; começa pelo desvio de duração semanal. */
export const workoutInsights = pgTable(
  'workout_insights',
  {
    id: primaryKeyColumn(),
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    kind: varchar('kind', { length: 50 }).$type<'DURATION_OVER_PREFERENCE'>().notNull(),
    windowStartedAt: date('window_started_at').notNull(),
    observedValue: integer('observed_value').notNull(),
    expectedValue: integer('expected_value').notNull(),
    status: varchar('status', { length: 20 })
      .$type<'SENT' | 'ADJUST_REQUESTED' | 'ACKNOWLEDGED'>()
      .notNull()
      .default('SENT'),
    respondedAt: eventTimestamp('responded_at'),
    ...timestampColumns,
  },
  (table) => [
    unique('uq_workout_insights_user_kind_window').on(
      table.userId,
      table.kind,
      table.windowStartedAt,
    ),
    index('idx_workout_insights_user').on(table.userId, table.createdAt),
    check(
      'ck_workout_insights_status',
      sql`${table.status} in ('SENT', 'ADJUST_REQUESTED', 'ACKNOWLEDGED')`,
    ),
  ],
);

export type WorkoutSessionRow = typeof workoutSessions.$inferSelect;
export type WorkoutSetEntryRow = typeof workoutSetEntries.$inferSelect;
