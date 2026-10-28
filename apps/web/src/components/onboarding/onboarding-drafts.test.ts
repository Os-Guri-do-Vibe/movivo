import {
  onboardingBodyStepSchema,
  onboardingGoalsStepSchema,
  onboardingModalitiesStepSchema,
  onboardingNutritionStepSchema,
  onboardingPreferencesStepSchema,
  onboardingRoutineStepSchema,
} from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import {
  bodyPayload,
  EMPTY_GOALS,
  EMPTY_MODALITIES,
  EMPTY_NUTRITION,
  EMPTY_PREFERENCES,
  EMPTY_ROUTINE,
  goalsComplete,
  goalsFromBlock,
  goalsPayload,
  modalitiesComplete,
  modalitiesFromBlock,
  modalitiesPayload,
  newExternalSport,
  nutritionComplete,
  nutritionPayload,
  parseClock,
  preferencesComplete,
  preferencesPayload,
  routineComplete,
  routineFromBlock,
  routinePayload,
} from './onboarding-drafts';

describe('parseClock', () => {
  it('lê mm:ss, h:mm:ss e minutos soltos', () => {
    expect(parseClock('27:30')).toBe(1650);
    expect(parseClock('1:25:00')).toBe(5100);
    expect(parseClock('25')).toBe(1500);
    expect(parseClock('')).toBeUndefined();
    expect(parseClock('abc')).toBeUndefined();
  });
});

describe('payloads aceitos pelos contratos da API', () => {
  it('objetivos: com prova de corrida', () => {
    const draft = {
      ...EMPTY_GOALS,
      primary: 'RACE_PREPARATION' as const,
      secondary: ['STRENGTH' as const],
      emphasis: 'PERFORMANCE' as const,
      hasEvent: true,
      eventName: 'Meia Maratona do Rio',
      eventDate: '2027-06-20',
      eventDistanceKm: '21,1',
      motivation: 'Quero terminar bem',
    };
    expect(goalsComplete(draft)).toBe(true);
    const payload = goalsPayload(draft);
    expect(onboardingGoalsStepSchema.safeParse(payload).success).toBe(true);
    expect(payload.goal.targetEvent?.distanceMeters).toBe(21_100);
  });

  it('objetivos: o objetivo principal não se repete nos secundários', () => {
    const payload = goalsPayload({
      ...EMPTY_GOALS,
      primary: 'HYPERTROPHY',
      secondary: ['HYPERTROPHY', 'STRENGTH'],
      emphasis: 'BALANCED',
    });
    expect(payload.goal.secondary).toEqual(['STRENGTH']);
  });

  it('modalidades: quem quer começar vira nível NONE', () => {
    const draft = structuredClone(EMPTY_MODALITIES);
    draft.modalities.STRENGTH = {
      ...draft.modalities.STRENGTH,
      selected: true,
      level: 'INTERMEDIATE',
      months: '24',
      sessions: '3',
    };
    draft.modalities.RUNNING = { ...draft.modalities.RUNNING, selected: true, practicing: false };
    draft.venues = ['FULL_GYM'];
    draft.externalSports = [
      { ...newExternalSport(), label: 'Jiu-jitsu', sessions: '3', minutes: '90' },
    ];
    expect(modalitiesComplete(draft)).toBe(true);
    const payload = modalitiesPayload(draft);
    expect(onboardingModalitiesStepSchema.safeParse(payload).success).toBe(true);
    expect(payload.modalities[1]).toMatchObject({
      modality: 'RUNNING',
      level: 'NONE',
      wantsToStart: true,
    });
  });

  it('modalidades: corrida usa km semanais e tempo de 5 km', () => {
    const draft = structuredClone(EMPTY_MODALITIES);
    draft.modalities.RUNNING = {
      ...draft.modalities.RUNNING,
      selected: true,
      level: 'BEGINNER',
      months: '6',
      sessions: '2',
      weeklyKm: '15',
      fiveK: '29:30',
    };
    draft.venues = ['OUTDOOR'];
    const payload = modalitiesPayload(draft);
    expect(payload.modalities[0]).toMatchObject({ weeklyKm: 15, recent5kSeconds: 1770 });
    expect(onboardingModalitiesStepSchema.safeParse(payload).success).toBe(true);
  });

  it('rotina: só os dias marcados viram janelas', () => {
    const draft = structuredClone(EMPTY_ROUTINE);
    draft.days.MON = { on: true, slot: 'EVENING', minutes: '60' };
    draft.days.SAT = { on: true, slot: 'MORNING', minutes: '90' };
    draft.maxSessions = '3';
    draft.mealsOutsideHomePerWeek = '4';
    expect(routineComplete(draft)).toBe(true);
    const payload = routinePayload(draft);
    expect(payload.windows.map((w) => w.weekday)).toEqual(['MON', 'SAT']);
    expect(onboardingRoutineStepSchema.safeParse(payload).success).toBe(true);
  });

  it('preferências: dor exige região e tendência para continuar', () => {
    const base = {
      ...EMPTY_PREFERENCES,
      split: 'UPPER_LOWER' as const,
      effort: 'UNSURE' as const,
      priority: 'BALANCED' as const,
    };
    expect(preferencesComplete(base)).toBe(true);
    expect(preferencesComplete({ ...base, pain: { ...base.pain, hasPain: true } })).toBe(false);
    expect(onboardingPreferencesStepSchema.safeParse(preferencesPayload(base)).success).toBe(true);
  });

  it('alimentação: alergia vazia é descartada', () => {
    const draft = {
      ...EMPTY_NUTRITION,
      mealsPerDay: '4',
      usualMeals: ['BREAKFAST' as const, 'LUNCH' as const],
      hunger: 'NORMAL' as const,
      allergies: [
        { allergen: 'amendoim', severity: 'SEVERE_ALLERGY' as const },
        { allergen: '  ', severity: 'ALLERGY' as const },
      ],
    };
    expect(nutritionComplete(draft)).toBe(true);
    const payload = nutritionPayload(draft);
    expect(payload.allergies).toHaveLength(1);
    expect(onboardingNutritionStepSchema.safeParse(payload).success).toBe(true);
  });

  it('corpo: só as medidas preenchidas entram', () => {
    const payload = bodyPayload({ WAIST: '92,5', HIP: '' }, '2026-10-27');
    expect(payload.measurements).toEqual([
      { kind: 'WAIST', value: 92.5, method: 'SELF_TAPE', measuredOn: '2026-10-27' },
    ]);
    expect(onboardingBodyStepSchema.safeParse(payload).success).toBe(true);
  });
});

