import { z } from 'zod';

import { uuidSchema } from '../common.schema';
import { constraintSchema, preferenceSchema } from '../student/student-state.schema';
import { daySlotSchema } from '../training/plan.schema';
import { coachedModalitySchema } from '../training/modality.schema';
import { mealSlotSchema } from '../nutrition/nutrition.schema';

/** Domínio de atuação — decide qual profissional responde e qual política se aplica. */
export const coachingDomainSchema = z.enum([
  'TRAINING',
  'NUTRITION',
  'GOALS',
  'SCHEDULE',
  'STATE',
  'COMMUNICATION',
]);
export type CoachingDomain = z.infer<typeof coachingDomainSchema>;

// --- Catálogo de ações -------------------------------------------------------------------

const isoDate = z.iso.date();

export const substitutionReasonSchema = z.enum([
  'PREFERENCE',
  'EQUIPMENT',
  'DIFFICULTY',
  'DISCOMFORT',
  'OTHER',
]);
export type SubstitutionReason = z.infer<typeof substitutionReasonSchema>;

/**
 * Toda mudança que um agente pode PROPOR. Cada tipo tem payload próprio: nunca um formato
 * permissivo que aceite "qualquer coisa". A execução é feita por comandos determinísticos dos
 * módulos de domínio, depois do motor de políticas.
 */
export const coachingActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('RESCHEDULE_WEEK'),
    weekStart: isoDate,
    assignments: z
      .array(
        z.object({
          planSessionKey: z.string().min(1).max(24),
          date: isoDate,
          slot: daySlotSchema,
        }),
      )
      .max(14),
    /** Sessões que ficam fora desta semana (nunca empilhadas nos dias seguintes). */
    dropped: z.array(z.string().min(1).max(24)).max(14),
  }),
  z.object({
    type: z.literal('SUBSTITUTE_EXERCISE'),
    planSessionKey: z.string().min(1).max(24),
    fromExerciseId: z.string().min(1).max(80),
    toExerciseId: z.string().min(1).max(80),
    reason: substitutionReasonSchema,
    /** Só nesta sessão ou no plano todo. */
    scope: z.enum(['NEXT_SESSION', 'PLAN']),
  }),
  z.object({
    type: z.literal('SHORTEN_SESSION'),
    scheduledSessionId: uuidSchema,
    targetMinutes: z.number().int().min(10).max(240),
  }),
  z.object({
    type: z.literal('ADJUST_WEEKLY_VOLUME'),
    modality: coachedModalitySchema,
    /** Variação percentual do volume semanal da modalidade (ex.: -20, +10). */
    percentChange: z.number().min(-60).max(30),
    weeks: z.number().int().min(1).max(4),
  }),
  z.object({ type: z.literal('PUBLISH_TRAINING_PLAN'), planId: uuidSchema }),
  z.object({ type: z.literal('PUBLISH_NUTRITION_PLAN'), planId: uuidSchema }),
  z.object({
    type: z.literal('ADJUST_ENERGY_TARGET'),
    /** kcal/dia somadas às duas faixas (treino e descanso). */
    deltaKcal: z.number().int().min(-600).max(600),
  }),
  z.object({
    type: z.literal('ADJUST_MEAL_GUIDANCE'),
    slot: mealSlotSchema,
    guidance: z.string().trim().min(1).max(300),
    examples: z.array(z.string().trim().min(1).max(200)).min(1).max(5),
  }),
  z.object({ type: z.literal('DEFINE_STRATEGY'), goalId: uuidSchema }),
  z.object({ type: z.literal('RECORD_PREFERENCE'), preference: preferenceSchema }),
  z.object({ type: z.literal('RECORD_CONSTRAINT'), constraint: constraintSchema }),
  z.object({
    type: z.literal('SEND_MESSAGE'),
    purpose: z.enum(['ROUTINE', 'OPPORTUNITY', 'INVESTIGATION', 'SAFETY']),
    text: z.string().trim().min(1).max(2_000),
  }),
  z.object({
    type: z.literal('ASK_STUDENT'),
    question: z.string().trim().min(1).max(500),
    options: z.array(z.string().trim().min(1).max(60)).max(4).optional(),
  }),
]);
export type CoachingAction = z.infer<typeof coachingActionSchema>;
export type CoachingActionType = CoachingAction['type'];

export const coachingActionTypeSchema = z.enum([
  'RESCHEDULE_WEEK',
  'SUBSTITUTE_EXERCISE',
  'SHORTEN_SESSION',
  'ADJUST_WEEKLY_VOLUME',
  'PUBLISH_TRAINING_PLAN',
  'PUBLISH_NUTRITION_PLAN',
  'ADJUST_ENERGY_TARGET',
  'ADJUST_MEAL_GUIDANCE',
  'DEFINE_STRATEGY',
  'RECORD_PREFERENCE',
  'RECORD_CONSTRAINT',
  'SEND_MESSAGE',
  'ASK_STUDENT',
]);

