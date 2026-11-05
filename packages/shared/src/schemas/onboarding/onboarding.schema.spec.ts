import { describe, expect, it } from 'vitest';

import {
  ONBOARDING_STEP_SCHEMAS,
  ONBOARDING_STEPS,
  REQUIRED_ONBOARDING_STEPS,
  onboardingModalitiesStepSchema,
  onboardingNutritionStepSchema,
  onboardingPainStepSchema,
  onboardingPreferencesStepSchema,
  onboardingRoutineStepSchema,
  onboardingStepNumberSchema,
} from './onboarding.schema';

const nutrition = {
  cookingCapacity: 'BASIC',
  mealsOutsideHomePerWeek: 2,
  foodBudgetMonthlyBrl: 1200.5,
  mealsPerDay: 4,
  usualMeals: ['LUNCH'],
  dietaryRestrictions: [],
  allergies: [],
  supplements: [],
  hunger: 'NORMAL',
};

describe('etapas da anamnese', () => {
  it('são 9, com o PAR-Q sempre por último e o corpo opcional', () => {
    expect(ONBOARDING_STEPS).toBe(9);
    expect(Object.keys(ONBOARDING_STEP_SCHEMAS)).toHaveLength(9);
    expect(onboardingStepNumberSchema.safeParse(9).success).toBe(true);
    expect(onboardingStepNumberSchema.safeParse(10).success).toBe(false);
    expect(REQUIRED_ONBOARDING_STEPS.INITIAL).toEqual([1, 2, 3, 4, 5, 6, 7, 9]);
    expect(REQUIRED_ONBOARDING_STEPS.COMPLEMENTARY).toEqual([2, 3, 4, 5, 6, 7, 9]);
  });
});

describe('modalidades', () => {
  const strength = {
    modality: 'STRENGTH',
    level: 'BEGINNER',
    wantsToStart: false,
    venue: 'FULL_GYM',
  };
  const step = (modalities: object[]) => ({ modalities });

  it('exige um local por modalidade, compatível com ela', () => {
    expect(onboardingModalitiesStepSchema.safeParse(step([strength])).success).toBe(true);
    const { venue: _venue, ...withoutVenue } = strength;
    expect(onboardingModalitiesStepSchema.safeParse(step([withoutVenue])).success).toBe(false);
    const track = onboardingModalitiesStepSchema.safeParse(step([{ ...strength, venue: 'TRACK' }]));
    expect(track.error?.issues[0]?.message).toBe(
      'Escolha um local que sirva para essa modalidade.',
    );
    expect(
      onboardingModalitiesStepSchema.safeParse(
        step([{ ...strength, modality: 'RUNNING', venue: 'CONDO_GYM' }]),
      ).success,
    ).toBe(true);
  });

  it('não leva mais a lista global de locais nem modalidade repetida', () => {
    const parsed = onboardingModalitiesStepSchema.parse({ ...step([strength]), venues: ['HOME'] });
    expect(parsed).not.toHaveProperty('venues');
    expect(onboardingModalitiesStepSchema.safeParse(step([strength, strength])).success).toBe(
      false,
    );
  });

  it('ainda aceita o esporte externo de etapas salvas antes de ele ir para a semana', () => {
    expect(
      onboardingModalitiesStepSchema.safeParse({ ...step([strength]), externalSports: [] }).success,
    ).toBe(true);
  });
});

