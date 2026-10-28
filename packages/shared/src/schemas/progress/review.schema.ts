import { z } from 'zod';

/** Números de uma semana fechada (segunda a domingo) usados na revisão semanal. */
export const weekMetricsSchema = z.object({
  weekStart: z.iso.date(),
  planned: z.number().int().min(0),
  done: z.number().int().min(0),
  missed: z.number().int().min(0),
  keyPlanned: z.number().int().min(0),
  keyDone: z.number().int().min(0),
  /** Soma do sRPE (PSE × minutos) das sessões concluídas. */
  load: z.number().min(0),
  avgRpe: z.number().min(0).max(10).nullable(),
  painReports: z.number().int().min(0),
  /** Dias da semana com alimentação confirmada. */
  foodLogDays: z.number().int().min(0).max(7),
  weightKg: z.number().nullable(),
});
export type WeekMetrics = z.infer<typeof weekMetricsSchema>;

export const reviewSignalKindSchema = z.enum([
  'ADHERENCE_LOW',
  'KEY_SESSIONS_SKIPPED',
  'EFFORT_HIGH',
  'LOAD_SPIKE',
  'WEIGHT_PLATEAU',
  'WEIGHT_WRONG_DIRECTION',
  'WEIGHT_RAPID_CHANGE',
  'NUTRITION_UNDERLOGGED',
  'PAIN_REPORTED',
]);
export type ReviewSignalKind = z.infer<typeof reviewSignalKindSchema>;

/** Fato derivado dos números (determinístico): é o que o modelo pode citar como evidência. */
export const reviewSignalSchema = z.object({
  key: z.string().min(1).max(40),
  kind: reviewSignalKindSchema,
  detail: z.string().min(1).max(300),
});
export type ReviewSignal = z.infer<typeof reviewSignalSchema>;

export const reviewStatusSchema = z.enum(['ON_TRACK', 'ATTENTION', 'OFF_TRACK']);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

/** Explicação possível para o que os números mostram. Nasce e fica como hipótese. */
export const reviewHypothesisSchema = z.object({
  text: z.string().trim().min(1).max(240),
  confidence: z.enum(['LOW', 'MEDIUM']),
  /** Chaves dos sinais que sustentam a hipótese. */
  basedOn: z.array(z.string().min(1).max(40)).min(1).max(4),
});
export type ReviewHypothesis = z.infer<typeof reviewHypothesisSchema>;

/** Registro da revisão semanal, como fica gravado e como o painel lê. */
export const weeklyReviewRecordSchema = z.object({
  status: reviewStatusSchema,
  summary: z.string().min(1).max(500),
  /** Sempre `HYPOTHESIS`: só uma confirmação do aluno ou do profissional muda isso. */
  hypotheses: z.array(reviewHypothesisSchema.extend({ status: z.literal('HYPOTHESIS') })).max(3),
  /** Ações propostas por esta revisão (tipo e justificativa); a decisão fica na trilha. */
  interventions: z
    .array(z.object({ actionType: z.string().min(1).max(40), rationale: z.string().max(400) }))
    .max(2),
});
export type WeeklyReviewRecord = z.infer<typeof weeklyReviewRecordSchema>;