/** Domínio de cada ação (fonte única para o motor de políticas e para o painel). */
export const ACTION_DOMAIN: Readonly<Record<CoachingActionType, CoachingDomain>> = {
  RESCHEDULE_WEEK: 'SCHEDULE',
  SUBSTITUTE_EXERCISE: 'TRAINING',
  SHORTEN_SESSION: 'TRAINING',
  ADJUST_WEEKLY_VOLUME: 'TRAINING',
  PUBLISH_TRAINING_PLAN: 'TRAINING',
  PUBLISH_NUTRITION_PLAN: 'NUTRITION',
  ADJUST_ENERGY_TARGET: 'NUTRITION',
  ADJUST_MEAL_GUIDANCE: 'NUTRITION',
  DEFINE_STRATEGY: 'GOALS',
  RECORD_PREFERENCE: 'STATE',
  RECORD_CONSTRAINT: 'STATE',
  SEND_MESSAGE: 'COMMUNICATION',
  ASK_STUDENT: 'COMMUNICATION',
};

// --- Propostas e decisões ----------------------------------------------------------------

export const uncertaintySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type Uncertainty = z.infer<typeof uncertaintySchema>;

/** O que um agente devolve: a ação proposta e por quê. Nunca executa nada sozinho. */
export const coachingProposalSchema = z.object({
  action: coachingActionSchema,
  rationale: z.array(z.string().trim().min(1).max(300)).min(1).max(6),
  /** Fatos do Estado do Aluno em que a proposta se apoia (chaves/ids citáveis). */
  evidence: z.array(z.string().trim().min(1).max(200)).max(10),
  assumptions: z.array(z.string().trim().min(1).max(200)).max(5),
  uncertainty: uncertaintySchema,
  /** Como saber depois se a mudança funcionou. */
  expectedOutcome: z.string().trim().min(1).max(300),
});
export type CoachingProposal = z.infer<typeof coachingProposalSchema>;

export const proposalStatusSchema = z.enum([
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'SUPERSEDED',
]);
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;

/** Nível de autonomia configurado pelos profissionais para um tipo de ação. */
export const autonomyLevelSchema = z.enum(['AUTO', 'AUTO_WITH_LIMITS', 'ASK', 'ESCALATE']);
export type AutonomyLevel = z.infer<typeof autonomyLevelSchema>;

/** Veredito do motor de políticas para UMA proposta. */
export const decisionVerdictSchema = z.enum(['EXECUTE', 'ASK', 'ESCALATE', 'BLOCK']);
export type DecisionVerdict = z.infer<typeof decisionVerdictSchema>;

export const decisionActorSchema = z.enum(['POLICY_ENGINE', 'STAFF']);

export const executionStatusOfDecisionSchema = z.enum(['SUCCEEDED', 'FAILED', 'SKIPPED']);

// --- Segurança ---------------------------------------------------------------------------

export const safetySignalKindSchema = z.enum([
  'PARQ_POSITIVE',
  'CHEST_PAIN',
  'FAINTING_OR_DIZZINESS',
  'SHORTNESS_OF_BREATH',
  'SEVERE_PAIN',
  'PERSISTENT_PAIN',
  'NEW_INJURY',
  'MEDICATION_CHANGE',
  'PREGNANCY',
  'RECENT_SURGERY',
  'EATING_DISORDER_SIGNS',
  'RAPID_WEIGHT_CHANGE',
  'MENTAL_DISTRESS',
  'OTHER',
]);
export type SafetySignalKind = z.infer<typeof safetySignalKindSchema>;

export const safetySeveritySchema = z.enum(['ATTENTION', 'URGENT', 'EMERGENCY']);
export type SafetySeverity = z.infer<typeof safetySeveritySchema>;

/** Domínio cujas ações automáticas ficam suspensas enquanto o sinal está ativo. */
export const safetyScopeSchema = z.enum(['TRAINING', 'NUTRITION', 'ALL']);
export type SafetyScope = z.infer<typeof safetyScopeSchema>;

export const safetySignalSchema = z.object({
  kind: safetySignalKindSchema,
  severity: safetySeveritySchema,
  scope: safetyScopeSchema,
  /** Trecho/fato que gerou o sinal (já pseudonimizado). */
  evidence: z.string().trim().min(1).max(400),
});
export type SafetySignal = z.infer<typeof safetySignalSchema>;

// --- Exceções (fila humana) --------------------------------------------------------------

export const exceptionKindSchema = z.enum([
  'SAFETY',
  'NO_APPLICABLE_POLICY',
  'STUDENT_REVIEW_REQUEST',
  'DECISION_FAILURE',
  'CONVERSATION_TAKEOVER',
]);
export type ExceptionKind = z.infer<typeof exceptionKindSchema>;

export const exceptionPrioritySchema = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
export type ExceptionPriority = z.infer<typeof exceptionPrioritySchema>;

export const exceptionStatusSchema = z.enum(['OPEN', 'IN_REVIEW', 'RESOLVED']);
export type ExceptionStatus = z.infer<typeof exceptionStatusSchema>;
