/**
 * `workout_schedule_adjustments` — ajustes de agenda pedidos pelo aluno ao Coach.
 *
 * O protocolo (sessões A/B/C, assinado pelo CREF) diz O QUE treinar; o calendário padrão
 * (`workout-schedule.ts`) diz EM QUE DIA da semana. Esta tabela é a terceira camada: quando
 * o aluno pede "hoje eu consigo treinar o A" ou "amanhã quero descansar", o servidor calcula o
 * novo arranjo (`schedule-planner.ts`, determinístico) e grava aqui. O conteúdo prescrito e a
 * assinatura do profissional não mudam.
 *
 * ## Só inserção, e o ajuste expira sozinho
 * Cada linha guarda, por DATA, o que passa a valer (`assignments`). O calendário efetivo de um
 * dia é o do último ajuste ativo que cita a data; sem ajuste, o calendário padrão. Como as
 * datas são absolutas, o ajuste vale só para a semana em que foi pedido: na segunda seguinte o
 * calendário padrão volta sem nenhuma rotina de limpeza.
 *
 * Desfazer não apaga: marca `undone_at`, e o resolvedor ignora a linha.
 *
 * ## Sem texto livre
 * O pedido do aluno fica em `conversations` (cifrado). Aqui só há datas e chaves de sessão.
 *
 * `LATE_LOG` (registro tardio) é o único tipo que cita datas passadas: o treino foi feito num
 * dia diferente do previsto e o calendário precisa concordar com o histórico.
 */
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, unique, uuid, varchar } from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { protocols } from './protocols';
import { users } from './users';

export type ScheduleAdjustmentKind = 'TRAIN_ON' | 'REST_ON' | 'REORGANIZE' | 'LATE_LOG';
export type ScheduleAdjustmentSource = 'CHAT' | 'LATE_LOG';

/** `sessionKey = null` é descanso. `from` é o que valia antes (auditoria e desfazer). */
export interface ScheduleAssignment {
  date: string;
  sessionKey: string | null;
  from: string | null;
}

export const workoutScheduleAdjustments = pgTable(
  'workout_schedule_adjustments',
  {
    id: primaryKeyColumn(),

    /** `RESTRICT`: compõe o histórico de acompanhamento supervisionado, como `workout_sessions`. */
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    protocolId: uuid('protocol_id')
      .notNull()
      .references(() => protocols.id, { onDelete: 'restrict' }),

    kind: varchar('kind', { length: 16 }).$type<ScheduleAdjustmentKind>().notNull(),
    source: varchar('source', { length: 12 }).$type<ScheduleAdjustmentSource>().notNull(),

    /** Datas afetadas e o novo valor de cada uma. */
    assignments: jsonb('assignments').$type<ScheduleAssignment[]>().notNull(),

    /** Chaves de sessão que o aluno escolheu deixar de fora da semana (não contam como falta). */
    dropped: jsonb('dropped').$type<string[]>().notNull().default([]),

    /** Idempotência: o retry do job de resposta não aplica o mesmo pedido duas vezes. */
    idempotencyKey: varchar('idempotency_key', { length: 80 }),

    undoneAt: eventTimestamp('undone_at'),

    ...timestampColumns,
  },
  (table) => [
    unique('uq_workout_schedule_adjustments_idempotency').on(table.userId, table.idempotencyKey),
    // Leitura quente: ajustes ativos do aluno, na ordem em que valem.
    index('idx_workout_schedule_adjustments_user_active')
      .on(table.userId, table.createdAt)
      .where(sql`${table.undoneAt} is null`),
    check(
      'ck_workout_schedule_adjustments_kind',
      sql`${table.kind} in ('TRAIN_ON','REST_ON','REORGANIZE','LATE_LOG')`,
    ),
    check('ck_workout_schedule_adjustments_source', sql`${table.source} in ('CHAT','LATE_LOG')`),
  ],
);

export type WorkoutScheduleAdjustmentRow = typeof workoutScheduleAdjustments.$inferSelect;
export type NewWorkoutScheduleAdjustmentRow = typeof workoutScheduleAdjustments.$inferInsert;
