import { z } from 'zod';

import { uuidSchema } from '../common.schema';
import { hyroxSessionContentSchema, runningSessionContentSchema } from './endurance.schema';
import {
  coachedModalitySchema,
  externalSportSchema,
  rpeSchema,
  sessionModalitySchema,
} from './modality.schema';
import { strengthSessionContentSchema } from './strength.schema';

/** Sessão de esporte externo: o MOVIVO não prescreve, só registra a carga para planejar em volta. */
export const externalSportSessionContentSchema = z.object({
  modality: z.literal('EXTERNAL_SPORT'),
  sport: externalSportSchema,
  label: z.string().trim().min(1).max(80),
  plannedMinutes: z.number().int().min(10).max(600),
  plannedRpe: rpeSchema,
});
export type ExternalSportSessionContent = z.infer<typeof externalSportSessionContentSchema>;

/** Conteúdo de uma sessão do plano, discriminado por modalidade. */
export const sessionContentSchema = z.discriminatedUnion('modality', [
  strengthSessionContentSchema,
  runningSessionContentSchema,
  hyroxSessionContentSchema,
  externalSportSessionContentSchema,
]);
export type SessionContent = z.infer<typeof sessionContentSchema>;

/** Peso da sessão no plano: decide o que é preservado quando a semana aperta. */
export const sessionPrioritySchema = z.enum(['KEY', 'IMPORTANT', 'COMPLEMENTARY']);
export type SessionPriority = z.infer<typeof sessionPrioritySchema>;

export const SESSION_PRIORITY_LABELS: Readonly<Record<SessionPriority, string>> = {
  KEY: 'Sessão-chave',
  IMPORTANT: 'Importante',
  COMPLEMENTARY: 'Complementar',
};

/** Sessão-modelo do plano (ex.: "Força A", "Intervalado 6×800"), sem data. */
export const planSessionSchema = z
  .object({
    /** Identificador estável dentro do plano (ex.: `STR_A`, `RUN_LONG`). */
    key: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{0,23}$/, 'Use letras maiúsculas, números e _.'),
    title: z.string().trim().min(1).max(80),
    purpose: z.string().trim().min(1).max(300),
    priority: sessionPrioritySchema,
    /** Quantas vezes por semana a sessão acontece no bloco atual. */
    weeklyFrequency: z.number().int().min(1).max(7),
    estimatedMinutes: z.number().int().min(5).max(300),
    /** PSE prevista (CR-10). A carga prevista é PSE × minutos (sRPE). */
    estimatedRpe: rpeSchema,
    content: sessionContentSchema,
  })
  .refine((s) => s.content.modality !== 'EXTERNAL_SPORT' || s.priority !== 'KEY', {
    message: 'Esporte externo não é sessão-chave do plano MOVIVO.',
    path: ['priority'],
  });
export type PlanSession = z.infer<typeof planSessionSchema>;

/** Fase do plano (bloco de semanas com um foco). */
export const planPhaseSchema = z.object({
  name: z.string().trim().min(1).max(60),
  focus: z.string().trim().min(1).max(200),
  weeks: z.number().int().min(1).max(16),
  /** Semana de recuperação (deload/redução) ao final da fase. */
  endsWithDeload: z.boolean(),
});
export type PlanPhase = z.infer<typeof planPhaseSchema>;

/** Prioridade relativa de cada modalidade prescrita no plano (soma livre, só a ordem importa). */
export const modalityPrioritySchema = z.object({
  modality: coachedModalitySchema,
  priority: z.number().int().min(1).max(3),
});

/** Estrutura de um plano de treino integrado (todas as modalidades num só plano). */
export const trainingPlanStructureSchema = z
  .object({
    summary: z.string().trim().min(1).max(600),
    modalityPriorities: z.array(modalityPrioritySchema).min(1).max(3),
    phases: z.array(planPhaseSchema).min(1).max(8),
    sessions: z.array(planSessionSchema).min(1).max(14),
  })
  .superRefine((plan, ctx) => {
    const keys = new Set<string>();
    plan.sessions.forEach((session, index) => {
      if (keys.has(session.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sessions', index, 'key'],
          message: 'Chave de sessão repetida.',
        });
      }
      keys.add(session.key);
    });
    const prioritized = new Set(plan.modalityPriorities.map((p) => p.modality));
    plan.sessions.forEach((session, index) => {
      const modality = session.content.modality;
      if (modality !== 'EXTERNAL_SPORT' && !prioritized.has(modality)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sessions', index, 'content', 'modality'],
          message: 'Sessão de modalidade sem prioridade definida no plano.',
        });
      }
    });
  });
export type TrainingPlanStructure = z.infer<typeof trainingPlanStructureSchema>;

export const planStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'SUPERSEDED']);
export type PlanStatus = z.infer<typeof planStatusSchema>;

export const daySlotSchema = z.enum(['MORNING', 'AFTERNOON', 'EVENING', 'ANY']);
export type DaySlot = z.infer<typeof daySlotSchema>;

export const scheduledSessionStatusSchema = z.enum([
  'PLANNED',
  'DONE',
  'PARTIAL',
  'MISSED',
  'SKIPPED',
  'MOVED',
]);
export type ScheduledSessionStatus = z.infer<typeof scheduledSessionStatusSchema>;

/** Quem/o que fez a última mudança na agenda. */
export const scheduleChangeSourceSchema = z.enum(['PLANNER', 'STUDENT', 'COACHING', 'STAFF']);
export type ScheduleChangeSource = z.infer<typeof scheduleChangeSourceSchema>;

/** Uma sessão do plano colocada num dia. */
export const scheduledSessionSchema = z.object({
  id: uuidSchema,
  planSessionKey: z.string(),
  modality: sessionModalitySchema,
  scheduledOn: z.iso.date(),
  slot: daySlotSchema,
  status: scheduledSessionStatusSchema,
});
export type ScheduledSession = z.infer<typeof scheduledSessionSchema>;

/**
 * Ajuste pontual de UMA ocorrência agendada (o plano não muda): encurtar a sessão e/ou trocar
 * exercícios só desta vez. Aplicado sobre o conteúdo do plano na hora de mostrar e executar.
 */
export const sessionAdjustmentSchema = z.object({
  /** Duração-alvo e fração do conteúdo mantida (0–1). */
  shorten: z
    .object({
      targetMinutes: z.number().int().min(10).max(240),
      factor: z.number().min(0.2).max(1),
    })
    .optional(),
  /** Trocas de exercício só nesta ocorrência (catálogo). */
  substitutions: z
    .array(
      z.object({
        fromExerciseId: z.string().min(1).max(80),
        toExerciseId: z.string().min(1).max(80),
        toName: z.string().min(1).max(120),
      }),
    )
    .max(10)
    .optional(),
});
export type SessionAdjustment = z.infer<typeof sessionAdjustmentSchema>;