describe('retomada a partir do que o servidor devolve', () => {
  it('objetivos, modalidades e rotina voltam ao rascunho', () => {
    const goals = goalsFromBlock({
      goal: { primary: 'FAT_LOSS', secondary: [], emphasis: 'HEALTH' },
    });
    expect(goals).toMatchObject({ primary: 'FAT_LOSS', emphasis: 'HEALTH', hasEvent: false });

    const modalities = modalitiesFromBlock({
      modalities: [
        {
          modality: 'STRENGTH',
          level: 'ADVANCED',
          monthsPracticing: 60,
          sessionsPerWeek: 4,
          wantsToStart: false,
        },
        {
          modality: 'HYROX',
          level: 'NONE',
          monthsPracticing: 0,
          sessionsPerWeek: 0,
          wantsToStart: true,
        },
      ],
      externalSports: [],
      venues: ['HYROX_GYM'],
    });
    expect(modalities.modalities.STRENGTH).toMatchObject({
      selected: true,
      level: 'ADVANCED',
      months: '60',
    });
    expect(modalities.modalities.HYROX).toMatchObject({ selected: true, practicing: false });
    expect(modalities.modalities.RUNNING.selected).toBe(false);

    const routine = routineFromBlock({
      windows: [{ weekday: 'TUE', slot: 'MORNING', maxMinutes: 45 }],
      variesWeekly: true,
      maxSessionsPerWeek: 2,
    });
    expect(routine.days.TUE).toEqual({ on: true, slot: 'MORNING', minutes: '45' });
    expect(routine.days.MON.on).toBe(false);
  });

  it('bloco ausente devolve o rascunho vazio', () => {
    expect(goalsFromBlock(undefined)).toBe(EMPTY_GOALS);
    expect(modalitiesFromBlock(undefined)).toBe(EMPTY_MODALITIES);
    expect(routineFromBlock({})).toBe(EMPTY_ROUTINE);
  });
});
