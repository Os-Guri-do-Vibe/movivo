/**
 * Protocolo de treino — DTO de contrato (US-2.1 / TASK-2.1.2).
 *
 * Fonte única de verdade do shape do `ProtocolStructure` — a saída da geração por IA
 * (US-2.1), o que o `ValidationService` (US-2.3) veta, o que o Worker (US-2.4) persiste
 * e o que a página read-only (US-2.6) renderiza.
 *
 * Decisão do fundador (2026-07): o protocolo é **planejado pela IA** (não por um motor
 * determinístico), com autonomia para individualizar, mas restrito ao vocabulário da
 * base de referência e sob a metodologia do RT CREF. A **garantia** de segurança é do
 * `ValidationService` (US-2.3), não deste schema — aqui só garantimos a FORMA (parseável
 * e tipada); a semântica segura (exercício existe, carga plausível) é vetada na US-2.3.
 */
import { z } from 'zod';

import { primaryGoalSchema } from './anamnesis.schema';

/**
 * Fase de periodização (Rafael §5.2 `TrainingPhase`). A IA escolhe a fase inicial
 * coerente com objetivo/nível; a progressão entre fases é da geração/ajuste futuro.
 */
export const trainingPhaseSchema = z.enum(['ADAPTACAO', 'HIPERTROFIA', 'FORCA', 'DELOAD']);
export type TrainingPhase = z.infer<typeof trainingPhaseSchema>;

/**
 * Estratégia de carga (Rafael §5.2 `WeightStrategy`). `DOUBLE_PROGRESSION` = sobe repetição
 * até o topo da faixa, depois sobe carga (dupla progressão). `RPE` = por percepção de esforço.
 */
export const loadStrategySchema = z.enum(['BODYWEIGHT', 'FIXED_LOAD', 'DOUBLE_PROGRESSION', 'RPE']);
export type LoadStrategy = z.infer<typeof loadStrategySchema>;

/** Faixa de repetições (Rafael §5.2 `RepsRange`). `min <= max` validado no superRefine. */
export const repsRangeSchema = z
  .object({
    min: z.number().int().min(1).max(100),
    max: z.number().int().min(1).max(100),
  })
  .refine((r) => r.min <= r.max, { message: 'repsRange.min não pode ser maior que max.' });
export type RepsRange = z.infer<typeof repsRangeSchema>;

/**
 * Um exercício prescrito na sessão. `exerciseId` referencia a base de referência
 * (o validador US-2.3 rejeita id fora do catálogo — aqui é só string tipada).
 */
export const protocolExerciseSchema = z.object({
  exerciseId: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  sets: z.number().int().min(1).max(12),
  reps: repsRangeSchema,
  loadStrategy: loadStrategySchema,
  restSeconds: z.number().int().min(0).max(600),
  notes: z.string().trim().max(400).optional(),
});
export type ProtocolExercise = z.infer<typeof protocolExerciseSchema>;

/** Uma sessão de treino (um "dia"). `focus` = grupo/tema (ex.: "Membros inferiores"). */
export const protocolSessionSchema = z.object({
  dayLabel: z.string().trim().min(1).max(60),
  focus: z.string().trim().min(1).max(120),
  exercises: z.array(protocolExerciseSchema).min(1).max(15),
});
export type ProtocolSession = z.infer<typeof protocolSessionSchema>;

/**
 * O protocolo completo gerado. `promptVersion`/`generatedByModel` dão rastreabilidade
 * clínica da geração (qual metodologia/modelo produziu este treino).
 */
export const protocolStructureSchema = z.object({
  promptVersion: z.string().trim().min(1).max(80),
  goal: primaryGoalSchema,
  phase: trainingPhaseSchema,
  weeklyFrequency: z.number().int().min(1).max(7),
  sessions: z.array(protocolSessionSchema).min(1).max(7),
  generalNotes: z.string().trim().max(1000).optional(),
});
export type ProtocolStructure = z.infer<typeof protocolStructureSchema>;
