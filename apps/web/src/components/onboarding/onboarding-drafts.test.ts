import {
  onboardingBodyStepSchema,
  onboardingGoalsStepSchema,
  onboardingModalitiesStepSchema,
  onboardingNutritionStepSchema,
  onboardingPainStepSchema,
  onboardingPreferencesStepSchema,
  onboardingRoutineStepSchema,
} from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import {
  bodyPayload,
  bodyValid,
  EMPTY_GOALS,
  EMPTY_MODALITIES,
  EMPTY_NUTRITION,
  EMPTY_PAIN,
  EMPTY_PREFERENCES,
  EMPTY_ROUTINE,
  eventDateError,
  eventDistanceError,
  fiveKError,
  fixedDaysExceedSessions,
  foodBudgetError,
  goalsComplete,
  goalsFromBlock,
  goalsPayload,
  hyroxBestError,
  hyroxRacesError,
  mealsOutsideError,
  mealsPerDayError,
  measurementError,
  modalitiesComplete,
  modalitiesFromBlock,
  modalitiesPayload,
  newExternalSport,
  nutritionComplete,
  nutritionFromBlock,
  nutritionPayload,
  painComplete,
  painPayload,
  preferencesComplete,
  preferencesFromBlock,
  preferencesPayload,
  routineComplete,
  routineFromBlock,
  routinePayload,
  sessionsExceedDays,
  sleepError,
  sleepOutOfRange,
  sportDurationError,
  weeklyKmError,
} from './onboarding-drafts';

