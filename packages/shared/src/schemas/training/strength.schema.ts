import { z } from 'zod';

/** Como a carga de um exercício de força progride. */
export const strengthLoadStrategySchema = z.enum([
  'BODYWEIGHT',
  'FIXED_LOAD',
  'DOUBLE_PROGRESSION',
  'RIR',
]);
export type StrengthLoadStrategy = z.infer<typeof strengthLoadStrategySchema>;

export const strengthTechniqueSchema = z.enum([
  'DROP_SET',
  'REST_PAUSE',
  'CLUSTER_SET',
  'SUPERSET',
  'ISOMETRIC_HOLD',
  'CONTROLLED_TEMPO',
  'PYRAMID',
]);
export type StrengthTechnique = z.infer<typeof strengthTechniqueSchema>;

export const strengthRepsRangeSchema = z
  .object({
    min: z.number().int().min(1).max(100),
    max: z.number().int().min(1).max(100),
  })
  .refine((r) => r.min <= r.max, {
    message: 'O mínimo de repetições não pode ser maior que o máximo.',
  });

/** `reps` XOR `durationSeconds`: isometria e cardio contínuo são prescritos por tempo. */
function repsXorDuration(value: { reps?: unknown; durationSeconds?: unknown }): boolean {
  return (value.reps !== undefined) !== (value.durationSeconds !== undefined);
}
const REPS_XOR_DURATION = { message: 'Informe repetições ou duração, não os dois nem nenhum.' };

export const strengthWarmupBlockSchema = z
  .object({
    sets: z.number().int().min(1).max(6),
    reps: strengthRepsRangeSchema.optional(),
    durationSeconds: z.number().int().min(5).max(900).optional(),
    restSeconds: z.number().int().min(0).max(600).optional(),
  })
  .refine(repsXorDuration, REPS_XOR_DURATION);

/** Um exercício prescrito. `exerciseId` referencia o catálogo (validado no servidor). */
export const strengthExerciseSchema = z
  .object({
    exerciseId: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(120),
    warmup: z.array(strengthWarmupBlockSchema).max(4).optional(),
    sets: z.number().int().min(1).max(12),
    reps: strengthRepsRangeSchema.optional(),
    durationSeconds: z.number().int().min(5).max(3_600).optional(),
    loadStrategy: strengthLoadStrategySchema,
    /** Repetições em reserva ao fim da série (0 = falha concêntrica). */
    rir: z.number().int().min(0).max(5).optional(),
    restSeconds: z.number().int().min(0).max(600),
    technique: strengthTechniqueSchema.optional(),
    /** Grupo de execução conjunta (superset/bi-set): exercícios com o mesmo rótulo alternam. */
    group: z.string().trim().min(1).max(4).optional(),
    notes: z.string().trim().max(400).optional(),
  })
  .refine(repsXorDuration, REPS_XOR_DURATION);
export type StrengthExercise = z.infer<typeof strengthExerciseSchema>;

export const strengthSessionContentSchema = z.object({
  modality: z.literal('STRENGTH'),
  /** Tema da sessão (ex.: "Inferiores — ênfase posterior"). */
  focus: z.string().trim().min(1).max(120),
  exercises: z.array(strengthExerciseSchema).min(1).max(15),
});
export type StrengthSessionContent = z.infer<typeof strengthSessionContentSchema>;
