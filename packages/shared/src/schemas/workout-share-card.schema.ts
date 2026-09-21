import { z } from 'zod';

export const shareCardMuscleSchema = z.enum([
  'chest',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'obliques',
  'upper_back',
  'lats',
  'lower_back',
  'glutes',
  'quads',
  'hamstrings',
  'calves',
]);
export type ShareCardMuscle = z.infer<typeof shareCardMuscleSchema>;

export const workoutShareCardDataSchema = z.object({
  user: z.object({ name: z.string().min(1).max(80), gender: z.enum(['male', 'female']) }),
  workout: z.object({
    name: z.string().max(160).optional(),
    durationMinutes: z.number().finite().min(0).max(720),
    trainedMuscles: z.array(z.string().min(1).max(40)).max(180),
    muscleGroupsForHighlighter: z.array(shareCardMuscleSchema).max(14),
    completedAt: z.iso.datetime(),
  }),
});
export type WorkoutShareCardData = z.infer<typeof workoutShareCardDataSchema>;