describe('payloads aceitos pelos contratos da API', () => {
  it('objetivos: com prova de corrida', () => {
    const draft = {
      ...EMPTY_GOALS,
      primary: 'RACE_PREPARATION' as const,
      secondary: ['STRENGTH' as const],
      emphasis: 'PERFORMANCE' as const,
      hasEvent: true,
      eventKind: 'RUNNING_RACE' as const,
      eventName: 'Meia Maratona do Rio',
      eventDate: '2027-06-20',
      eventDistanceKm: '21.1',
      motivation: 'Quero terminar bem',
    };
    expect(goalsComplete(draft)).toBe(true);
    const payload = goalsPayload(draft);
    expect(onboardingGoalsStepSchema.safeParse(payload).success).toBe(true);
    expect(payload.goal.targetEvent?.distanceMeters).toBe(21_100);
  });

  it('objetivos: evento exige modalidade, nome e data; sem evento não envia targetEvent', () => {
    const base = {
      ...EMPTY_GOALS,
      primary: 'HEALTH' as const,
      emphasis: 'BALANCED' as const,
      hasEvent: true,
    };
    expect(goalsComplete(base)).toBe(false);
    expect(
      goalsComplete({
        ...base,
        eventKind: 'OTHER_EVENT',
        eventName: 'Casamento',
        eventDate: '2027-01-10',
      }),
    ).toBe(true);
    expect(goalsComplete({ ...base, hasEvent: undefined })).toBe(false);
    expect(goalsPayload({ ...base, hasEvent: false }).goal).not.toHaveProperty('targetEvent');
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

  it('modalidades: quem quer começar vira nível NONE e o esporte externo usa o rótulo do esporte', () => {
    const draft = structuredClone(EMPTY_MODALITIES);
    draft.modalities.STRENGTH = {
      ...draft.modalities.STRENGTH,
      selected: true,
      practicing: true,
      level: 'INTERMEDIATE',
      sessions: '3',
      venue: 'FULL_GYM',
    };
    draft.modalities.RUNNING = {
      ...draft.modalities.RUNNING,
      selected: true,
      practicing: false,
      venue: 'TRACK',
    };
    draft.practicesOtherSport = true;
    draft.externalSports = [
      { ...newExternalSport(), sport: 'MARTIAL_ARTS', sessions: '3', duration: '1:30:00', rpe: 7 },
    ];
    expect(modalitiesComplete(draft)).toBe(true);
    const payload = modalitiesPayload(draft);
    expect(onboardingModalitiesStepSchema.safeParse(payload).success).toBe(true);
    expect(payload).not.toHaveProperty('venues');
    expect(payload.modalities[0]).toMatchObject({ sessionsPerWeek: 3, venue: 'FULL_GYM' });
    expect(payload.modalities[0]).not.toHaveProperty('fixedDays');
    expect(payload.modalities[1]).toMatchObject({
      modality: 'RUNNING',
      level: 'NONE',
      wantsToStart: true,
      venue: 'TRACK',
    });
    expect(payload.externalSports[0]).toMatchObject({
      label: 'Luta / artes marciais',
      minutesPerSession: 90,
      typicalRpe: 7,
    });
  });

  it('modalidades: corrida usa km semanais e tempo de 5 km', () => {
    const draft = structuredClone(EMPTY_MODALITIES);
    draft.modalities.RUNNING = {
      ...draft.modalities.RUNNING,
      selected: true,
      practicing: true,
      level: 'BEGINNER',
      sessions: '2',
      weeklyKm: '15',
      fiveK: '29:30',
      venue: 'OUTDOOR',
    };
    draft.practicesOtherSport = false;
    expect(modalitiesComplete(draft)).toBe(true);
    const payload = modalitiesPayload(draft);
    expect(payload.modalities[0]).toMatchObject({ weeklyKm: 15, recent5kSeconds: 1770 });
    expect(onboardingModalitiesStepSchema.safeParse(payload).success).toBe(true);
  });

  it('modalidades: HYROX leva provas e melhor tempo em hh:mm:ss', () => {
    const draft = structuredClone(EMPTY_MODALITIES);
    draft.modalities.HYROX = {
      ...draft.modalities.HYROX,
      selected: true,
      practicing: true,
      level: 'ADVANCED',
      sessions: '4',
      hyroxRaces: '2',
      hyroxBest: '01:25:00',
      venue: 'HYROX_GYM',
    };
    draft.practicesOtherSport = false;
    expect(modalitiesComplete(draft)).toBe(true);
    const payload = modalitiesPayload(draft);
    expect(payload.modalities[0]).toMatchObject({ hyroxRaces: 2, hyroxBestSeconds: 5100 });
    expect(onboardingModalitiesStepSchema.safeParse(payload).success).toBe(true);
  });

  it('modalidades: pede resposta de "já pratica", nível, dias, local e outro esporte', () => {
    const draft = structuredClone(EMPTY_MODALITIES);
    draft.modalities.STRENGTH.selected = true;
    draft.practicesOtherSport = false;
    expect(modalitiesComplete(draft)).toBe(false); // não respondeu "já pratica"
    draft.modalities.STRENGTH.practicing = true;
    draft.modalities.STRENGTH.level = 'BEGINNER';
    draft.modalities.STRENGTH.sessions = '3';
    expect(modalitiesComplete(draft)).toBe(false); // falta o local
    draft.modalities.STRENGTH.venue = 'HOME';
    expect(modalitiesComplete(draft)).toBe(true);
    draft.modalities.STRENGTH.sessions = '';
    expect(modalitiesComplete(draft)).toBe(false); // falta dias
    draft.modalities.STRENGTH.sessions = '3';
    draft.practicesOtherSport = true;
    expect(modalitiesComplete(draft)).toBe(false); // disse que pratica, mas sem esporte
    draft.externalSports = [newExternalSport()];
    expect(modalitiesComplete(draft)).toBe(false); // esporte incompleto
    const swimming = {
      ...newExternalSport(),
      sport: 'SWIMMING' as const,
      sessions: '2',
      duration: '45:00',
      rpe: 5,
    };
    draft.externalSports = [{ ...swimming, fixedDays: ['MON', 'WED', 'FRI'] }];
    expect(fixedDaysExceedSessions('2', ['MON', 'WED', 'FRI'])).toBe(true);
    expect(modalitiesComplete(draft)).toBe(false); // mais dias fixos que dias por semana
    draft.externalSports = [{ ...swimming, fixedDays: ['MON', 'WED'] }];
    expect(modalitiesComplete(draft)).toBe(true);
  });

  it('modalidades: quem quer começar também escolhe o local, e o local precisa servir à modalidade', () => {
    const draft = structuredClone(EMPTY_MODALITIES);
    draft.modalities.RUNNING = { ...draft.modalities.RUNNING, selected: true, practicing: false };
    draft.practicesOtherSport = false;
    expect(modalitiesComplete(draft)).toBe(false);
    expect(onboardingModalitiesStepSchema.safeParse(modalitiesPayload(draft)).success).toBe(false);
    draft.modalities.RUNNING.venue = 'HOME';
    expect(onboardingModalitiesStepSchema.safeParse(modalitiesPayload(draft)).success).toBe(false);
    draft.modalities.RUNNING.venue = 'TRACK';
    expect(modalitiesComplete(draft)).toBe(true);
    expect(onboardingModalitiesStepSchema.safeParse(modalitiesPayload(draft)).success).toBe(true);
  });

  it('rotina: sem dias diferentes, os dias marcados viram janelas com o mesmo período e tempo', () => {
    const draft: typeof EMPTY_ROUTINE = {
      ...EMPTY_ROUTINE,
      days: ['SAT', 'MON', 'WED'],
      slot: 'MORNING',
      availableMinutes: '90',
      // Diferenças guardadas sem o "sim" não valem.
      overrides: { WED: { slot: 'EVENING', minutes: '30' } },
      variesWeekly: false,
      daysWanted: '3',
      sleep: '07:30',
      stress: 'MODERATE',
    };
    expect(routineComplete(draft)).toBe(true);
    const payload = routinePayload(draft);
    expect(payload.windows).toEqual([
      { weekday: 'MON', slot: 'MORNING', maxMinutes: 90 },
      { weekday: 'WED', slot: 'MORNING', maxMinutes: 90 },
      { weekday: 'SAT', slot: 'MORNING', maxMinutes: 90 },
    ]);
    expect(payload.maxSessionsPerWeek).toBe(3);
    expect(payload.lifeContext).toEqual({ sleepHoursTypical: 7.5, stressLevel: 'MODERATE' });
    expect(onboardingRoutineStepSchema.safeParse(payload).success).toBe(true);
  });

  it('rotina: dia com período ou tempo próprio gera a sua janela; os outros seguem o padrão', () => {
    const draft: typeof EMPTY_ROUTINE = {
      ...EMPTY_ROUTINE,
      days: ['MON', 'WED', 'SAT'],
      slot: 'EVENING',
      availableMinutes: '45',
      hasDayOverrides: true,
      overrides: { SAT: { slot: 'MORNING', minutes: '90' }, WED: { slot: 'EVENING', minutes: '' } },
      variesWeekly: false,
      daysWanted: '2',
    };
    expect(routineComplete(draft)).toBe(true);
    const payload = routinePayload(draft);
    expect(payload.windows).toEqual([
      { weekday: 'MON', slot: 'EVENING', maxMinutes: 45 },
      { weekday: 'WED', slot: 'EVENING', maxMinutes: 45 },
      { weekday: 'SAT', slot: 'MORNING', maxMinutes: 90 },
    ]);
    expect(payload.maxSessionsPerWeek).toBe(2);
    expect(onboardingRoutineStepSchema.safeParse(payload).success).toBe(true);
  });

  it('rotina: mais treinos do que dias marcados não continua (nem passaria na API)', () => {
    const draft: typeof EMPTY_ROUTINE = {
      ...EMPTY_ROUTINE,
      days: ['MON', 'THU'],
      slot: 'ANY',
      availableMinutes: '60',
      variesWeekly: true,
      daysWanted: '3',
    };
    expect(sessionsExceedDays(draft)).toBe(true);
    expect(routineComplete(draft)).toBe(false);
    expect(onboardingRoutineStepSchema.safeParse(routinePayload(draft)).success).toBe(false);
    expect(routineComplete({ ...draft, daysWanted: '2' })).toBe(true);
  });

  it('rotina: sono e estresse são opcionais, mas sono fora de 3 a 12 horas bloqueia', () => {
    const base = {
      ...EMPTY_ROUTINE,
      days: ['MON' as const],
      slot: 'ANY' as const,
      availableMinutes: '30',
      variesWeekly: true,
      daysWanted: '1',
    };
    expect(routineComplete(base)).toBe(true);
    expect(routinePayload(base).lifeContext).toEqual({});
    expect(sleepOutOfRange('02:00')).toBe(true);
    expect(sleepOutOfRange('13:00')).toBe(true);
    expect(sleepOutOfRange('07:30')).toBe(false);
    expect(routineComplete({ ...base, sleep: '02:00' })).toBe(false);
    expect(routineComplete({ ...base, sleep: '07:' })).toBe(false);
    expect(routineComplete({ ...base, variesWeekly: undefined })).toBe(false);
    expect(routineComplete({ ...base, daysWanted: '' })).toBe(false);
  });

  it('preferências: prioridade e as perguntas de sim ou não são obrigatórias; "sim" exige o texto', () => {
    const base = {
      ...EMPTY_PREFERENCES,
      priority: 'BALANCED' as const,
      hasTrainingPreferences: false,
      hasDislikedExercises: false,
      hasCondition: false,
      hasProfessionalGuidance: false,
    };
    expect(preferencesComplete(base)).toBe(true);
    for (const key of [
      'hasTrainingPreferences',
      'hasDislikedExercises',
      'hasProfessionalGuidance',
    ] as const) {
      expect(preferencesComplete({ ...base, [key]: undefined })).toBe(false);
      expect(preferencesComplete({ ...base, [key]: true })).toBe(false);
    }
    expect(
      preferencesComplete({ ...base, hasTrainingPreferences: true, trainingPreferences: 'curtos' }),
    ).toBe(true);
    expect(
      preferencesComplete({ ...base, hasDislikedExercises: true, dislikedExercises: 'burpee' }),
    ).toBe(true);
    expect(
      preferencesComplete({ ...base, hasProfessionalGuidance: true, professionalGuidance: 'dr.' }),
    ).toBe(true);
    expect(preferencesComplete({ ...base, hasCondition: undefined })).toBe(false);
    expect(preferencesComplete({ ...base, hasCondition: true })).toBe(false);
    expect(preferencesComplete({ ...base, hasCondition: true, medications: 'losartana' })).toBe(
      true,
    );
    expect(onboardingPreferencesStepSchema.safeParse(preferencesPayload(base)).success).toBe(true);
  });

  it('preferências: ênfase muscular e texto de preferências seguem no payload', () => {
    const payload = preferencesPayload({
      ...EMPTY_PREFERENCES,
      priority: 'ENJOYMENT',
      muscleEmphasis: ['GLUTES', 'BACK'],
      hasTrainingPreferences: true,
      trainingPreferences: ' treinos curtos ',
      hasCondition: true,
      conditions: 'asma',
    });
    expect(payload.preferences.muscleEmphasis).toEqual(['GLUTES', 'BACK']);
    expect(payload.trainingPreferences).toBe('treinos curtos');
    expect(payload.conditions).toBe('asma');
    expect(onboardingPreferencesStepSchema.safeParse(payload).success).toBe(true);
  });

  it('preferências: responder "não" descarta o texto que sobrou nos campos', () => {
    const payload = preferencesPayload({
      ...EMPTY_PREFERENCES,
      priority: 'BALANCED',
      hasTrainingPreferences: false,
      trainingPreferences: 'texto antigo',
      hasDislikedExercises: false,
      dislikedExercises: 'texto antigo',
      hasCondition: false,
      conditions: 'texto antigo',
      hasProfessionalGuidance: false,
      professionalGuidance: 'texto antigo',
    });
    expect(payload.trainingPreferences).toBeUndefined();
    expect(payload.dislikedExercises).toBeUndefined();
    expect(payload.conditions).toBeUndefined();
    expect(payload.professionalGuidance).toBeUndefined();
  });

  it('dores: a resposta é obrigatória e, com dor, exige região, tendência e as perguntas seguintes', () => {
    expect(painComplete(EMPTY_PAIN)).toBe(false);
    const none = { ...EMPTY_PAIN, hasPain: false };
    expect(painComplete(none)).toBe(true);
    expect(onboardingPainStepSchema.safeParse(painPayload(none)).success).toBe(true);

    const withPain = {
      ...EMPTY_PAIN,
      hasPain: true,
      points: [{ region: 'KNEE' as const, intensity: 6, regionOther: '' }],
    };
    expect(painComplete(withPain)).toBe(false);
    const answered = {
      ...withPain,
      trend: 'STABLE' as const,
      hasProfessionalExplanation: false,
      underMedicalFollowUp: false,
      hasAvoidanceRecommendation: false,
    };
    expect(painComplete(answered)).toBe(true);
    expect(onboardingPainStepSchema.safeParse(painPayload(answered)).success).toBe(true);
    expect(painComplete({ ...answered, hasAvoidanceRecommendation: true })).toBe(false);
  });

  it('alimentação: alergia vazia é descartada e o contexto de vida vai junto', () => {
    const draft = {
      ...EMPTY_NUTRITION,
      cookingCapacity: 'BASIC' as const,
      mealsOutsideHomePerWeek: '4',
      foodBudgetCents: '120050',
      mealsPerDay: '4',
      usualMeals: ['BREAKFAST' as const, 'LUNCH' as const],
      hasAllergy: true,
      hunger: 'NORMAL' as const,
      allergies: [
        { allergen: 'amendoim', severity: 'SEVERE_ALLERGY' as const },
        { allergen: '  ', severity: 'ALLERGY' as const },
      ],
    };
    expect(nutritionComplete(draft)).toBe(false); // há alergia sem nome
    const clean = { ...draft, allergies: draft.allergies.slice(0, 1) };
    expect(nutritionComplete(clean)).toBe(true);
    const payload = nutritionPayload(draft);
    expect(payload.allergies).toHaveLength(1);
    expect(payload).toMatchObject({ cookingCapacity: 'BASIC', mealsOutsideHomePerWeek: 4 });
    expect(onboardingNutritionStepSchema.safeParse(payload).success).toBe(true);
  });

  it('alimentação: "Outro" suplemento exige o nome e só então ele é enviado', () => {
    const base = {
      ...EMPTY_NUTRITION,
      cookingCapacity: 'GOOD' as const,
      mealsOutsideHomePerWeek: '0',
      foodBudgetCents: '60000',
      mealsPerDay: '3',
      usualMeals: ['LUNCH' as const],
      hasAllergy: false,
      hunger: 'HIGH' as const,
      supplements: ['OTHER' as const],
    };
    expect(nutritionComplete(base)).toBe(false);
    const named = { ...base, supplementOther: ' colágeno ' };
    expect(nutritionComplete(named)).toBe(true);
    const payload = nutritionPayload(named);
    expect(payload.supplementOther).toBe('colágeno');
    expect(onboardingNutritionStepSchema.safeParse(payload).success).toBe(true);
    expect(nutritionPayload({ ...named, supplements: ['WHEY'] }).supplementOther).toBeUndefined();
  });

  it('corpo: só as medidas preenchidas entram', () => {
    const payload = bodyPayload({ WAIST: '92.5', HIP: '' }, '2026-10-27');
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
          sessionsPerWeek: 4,
          venue: 'CONDO_GYM',
          wantsToStart: false,
        },
        { modality: 'HYROX', level: 'NONE', sessionsPerWeek: 0, wantsToStart: true, venue: 'HOME' },
        {
          modality: 'RUNNING',
          level: 'BEGINNER',
          sessionsPerWeek: 2,
          weeklyKm: 12.5,
          recent5kSeconds: 3930,
          wantsToStart: false,
          venue: 'TRACK',
        },
      ],
      externalSports: [
        {
          sport: 'SWIMMING',
          sessionsPerWeek: 2,
          minutesPerSession: 75,
          typicalRpe: 5,
          fixedDays: ['MON'],
        },
      ],
    });
    expect(modalities.modalities.STRENGTH).toMatchObject({
      selected: true,
      practicing: true,
      level: 'ADVANCED',
      sessions: '4',
      venue: 'CONDO_GYM',
    });
    expect(modalities.modalities.HYROX).toMatchObject({
      selected: true,
      practicing: false,
      level: null,
      venue: 'HOME',
    });
    expect(modalities.modalities.RUNNING).toMatchObject({
      weeklyKm: '12.5',
      fiveK: '1:05:30',
      venue: 'TRACK',
    });
    expect(modalities.modalities.STRENGTH.selected).toBe(true);
    expect(modalities.practicesOtherSport).toBe(true);
    expect(modalities.externalSports[0]).toEqual({
      sport: 'SWIMMING',
      sessions: '2',
      duration: '1:15:00',
      rpe: 5,
      fixedDays: ['MON'],
    });

    const routine = routineFromBlock({
      windows: [
        { weekday: 'TUE', slot: 'MORNING', maxMinutes: 45 },
        { weekday: 'THU', slot: 'MORNING', maxMinutes: 45 },
      ],
      variesWeekly: true,
      maxSessionsPerWeek: 2,
      lifeContext: { sleepHoursTypical: 7.5, stressLevel: 'HIGH' },
    });
    expect(routine).toMatchObject({
      days: ['TUE', 'THU'],
      slot: 'MORNING',
      availableMinutes: '45',
      hasDayOverrides: undefined,
      overrides: {},
      variesWeekly: true,
      daysWanted: '2',
      sleep: '07:30',
      stress: 'HIGH',
    });
  });

  it('modalidades de bloco antigo (local único em `venues`) ganham o local de cada uma', () => {
    const modalities = modalitiesFromBlock({
      modalities: [
        { modality: 'STRENGTH', level: 'BEGINNER', sessionsPerWeek: 3, wantsToStart: false },
        { modality: 'RUNNING', level: 'NONE', sessionsPerWeek: 0, wantsToStart: true },
        { modality: 'HYROX', level: 'NONE', sessionsPerWeek: 0, wantsToStart: true },
      ],
      externalSports: [],
      venues: ['OUTDOOR', 'FULL_GYM'],
    });
    expect(modalities.modalities.STRENGTH.venue).toBe('FULL_GYM');
    expect(modalities.modalities.RUNNING.venue).toBe('OUTDOOR');
    expect(modalities.modalities.HYROX.venue).toBe('FULL_GYM');
    expect(modalities).not.toHaveProperty('venues');
    const payload = modalitiesPayload({ ...modalities, practicesOtherSport: false });
    expect(onboardingModalitiesStepSchema.safeParse(payload).success).toBe(true);
  });

  it('rotina: o padrão é o período e o tempo mais frequentes; os outros dias viram diferenças', () => {
    const routine = routineFromBlock({
      windows: [
        { weekday: 'MON', slot: 'EVENING', maxMinutes: 45 },
        { weekday: 'WED', slot: 'EVENING', maxMinutes: 45 },
        { weekday: 'FRI', slot: 'EVENING', maxMinutes: 30 },
        { weekday: 'SAT', slot: 'MORNING', maxMinutes: 120 },
      ],
      variesWeekly: false,
      maxSessionsPerWeek: 3,
      lifeContext: {},
    });
    expect(routine).toMatchObject({
      days: ['MON', 'WED', 'FRI', 'SAT'],
      slot: 'EVENING',
      availableMinutes: '45',
      hasDayOverrides: true,
      overrides: {
        FRI: { slot: 'EVENING', minutes: '30' },
        SAT: { slot: 'MORNING', minutes: '90' },
      },
      daysWanted: '3',
    });
    expect(routinePayload(routine).windows).toEqual([
      { weekday: 'MON', slot: 'EVENING', maxMinutes: 45 },
      { weekday: 'WED', slot: 'EVENING', maxMinutes: 45 },
      { weekday: 'FRI', slot: 'EVENING', maxMinutes: 30 },
      { weekday: 'SAT', slot: 'MORNING', maxMinutes: 90 },
    ]);
  });

  it('preferências e alimentação devolvem só a parte comum', () => {
    expect(
      preferencesFromBlock({
        preferences: {
          priority: 'BALANCED',
          preferredSessionMinutes: 70,
          muscleEmphasis: ['ARMS'],
        },
      }),
    ).toMatchObject({ priority: 'BALANCED', muscleEmphasis: ['ARMS'] });
    expect(
      nutritionFromBlock({
        cookingCapacity: 'NONE',
        mealsOutsideHomePerWeek: 0,
        foodBudgetMonthlyBrl: 2500.5,
        mealsPerDay: 5,
        usualMeals: ['LUNCH'],
        hunger: 'LOW',
      }),
    ).toMatchObject({
      cookingCapacity: 'NONE',
      mealsOutsideHomePerWeek: '0',
      foodBudgetCents: '250050',
      mealsPerDay: '5',
      hasAllergy: undefined,
    });
  });

  it('bloco ausente devolve o rascunho vazio', () => {
    expect(goalsFromBlock(undefined)).toBe(EMPTY_GOALS);
    expect(modalitiesFromBlock(undefined)).toBe(EMPTY_MODALITIES);
    expect(routineFromBlock({})).toBe(EMPTY_ROUTINE);
    expect(preferencesFromBlock(undefined)).toBe(EMPTY_PREFERENCES);
    expect(nutritionFromBlock(undefined)).toBe(EMPTY_NUTRITION);
  });
});

