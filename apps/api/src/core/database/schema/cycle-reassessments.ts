/**
 * Reavaliação de fim de ciclo: no dia em que o protocolo vence o aluno recebe um link com um
 * formulário; as respostas e a análise dos agentes (comparando o começo com o agora) alimentam o
 * protocolo do próximo ciclo, que segue pela Fila do Profissional. Respostas e análise são
 * cifradas (podem conter saúde). Uma linha por aluno e ciclo.
 */
import { date, index, pgTable, unique, uuid, varchar } from 'drizzle-orm/pg-core';

import {
  bytea,
  checkOneOf,
  eventTimestamp,
  primaryKeyColumn,
  timestampColumns,
  userIdColumn,
} from './_shared';
import { nutritionPlans } from './nutrition';
import { trainingPlans } from './training';
import { users } from './users';

export const REASSESSMENT_STATUSES = [
  'SENT',
  'SUBMITTED',
  'ANALYZED',
  'PLANNED',
  'FAILED',
] as const;
export type ReassessmentStatus = (typeof REASSESSMENT_STATUSES)[number];

export const cycleReassessments = pgTable(
  'cycle_reassessments',
  {
    id: primaryKeyColumn(),
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Protocolos que venceram (qualquer um dos dois pode faltar). */
    trainingPlanId: uuid('training_plan_id').references(() => trainingPlans.id, {
      onDelete: 'set null',
    }),
    nutritionPlanId: uuid('nutrition_plan_id').references(() => nutritionPlans.id, {
      onDelete: 'set null',
    }),
    cycleEndedOn: date('cycle_ended_on').notNull(),
    status: varchar('status', { length: 12 }).notNull().default('SENT'),
    sentAt: eventTimestamp('sent_at').notNull().defaultNow(),
    submittedAt: eventTimestamp('submitted_at'),
    /** `CycleReassessmentAnswers` em JSON cifrado. */
    answers: bytea('answers'),
    /** Análise dos agentes (JSON cifrado). */
    analysis: bytea('analysis'),
    nextTrainingPlanId: uuid('next_training_plan_id').references(() => trainingPlans.id, {
      onDelete: 'set null',
    }),
    nextNutritionPlanId: uuid('next_nutrition_plan_id').references(() => nutritionPlans.id, {
      onDelete: 'set null',
    }),
    failureReason: varchar('failure_reason', { length: 200 }),
    ...timestampColumns,
  },
  (t) => [
    unique('uq_cycle_reassessments_cycle').on(t.userId, t.cycleEndedOn),
    index('idx_cycle_reassessments_user').on(t.userId, t.cycleEndedOn),
    checkOneOf('ck_cycle_reassessments_status', t.status, REASSESSMENT_STATUSES),
  ],
);
