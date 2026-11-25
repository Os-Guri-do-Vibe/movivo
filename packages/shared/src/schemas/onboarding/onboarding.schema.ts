/**
 * Anamnese da v2: 9 etapas, salvas uma a uma (o aluno pode sair e voltar).
 *
 *   1 Cadastro · 2 Objetivos · 3 Seu treino com a MOVIVO · 4 Sua semana ·
 *   5 Preferências de treino · 6 Dores e limitações · 7 Alimentação · 8 Corpo (opcional) ·
 *   9 PAR-Q (sempre a última)
 *
 * A 3 é só o que a MOVIVO vai prescrever (modalidade, nível, local). Tudo que descreve a semana
 * do aluno fica na 4: esporte que ele já pratica por fora, disponibilidade, o teto de treinos,
 * sono e estresse. As respostas são informação e preferência: quem decide quantos treinos,
 * quais e em que dias é a MOVIVO.
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
import { declaredGoalSchema, muscleEmphasisRegionSchema } from '../student/goal.schema';
import {
  availabilityWindowSchema,
  externalSportPracticeSchema,
  lifeContextSchema,
  modalityExperienceSchema,
  trainingVenueSchema,
  VENUES_BY_MODALITY,
} from '../student/student-state.schema';
import { isUnnamedOtherSport } from '../training/modality.schema';

const freeText = (max: number) => z.string().trim().max(max).optional();

export const ONBOARDING_STEPS = 9;
export const onboardingStepNumberSchema = z.number().int().min(1).max(ONBOARDING_STEPS);
export type OnboardingStepNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

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

// --- 3. Seu treino com a MOVIVO -----------------------------------------------------------

/**
 * Em "Outro" o aluno digita qual é o esporte (vai em `label`): sem o nome, a MOVIVO não sabe o
 * que planejar em volta. Texto de uma linha, sem caracteres de controle.
 */
const externalSportInputSchema = externalSportPracticeSchema
  .refine((s) => !isUnnamedOtherSport(s.sport, s.label), {
    message: 'Informe qual é o esporte.',
    path: ['label'],
  })
  .refine((s) => !/\p{Cc}/u.test(s.label), {
    message: 'O nome do esporte não pode ter quebra de linha ou caracteres especiais de controle.',
    path: ['label'],
  });

const externalSportsSchema = z.array(externalSportInputSchema).max(3);

export const onboardingModalitiesStepSchema = z
  .object({
    modalities: z
      .array(
        modalityExperienceSchema
          .extend({ venue: trainingVenueSchema })
          .refine((m) => VENUES_BY_MODALITY[m.modality].includes(m.venue), {
            message: 'Escolha um local que sirva para essa modalidade.',
            path: ['venue'],
          }),
      )
      .min(1)
      .max(3),
    /**
     * Legado: o esporte externo mudou para a etapa 4. Só é aceito para não recusar etapas salvas
     * (ou enviadas por uma aba aberta antes da mudança); a etapa 4 é a fonte quando tem o campo.
     */
    externalSports: externalSportsSchema.optional(),
  })
  .refine((v) => new Set(v.modalities.map((m) => m.modality)).size === v.modalities.length, {
    message: 'Cada modalidade aparece uma vez só.',
    path: ['modalities'],
  });
export type OnboardingModalitiesStep = z.infer<typeof onboardingModalitiesStepSchema>;

// --- 4. Sua semana -------------------------------------------------------------------------

const distinctDays = (windows: readonly { weekday: string }[]) =>
  new Set(windows.map((w) => w.weekday)).size;

export const onboardingRoutineStepSchema = z
  .object({
    /**
     * Esporte que o aluno já pratica por fora e quer manter (a MOVIVO planeja em volta). Opcional
     * só no contrato, para etapas salvas antes da mudança (aí vale o da etapa 3); o formulário
     * sempre envia, mesmo vazio.
     */
    externalSports: externalSportsSchema.optional(),
    windows: z.array(availabilityWindowSchema).min(1).max(21),
    variesWeekly: z.boolean(),
    /**
     * Legado: o formulário não pergunta mais quantos treinos o aluno quer. Quantos e quais treinos
     * entram, quem decide é a MOVIVO, a partir dos dias disponíveis. Só etapas salvas antes da
     * mudança trazem o valor.
     */
    maxSessionsPerWeek: z.number().int().min(1).max(7).optional(),
    /** Sono e estresse; o resto do contexto de vida vem da etapa de alimentação. */
    lifeContext: lifeContextSchema.pick({ sleepHoursTypical: true, stressLevel: true }),
  })
  .refine((v) => distinctDays(v.windows) === v.windows.length, {
    message: 'Cada dia aparece uma vez só.',
    path: ['windows'],
  })
  .refine(
    (v) => v.maxSessionsPerWeek === undefined || v.maxSessionsPerWeek <= distinctDays(v.windows),
    {
      message: 'Você escolheu mais treinos do que dias disponíveis.',
      path: ['maxSessionsPerWeek'],
    },
  );