describe('faixas e formatos (o que a API recusaria nunca sai do formulário)', () => {
  const NOW = new Date(2026, 9, 30);

  it('evento: data a partir de hoje e até 3 anos; distância de 1 a 100 km', () => {
    expect(eventDateError('2026-10-29', NOW)).toMatch(/a partir de hoje/);
    expect(eventDateError('2026-10-30', NOW)).toBeUndefined();
    expect(eventDateError('2030-01-01', NOW)).toMatch(/até 3 anos/);
    expect(eventDistanceError('0.5')).toBe('Informe uma distância entre 1 e 100 km.');
    expect(eventDistanceError('42.2')).toBeUndefined();
    expect(eventDistanceError('')).toBeUndefined();
    const race = {
      ...EMPTY_GOALS,
      primary: 'RACE_PREPARATION' as const,
      emphasis: 'PERFORMANCE' as const,
      hasEvent: true,
      eventKind: 'RUNNING_RACE' as const,
      eventName: 'Ultra',
      eventDate: '2027-06-20',
    };
    expect(goalsComplete({ ...race, eventDistanceKm: '150' })).toBe(false);
    expect(goalsComplete({ ...race, eventDate: '2020-01-01' })).toBe(false);
  });

  it('corrida e HYROX: km, tempos incompletos ou fora da faixa bloqueiam', () => {
    expect(weeklyKmError('301')).toMatch(/0 a 300 km/);
    expect(fiveKError('25:3')).toMatch(/mm:ss/);
    expect(fiveKError('05:00')).toMatch(/entre 10:00 e 2:00:00/);
    expect(fiveKError('24:59')).toBeUndefined();
    expect(hyroxRacesError('101')).toMatch(/0 a 100/);
    expect(hyroxBestError('00:30:00')).toMatch(/00:40:00/);
    expect(sportDurationError('05:00')).toMatch(/10 minutos/);
    expect(sportDurationError('45:00')).toBeUndefined();

    const draft = structuredClone(EMPTY_MODALITIES);
    draft.modalities.RUNNING = {
      ...draft.modalities.RUNNING,
      selected: true,
      practicing: true,
      level: 'BEGINNER',
      sessions: '2',
      weeklyKm: '15',
      fiveK: '25:3',
      venue: 'OUTDOOR',
    };
    draft.practicesOtherSport = false;
    expect(modalitiesComplete(draft)).toBe(false);
  });

  it('HYROX sem prova feita não envia melhor tempo esquecido no rascunho', () => {
    const draft = structuredClone(EMPTY_MODALITIES);
    draft.modalities.HYROX = {
      ...draft.modalities.HYROX,
      selected: true,
      practicing: true,
      level: 'BEGINNER',
      sessions: '2',
      hyroxRaces: '0',
      hyroxBest: '01:25:00',
      venue: 'HYROX_GYM',
    };
    draft.practicesOtherSport = false;
    expect(modalitiesComplete(draft)).toBe(true);
    const payload = modalitiesPayload(draft);
    expect(payload.modalities[0]).not.toHaveProperty('hyroxBestSeconds');
    expect(onboardingModalitiesStepSchema.safeParse(payload).success).toBe(true);
  });

  it('sono incompleto pede o formato hh:mm', () => {
    expect(sleepError('07:')).toMatch(/hh:mm/);
    expect(sleepError('07:30')).toBeUndefined();
    expect(sleepError('')).toBeUndefined();
  });

  it('alimentação: orçamento acima do teto da API e refeições fora da faixa bloqueiam', () => {
    expect(foodBudgetError('0')).toBe('Informe um valor maior que zero.');
    expect(foodBudgetError('100000001')).toBe('Informe um valor de até R$ 1.000.000,00.');
    expect(foodBudgetError('100000000')).toBeUndefined();
    expect(mealsOutsideError('22')).toMatch(/0 a 21/);
    expect(mealsPerDayError('9')).toMatch(/1 a 8/);
    expect(mealsPerDayError('0')).toMatch(/1 a 8/);
    const base = {
      ...EMPTY_NUTRITION,
      cookingCapacity: 'BASIC' as const,
      mealsOutsideHomePerWeek: '2',
      foodBudgetCents: '999999999',
      mealsPerDay: '4',
      usualMeals: ['LUNCH' as const],
      hasAllergy: false,
      hunger: 'NORMAL' as const,
    };
    expect(nutritionComplete(base)).toBe(false);
    expect(nutritionComplete({ ...base, foodBudgetCents: '120000' })).toBe(true);
  });

  it('medidas: só bloqueia valor preenchido fora da faixa plausível', () => {
    expect(measurementError('ARM', '90')).toBe('Informe entre 15 e 70 cm.');
    expect(measurementError('WAIST', '92')).toBeUndefined();
    expect(bodyValid({})).toBe(true);
    expect(bodyValid({ WAIST: '92', CALF: '5' })).toBe(false);
    expect(
      onboardingBodyStepSchema.safeParse(bodyPayload({ WAIST: '92' }, '2026-10-30')).success,
    ).toBe(true);
  });
});
