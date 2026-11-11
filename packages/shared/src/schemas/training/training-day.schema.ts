import { z } from 'zod';

import { executionViewSchema } from './execution.schema';
import { sessionModalitySchema } from './modality.schema';
import {
  daySlotSchema,
  scheduledSessionStatusSchema,
  sessionContentSchema,
  sessionPrioritySchema,
} from './plan.schema';

/** Uma sessão agendada do dia, com o conteúdo completo e o que já foi registrado. */
export const trainingDaySessionSchema = z.object({
  scheduledSessionId: z.uuid(),
  planSessionKey: z.string(),
  title: z.string(),
  purpose: z.string(),
  modality: sessionModalitySchema,
  priority: sessionPrioritySchema,
  estimatedMinutes: z.number().int(),
  estimatedRpe: z.number(),
  scheduledOn: z.iso.date(),
  slot: daySlotSchema,
  status: scheduledSessionStatusSchema,
  content: sessionContentSchema,
  execution: executionViewSchema.nullable(),
});
export type TrainingDaySession = z.infer<typeof trainingDaySessionSchema>;

/** A semana (segunda a domingo) em que o dia selecionado está, um item por sessão agendada. */
export const trainingWeekDaySchema = z.object({
  date: z.iso.date(),
  sessions: z.array(
    z.object({
      scheduledSessionId: z.uuid(),
      title: z.string(),
      modality: sessionModalitySchema,
      status: scheduledSessionStatusSchema,
    }),
  ),
});

/** O diário do aluno: a semana e o detalhe do dia selecionado. */
export const trainingDaySchema = z.object({
  firstName: z.string().nullable(),
  today: z.iso.date(),
  date: z.iso.date(),
  week: z.array(trainingWeekDaySchema).length(7),
  selected: z.array(trainingDaySessionSchema),
  hasPlan: z.boolean(),
});
export type TrainingDay = z.infer<typeof trainingDaySchema>;