export type OnboardingRoutineStep = z.infer<typeof onboardingRoutineStepSchema>;

// --- 5. Preferências de treino e saúde geral -----------------------------------------------

export const priorityPreferenceSchema = z.enum(['MAX_RESULT', 'BALANCED', 'ENJOYMENT']);

export const onboardingPreferencesStepSchema = z.object({
  preferences: z.object({
    priority: priorityPreferenceSchema,
    /** Musculação: regiões em que o aluno quer mais ênfase (até 2). */
    muscleEmphasis: z.array(muscleEmphasisRegionSchema).max(2).default([]),
  }),
  /** Textos livres: bloco cifrado. */
  trainingPreferences: freeText(500),
  dislikedExercises: freeText(500),
  conditions: freeText(500),
  medications: freeText(500),
  professionalGuidance: freeText(500),
});
export type OnboardingPreferencesStep = z.infer<typeof onboardingPreferencesStepSchema>;

// --- 6. Dores e limitações (tela própria) -------------------------------------------------

export const onboardingPainStepSchema = z.object({ pain: painAssessmentSchema });
export type OnboardingPainStep = z.infer<typeof onboardingPainStepSchema>;

// --- 7. Alimentação -----------------------------------------------------------------------

export const onboardingNutritionStepSchema = z
  .object({
    /** Contexto de vida que o planejador de alimentação usa (vai para o perfil do aluno). */
    cookingCapacity: lifeContextSchema.shape.cookingCapacity,
    mealsOutsideHomePerWeek: lifeContextSchema.shape.mealsOutsideHomePerWeek,
    foodBudgetMonthlyBrl: z.number().gt(0).max(1_000_000),
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
    /** Qual suplemento, quando o aluno marca "Outro". Texto livre: bloco cifrado. */
    supplementOther: freeText(80),
    hunger: z.enum(['LOW', 'NORMAL', 'HIGH', 'VARIES']),
    /** Textos livres: bloco cifrado. */
    likedFoods: freeText(300),
    dislikedFoods: freeText(300),
  })
  .refine((v) => !v.supplements.includes('OTHER') || Boolean(v.supplementOther), {
    message: 'Diga qual é o outro suplemento.',
    path: ['supplementOther'],
  });
export type OnboardingNutritionStep = z.infer<typeof onboardingNutritionStepSchema>;

// --- 8. Corpo (opcional) ------------------------------------------------------------------

export const onboardingBodyStepSchema = z.object({
  measurements: z.array(measurementInputSchema).max(12),
});
export type OnboardingBodyStep = z.infer<typeof onboardingBodyStepSchema>;

// --- 9. PAR-Q (última parte; mesmo contrato da v1: questionário + declarações) ------------

export const onboardingParqStepSchema = onboardingStep3Schema;
export type OnboardingParqStep = z.infer<typeof onboardingParqStepSchema>;

/** Schema de cada etapa, pelo número. */
export const ONBOARDING_STEP_SCHEMAS = {
  1: onboardingStep1Schema,
  2: onboardingGoalsStepSchema,
  3: onboardingModalitiesStepSchema,
  4: onboardingRoutineStepSchema,
  5: onboardingPreferencesStepSchema,
  6: onboardingPainStepSchema,
  7: onboardingNutritionStepSchema,
  8: onboardingBodyStepSchema,
  9: onboardingParqStepSchema,
} as const satisfies Record<OnboardingStepNumber, z.ZodType>;

/** Etapas obrigatórias para enviar (a 8, corpo, é opcional). */
export const REQUIRED_ONBOARDING_STEPS: Readonly<
  Record<OnboardingFlow, readonly OnboardingStepNumber[]>
> = {
  INITIAL: [1, 2, 3, 4, 5, 6, 7, 9],
  COMPLEMENTARY: [2, 3, 4, 5, 6, 7, 9],
};
