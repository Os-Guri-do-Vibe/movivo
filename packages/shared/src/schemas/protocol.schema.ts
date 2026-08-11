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

import { ProtocolApprovalStatus, ProtocolStatus } from '../enums';
import { generationGoalSchema } from './anamnesis.schema';
import { uuidSchema } from './common.schema';

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

/**
 * Divisão de treino (metodologia do RT CREF, item 1). O RT **não usa divisão fixa**: escolhe
 * conforme objetivo, nível, condicionamento, disponibilidade semanal, histórico de lesão e
 * recuperação. `FOCO_MUSCULAR` = "um ou dois grupos musculares por dia".
 *
 * Opcional no schema: protocolos gerados antes da v2 da metodologia (e o template de fallback)
 * não têm o campo, e ausência não é insegura — o que é inseguro é uma divisão INCOERENTE com o
 * nível, e isso o `ValidationService` (US-2.3) veta quando o campo está presente.
 */
export const workoutSplitSchema = z.enum([
  'FULL_BODY',
  'CIRCUITO',
  'UPPER_LOWER',
  'ABC',
  'ABCD',
  'ABCDE',
  'PUSH_PULL_LEGS',
  'FOCO_MUSCULAR',
]);
export type WorkoutSplit = z.infer<typeof workoutSplitSchema>;

/**
 * Técnica avançada por exercício (metodologia do RT CREF, item 4). O RT foi explícito:
 * são "principalmente para intermediários e avançados" e "não precisam aparecer em todos os
 * exercícios ou em todos os treinos". Opcional/ausente = série tradicional (o padrão).
 */
export const advancedTechniqueSchema = z.enum([
  'DROP_SET',
  'REST_PAUSE',
  'CLUSTER_SET',
  'BI_SET',
  'TRI_SET',
  'SUPERSET',
  'ISOMETRIA',
  'REPETICOES_CONTROLADAS',
  'PIRAMIDE',
  'DESCANSO_ATIVO',
]);
export type AdvancedTechnique = z.infer<typeof advancedTechniqueSchema>;

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
  /** Técnica avançada aplicada nesta prescrição. Ausente = série tradicional. */
  technique: advancedTechniqueSchema.optional(),
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
  goal: generationGoalSchema,
  phase: trainingPhaseSchema,
  /** Divisão escolhida para este perfil. Ausente em protocolos anteriores à metodologia v2. */
  splitType: workoutSplitSchema.optional(),
  weeklyFrequency: z.number().int().min(1).max(7),
  sessions: z.array(protocolSessionSchema).min(1).max(7),
  generalNotes: z.string().trim().max(1000).optional(),
});
export type ProtocolStructure = z.infer<typeof protocolStructureSchema>;

/**
 * DTO de LEITURA read-only por token (US-2.6). É o que o endpoint público
 * `GET /protocols/by-token/:token` devolve e o que a página `/protocolo/[token]`
 * renderiza. Nunca inclui `userId`/PII: o token (UUID do protocolo) é o único
 * segredo, e a projeção do repositório não seleciona a coluna de titular (IDOR-safe).
 */
export const protocolReadSchema = z.object({
  content: protocolStructureSchema,
  status: z.enum(ProtocolStatus),
  approvalStatus: z.enum(ProtocolApprovalStatus),
  professionalId: uuidSchema.nullable(),
  signatureHash: z.string().trim().min(1).nullable(),
  signedAt: z.iso.datetime().nullable(),
  totalWeeks: z.number().int().min(1).max(52),
  currentWeek: z.number().int().min(1).max(52),
});
export type ProtocolRead = z.infer<typeof protocolReadSchema>;
