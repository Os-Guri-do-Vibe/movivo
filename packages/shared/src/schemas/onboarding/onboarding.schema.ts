/**
 * Anamnese da v2: 8 etapas, salvas uma a uma (o aluno pode sair e voltar).
 *
 *   1 Cadastro · 2 Objetivos · 3 Modalidades · 4 Rotina · 5 Preferências e saúde · 6 PAR-Q ·
 *   7 Alimentação · 8 Corpo (opcional)
 *
 * O servidor separa cada etapa em parte comum (JSON) e parte sensível (cifrada): dado de saúde,
 * alergias, medicamentos e TODO texto livre vão só para o bloco cifrado. A anamnese
 * complementar (alunos que já existiam) usa as mesmas etapas, sem o cadastro.
 */
import { z } from 'zod';

import {
  onboardingStep1Schema,
  onboardingStep3Schema,
  painAssessmentSchema,
} from '../anamnesis.schema';
import { measurementInputSchema } from '../body/body.schema';
import { mealSlotSchema } from '../nutrition/nutrition.schema';
import { declaredGoalSchema } from '../student/goal.schema';
import {
  availabilityWindowSchema,
  externalSportPracticeSchema,
  lifeContextSchema,
  modalityExperienceSchema,
  trainingVenueSchema,
} from '../student/student-state.schema';

const freeText = (max: number) => z.string().trim().max(max).optional();

export const ONBOARDING_STEPS = 8;
export const onboardingStepNumberSchema = z.number().int().min(1).max(ONBOARDING_STEPS);
export type OnboardingStepNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Fluxo da sessão: cadastro novo ou complemento de quem já é aluno. */
export const onboardingFlowSchema = z.enum(['INITIAL', 'COMPLEMENTARY']);
export type OnboardingFlow = z.infer<typeof onboardingFlowSchema>;

// --- 2. Objetivos -------------------------------------------------------------------------

export const onboardingGoalsStepSchema = z.object({
  goal: declaredGoalSchema.omit({ motivation: true }),
  /** Texto livre: vai para o bloco cifrado. */
  motivation: freeText(300),
});
export type OnboardingGoalsStep = z.infer<typeof onboardingGoalsStepSchema>;

// --- 3. Modalidades -----------------------------------------------------------------------

export const onboardingModalitiesStepSchema = z
  .object({
    modalities: z.array(modalityExperienceSchema).min(1).max(3),
    externalSports: z.array(externalSportPracticeSchema).max(3),
    venues: z.array(trainingVenueSchema).min(1).max(7),
  })
  .refine((v) => new Set(v.modalities.map((m) => m.modality)).size === v.modalities.length, {
    message: 'Cada modalidade aparece uma vez só.',
    path: ['modalities'],
  });
export type OnboardingModalitiesStep = z.infer<typeof onboardingModalitiesStepSchema>;

// --- 4. Rotina ----------------------------------------------------------------------------

export const onboardingRoutineStepSchema = z.object({
  windows: z.array(availabilityWindowSchema).min(1).max(21),
  variesWeekly: z.boolean(),
  maxSessionsPerWeek: z.number().int().min(1).max(14),
  lifeContext: lifeContextSchema,
});
export type OnboardingRoutineStep = z.infer<typeof onboardingRoutineStepSchema>;

// --- 5. Preferências e saúde --------------------------------------------------------------

export const trainingSplitPreferenceSchema = z.enum([
  'FULL_BODY',
  'UPPER_LOWER',
  'PUSH_PULL_LEGS',
  'BODY_PART',
  'NO_PREFERENCE',
]);
export const effortPreferenceSchema = z.enum(['NEAR_FAILURE', 'AVOID_FAILURE', 'UNSURE']);
export const priorityPreferenceSchema = z.enum(['MAX_RESULT', 'BALANCED', 'ENJOYMENT']);

export const onboardingPreferencesStepSchema = z.object({
  preferences: z.object({
    split: trainingSplitPreferenceSchema,
    effort: effortPreferenceSchema,
    priority: priorityPreferenceSchema,
    /** Duração de sessão que o aluno prefere, em minutos. */
    preferredSessionMinutes: z.number().int().min(15).max(180),
  }),
  /** Textos livres: bloco cifrado. */
  likedTraining: freeText(300),
  dislikedExercises: freeText(300),
  pain: painAssessmentSchema,
  conditions: freeText(500),
  medications: freeText(500),
  professionalGuidance: freeText(500),
});
export type OnboardingPreferencesStep = z.infer<typeof onboardingPreferencesStepSchema>;

// --- 6. PAR-Q (mesmo contrato da v1: questionário + declarações) -------------------------

export const onboardingParqStepSchema = onboardingStep3Schema;
export type OnboardingParqStep = z.infer<typeof onboardingParqStepSchema>;

// --- 7. Alimentação -----------------------------------------------------------------------

export const onboardingNutritionStepSchema = z.object({
  mealsPerDay: z.number().int().min(1).max(8),
  usualMeals: z.array(mealSlotSchema).min(1).max(8),
  dietaryRestrictions: z
    .array(z.enum(['VEGETARIAN', 'VEGAN', 'LACTOSE_FREE', 'GLUTEN_FREE', 'HALAL', 'KOSHER']))
    .max(6),
  /** Alergia é dado de saúde: bloco cifrado. */
  allergies: z
    .array(
      z.object({
        allergen: z.string().trim().min(1).max(60),
        severity: z.enum(['INTOLERANCE', 'ALLERGY', 'SEVERE_ALLERGY']),
      }),
    )
    .max(10),
  supplements: z
    .array(
      z.enum(['CREATINE', 'WHEY', 'CAFFEINE', 'VITAMIN_D', 'OMEGA_3', 'MULTIVITAMIN', 'OTHER']),
    )
    .max(7),
  hunger: z.enum(['LOW', 'NORMAL', 'HIGH', 'VARIES']),
  /** Textos livres: bloco cifrado. */
  likedFoods: freeText(300),
  dislikedFoods: freeText(300),
});
export type OnboardingNutritionStep = z.infer<typeof onboardingNutritionStepSchema>;

// --- 8. Corpo (opcional) ------------------------------------------------------------------

export const onboardingBodyStepSchema = z.object({
  measurements: z.array(measurementInputSchema).max(12),
});
export type OnboardingBodyStep = z.infer<typeof onboardingBodyStepSchema>;

/** Schema de cada etapa, pelo número. */
export const ONBOARDING_STEP_SCHEMAS = {
  1: onboardingStep1Schema,
  2: onboardingGoalsStepSchema,
  3: onboardingModalitiesStepSchema,
  4: onboardingRoutineStepSchema,
  5: onboardingPreferencesStepSchema,
  6: onboardingParqStepSchema,
  7: onboardingNutritionStepSchema,
  8: onboardingBodyStepSchema,
} as const satisfies Record<OnboardingStepNumber, z.ZodType>;

/** Etapas obrigatórias para enviar (a 8, corpo, é opcional). */
export const REQUIRED_ONBOARDING_STEPS: Readonly<
  Record<OnboardingFlow, readonly OnboardingStepNumber[]>
> = {
  INITIAL: [1, 2, 3, 4, 5, 6, 7],
  COMPLEMENTARY: [2, 3, 4, 5, 6, 7],
};
