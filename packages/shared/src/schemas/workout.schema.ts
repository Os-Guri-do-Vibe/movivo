import { z } from 'zod';

import { protocolSessionSchema } from './protocol.schema';
import { uuidSchema } from './common.schema';

export const workoutDateSchema = z.iso.date();
export const workoutLoadUnitSchema = z.enum(['KG', 'LB', 'BODYWEIGHT', 'NONE']);

export const workoutSetInputSchema = z
  .object({
    exerciseId: z.string().trim().min(1).max(80),
    setNumber: z.number().int().min(1).max(20),
    reps: z.number().int().min(0).max(300).nullable().optional(),
    loadValue: z.number().min(0).max(2000).nullable().optional(),
    loadUnit: workoutLoadUnitSchema.default('KG'),
    durationSeconds: z.number().int().min(0).max(14_400).nullable().optional(),
    completed: z.boolean().default(false),
    skipped: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.completed && value.skipped) {
      ctx.addIssue({
        code: 'custom',
        path: ['skipped'],
        message: 'Serie nao pode ser feita e pulada.',
      });
    }
    if (
      value.skipped &&
      (value.reps != null || value.loadValue != null || value.durationSeconds != null)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['skipped'],
        message: 'Serie pulada nao pode conter valores realizados.',
      });
    }
  });
export type WorkoutSetInput = z.infer<typeof workoutSetInputSchema>;

export const saveWorkoutSetsSchema = z.object({
  entries: z.array(workoutSetInputSchema).max(300),
});

export const finishWorkoutSchema = z
  .object({
    perceivedEffort: z.number().int().min(1).max(10),
    feelingNotes: z.string().trim().max(1000).default(''),
    painReported: z.boolean().default(false),
    painExerciseId: z.string().trim().min(1).max(80).nullable().optional(),
    painNotes: z.string().trim().max(1000).default(''),
  })
  .superRefine((value, ctx) => {
    if (value.painReported && !value.painExerciseId) {
      ctx.addIssue({ code: 'custom', path: ['painExerciseId'], message: 'Selecione o exercício.' });
    }
    if (value.painReported && value.painNotes.length < 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['painNotes'],
        message: 'Descreva brevemente o que sentiu.',
      });
    }
  });
export type FinishWorkoutInput = z.infer<typeof finishWorkoutSchema>;

export const workoutPreferencesSchema = z.object({
  reminderTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  reminderEnabled: z.boolean().optional(),
});
export type WorkoutPreferencesInput = z.infer<typeof workoutPreferencesSchema>;

export const workoutSetViewSchema = workoutSetInputSchema.safeExtend({
  previous: z
    .object({
      reps: z.number().int().min(0).max(300).nullable().optional(),
      loadValue: z.number().min(0).max(2000).nullable().optional(),
      loadUnit: workoutLoadUnitSchema,
      durationSeconds: z.number().int().min(0).max(14_400).nullable().optional(),
      date: workoutDateSchema,
    })
    .nullable(),
});

export const workoutDayStateSchema = z.enum([
  'FUTURE',
  'REST',
  'PLANNED',
  'IN_PROGRESS',
  'COMPLETED',
  'MISSED',
]);

export const workoutJournalSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  today: workoutDateSchema,
  selectedDate: workoutDateSchema,
  week: z.array(
    z.object({ date: workoutDateSchema, weekday: z.string(), state: workoutDayStateSchema }),
  ),
  workout: z
    .object({
      id: uuidSchema,
      status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED']),
      prescription: protocolSessionSchema,
      startedAt: z.iso.datetime().nullable(),
      finishedAt: z.iso.datetime().nullable(),
      durationSeconds: z.number().int().nonnegative().nullable(),
      perceivedEffort: z.number().int().min(1).max(10).nullable(),
      painReported: z.boolean(),
      sets: z.array(workoutSetViewSchema),
    })
    .nullable(),
});
export type WorkoutJournal = z.infer<typeof workoutJournalSchema>;
