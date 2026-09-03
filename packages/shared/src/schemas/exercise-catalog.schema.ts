/**
 * Contrato da **base de referência de exercícios** administrável (achado 2026-09-02).
 *
 * Até aqui o catálogo era um array `const` compilado em `exercise-catalog.ts` — a única
 * peça "L0" (travada em código) de todo o pipeline de IA que não tinha equivalente
 * parametrizável na plataforma (metodologia, persona, FAQ, temas proibidos e regras de
 * guardrail já vivem no banco, versionados e editáveis pelo Control Center). Esse desvio
 * também limitava a variedade real de exercícios disponível pra geração: 51 entradas fixas
 * contra o vocabulário de centenas de variações nomeadas da metodologia publicada.
 *
 * Mesmo molde de `faq.schema.ts`: `PUBLISHED`/`RETIRED`, versionado por `exerciseKey`,
 * sem estágio de aprovação separado (o ADMIN publica direto, como o FAQ) — a garantia de
 * segurança clínica continua sendo o `ValidationService`, que lê a mesma base publicada
 * como gabarito, não o fluxo de edição.
 */
import { z } from 'zod';

import { controlCenterMetaSchema } from './control-center.schema';
import { trainingLocationSchema } from './anamnesis.schema';

export const exerciseKeyPattern = /^[a-z][a-z0-9_]{2,60}$/;

export const movementPatternSchema = z.enum([
  'HORIZONTAL_PUSH',
  'VERTICAL_PUSH',
  'HORIZONTAL_PULL',
  'VERTICAL_PULL',
  'SQUAT',
  'HINGE',
  'LUNGE',
  'CORE',
  'CARDIO',
  'ISOLATION',
]);
export type MovementPattern = z.infer<typeof movementPatternSchema>;

export const exerciseLevelSchema = z.enum(['INICIANTE', 'INTERMEDIARIO', 'AVANCADO']);
export type ExerciseLevel = z.infer<typeof exerciseLevelSchema>;

export const contraindicationTagSchema = z.enum([
  'SHOULDER',
  'ELBOW',
  'WRIST',
  'LOWER_BACK',
  'HIP',
  'KNEE',
  'ANKLE',
  'NECK',
  'CARDIAC',
  'BALANCE_FALL_RISK',
  'PREGNANCY',
]);
export type ContraindicationTag = z.infer<typeof contraindicationTagSchema>;

export const exerciseMeasurementSchema = z.enum(['REPS', 'DURATION']);
export type ExerciseMeasurement = z.infer<typeof exerciseMeasurementSchema>;

export const catalogExerciseCandidateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  pattern: movementPatternSchema,
  muscleGroups: z.array(z.string().trim().min(2).max(40)).min(1).max(6),
  equipment: z.array(z.string().trim().min(2).max(40)).max(6),
  locations: z.array(trainingLocationSchema).min(1),
  minLevel: exerciseLevelSchema,
  contraindicatedFor: z.array(contraindicationTagSchema).max(11),
  /** Ids de outras entradas do catálogo, mesmo padrão de movimento. Validado no servidor. */
  substitutes: z.array(z.string().regex(exerciseKeyPattern)).max(10),
  measurement: exerciseMeasurementSchema.optional(),
  durationSecondsRange: z
    .object({ min: z.int().positive(), max: z.int().positive() })
    .refine((r) => r.max >= r.min, 'max deve ser >= min')
    .optional(),
  minRestSeconds: z.int().nonnegative().optional(),
  /**
   * Vídeo de execução curado (achado 2026-09-02, painel "Exercícios"). Quando presente, o
   * `ProtocolGeneratorService` vincula este link automaticamente em todo exercício
   * prescrito com este `exerciseKey` — a IA nunca preenche isso sozinha (evita alucinar
   * URL quebrada, mesma cautela de `protocol.schema.ts#protocolExerciseSchema.videoUrl`).
   */
  videoUrl: z.url().max(500).optional(),
});
export type CatalogExerciseCandidate = z.infer<typeof catalogExerciseCandidateSchema>;

export const publishExerciseCatalogEntrySchema = catalogExerciseCandidateSchema.extend({
  exerciseKey: z.string().regex(exerciseKeyPattern),
  changeNote: z.string().trim().min(5).max(500),
});
export type PublishExerciseCatalogEntryInput = z.infer<typeof publishExerciseCatalogEntrySchema>;

export const retireExerciseCatalogEntrySchema = z.object({
  exerciseKey: z.string().regex(exerciseKeyPattern),
  changeNote: z.string().trim().min(5).max(500),
});
export type RetireExerciseCatalogEntryInput = z.infer<typeof retireExerciseCatalogEntrySchema>;

export const exerciseCatalogEntryVersionSchema = catalogExerciseCandidateSchema.extend({
  id: z.uuid(),
  exerciseKey: z.string(),
  version: z.int().positive(),
  status: z.enum(['PUBLISHED', 'RETIRED']),
  changeNote: z.string(),
  createdBy: z.string().nullable(),
  createdAt: z.iso.datetime(),
  current: z.boolean(),
});
export type ExerciseCatalogEntryVersion = z.infer<typeof exerciseCatalogEntryVersionSchema>;

export const exerciseCatalogResponseSchema = z.object({
  data: z.object({
    versions: z.array(exerciseCatalogEntryVersionSchema),
    totalPublished: z.int().nonnegative(),
  }),
  meta: controlCenterMetaSchema,
});
export type ExerciseCatalogResponse = z.infer<typeof exerciseCatalogResponseSchema>;