describe('rotina', () => {
  const base = {
    windows: [
      { weekday: 'MON', slot: 'MORNING', maxMinutes: 60 },
      { weekday: 'WED', slot: 'MORNING', maxMinutes: 60 },
    ],
    variesWeekly: false,
    maxSessionsPerWeek: 2,
  };

  it('só leva sono e estresse no contexto de vida', () => {
    expect(
      onboardingRoutineStepSchema.safeParse({
        ...base,
        lifeContext: { sleepHoursTypical: 7.5, stressLevel: 'LOW' },
      }).success,
    ).toBe(true);
    expect(onboardingRoutineStepSchema.safeParse({ ...base, lifeContext: {} }).success).toBe(true);
    expect(
      onboardingRoutineStepSchema.safeParse({ ...base, lifeContext: { cookingCapacity: 'BASIC' } })
        .success,
    ).toBe(true);
  });

  it('leva o esporte externo, que fica opcional para etapas salvas antes da mudança', () => {
    const swimming = {
      sport: 'SWIMMING',
      label: 'Natação',
      sessionsPerWeek: 2,
      minutesPerSession: 60,
      typicalRpe: 5,
      fixedDays: ['TUE'],
    };
    const withSport = onboardingRoutineStepSchema.parse({
      ...base,
      externalSports: [swimming],
      lifeContext: {},
    });
    expect(withSport.externalSports).toEqual([swimming]);
    const legacy = onboardingRoutineStepSchema.parse({ ...base, lifeContext: {} });
    expect(legacy).not.toHaveProperty('externalSports');
    expect(
      onboardingRoutineStepSchema.safeParse({
        ...base,
        externalSports: [swimming, swimming, swimming, swimming],
        lifeContext: {},
      }).success,
    ).toBe(false);
  });

  it('treinos por semana não passam dos dias disponíveis', () => {
    const over = onboardingRoutineStepSchema.safeParse({
      ...base,
      maxSessionsPerWeek: 3,
      lifeContext: {},
    });
    expect(over.error?.issues[0]?.message).toBe(
      'Você escolheu mais treinos do que dias disponíveis.',
    );
  });

  it('um horário por dia', () => {
    const repeated = onboardingRoutineStepSchema.safeParse({
      ...base,
      windows: [base.windows[0], { weekday: 'MON', slot: 'EVENING', maxMinutes: 30 }],
      maxSessionsPerWeek: 1,
      lifeContext: {},
    });
    expect(repeated.error?.issues[0]?.message).toBe('Cada dia aparece uma vez só.');
  });
});

describe('preferências de treino', () => {
  const preferences = { priority: 'BALANCED' };

  it('ênfase muscular tem no máximo 2 regiões e é opcional', () => {
    expect(onboardingPreferencesStepSchema.safeParse({ preferences }).success).toBe(true);
    expect(
      onboardingPreferencesStepSchema.safeParse({
        preferences: { ...preferences, muscleEmphasis: ['CHEST', 'ARMS'] },
      }).success,
    ).toBe(true);
    expect(
      onboardingPreferencesStepSchema.safeParse({
        preferences: { ...preferences, muscleEmphasis: ['CHEST', 'ARMS', 'BACK'] },
      }).success,
    ).toBe(false);
  });

  it('não aceita mais divisão de treino nem esforço escolhidos pelo aluno', () => {
    expect(
      onboardingPreferencesStepSchema.parse({
        preferences: { ...preferences, split: 'FULL_BODY', effort: 'UNSURE' },
      }).preferences,
    ).not.toHaveProperty('split');
  });
});

describe('dores e limitações', () => {
  it('é uma etapa própria com a avaliação de dor', () => {
    expect(onboardingPainStepSchema.safeParse({ pain: { hasPain: false } }).success).toBe(true);
    expect(onboardingPainStepSchema.safeParse({}).success).toBe(false);
  });
});

describe('alimentação', () => {
  it('leva o contexto de vida e valida o suplemento "Outro"', () => {
    expect(onboardingNutritionStepSchema.safeParse(nutrition).success).toBe(true);
    expect(
      onboardingNutritionStepSchema.safeParse({ ...nutrition, supplements: ['OTHER'] }).success,
    ).toBe(false);
    expect(
      onboardingNutritionStepSchema.safeParse({
        ...nutrition,
        supplements: ['OTHER'],
        supplementOther: 'colágeno',
      }).success,
    ).toBe(true);
  });

  it('exige cozinha, refeições fora de casa e orçamento', () => {
    const { cookingCapacity: _cooking, ...withoutCooking } = nutrition;
    expect(onboardingNutritionStepSchema.safeParse(withoutCooking).success).toBe(false);
  });
});
