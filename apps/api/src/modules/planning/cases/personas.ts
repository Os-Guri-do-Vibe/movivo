/**
 * Alunos sintéticos dos casos de avaliação do planejamento.
 *
 * Cada persona é um conjunto de FATIAS do Estado do Aluno no mesmo formato que o
 * `StudentStateReader` produz; as entradas das tarefas são montadas pelo código de produção
 * (`inputs.ts`) a partir delas, então a avaliação exercita o mesmo caminho do mundo real.
 */
import type {
  AvailabilityWindow,
  DeclaredGoal,
  ExternalSportPractice,
  LifeContext,
  ModalityExperience,
  TrainingVenue,
} from '@movivo/shared';

import { parseStateView, type StateView } from '../state-view';

export const EVAL_TODAY = '2026-11-02';

export interface Persona {
  id: string;
  slices: Record<string, unknown>;
}

export interface PersonaSpec {
  id: string;
  age: number;
  sex: 'MALE' | 'FEMALE';
  heightCm: number;
  weightKg: number;
  waistCm?: number;
  bodyFatPercent?: number;
  goal: DeclaredGoal;
  modalities: ModalityExperience[];
  externalSports?: ExternalSportPractice[];
  venues: TrainingVenue[];
  windows: AvailabilityWindow[];
  maxSessionsPerWeek: number;
  life?: Partial<LifeContext>;
  restrictions?: string[];
  preferences?: { domain: string; key: string; value: string | number; strength?: string }[];
  signals?: { kind: string; severity: string; scope: string }[];
  health?: { kind: string; summary: string; movementTags?: string[] }[];
}

const LIFE: LifeContext = {
  occupationRhythm: 'REGULAR',
  cookingCapacity: 'BASIC',
  mealsOutsideHomePerWeek: 4,
  foodBudget: 'MODERATE',
  sleepHoursTypical: 7,
  stressLevel: 'MODERATE',
};

export function persona(spec: PersonaSpec): Persona {
  const measurement = (value: number) => ({ latest: value, on: EVAL_TODAY, previous: null });
  return {
    id: spec.id,
    slices: {
      identity: {
        ageYears: spec.age,
        biologicalSex: spec.sex,
        heightCm: spec.heightCm,
        timezone: 'America/Sao_Paulo',
        lifeContext: { ...LIFE, ...spec.life },
      },
      goals: {
        goalId: `00000000-0000-4000-8000-${spec.id.replace(/\D/g, '').padStart(12, '0').slice(0, 12)}`,
        declared: spec.goal,
        strategy: null,
        startedOn: EVAL_TODAY,
        reviewOn: null,
        milestones: [],
        currentTasks: [],
      },
      availability: [
        {
          kind: 'AVAILABILITY',
          windows: spec.windows,
          variesWeekly: false,
          maxSessionsPerWeek: spec.maxSessionsPerWeek,
        },
      ],
      restrictions: (spec.restrictions ?? []).map((restriction) => ({
        kind: 'DIETARY_RESTRICTION',
        restriction,
      })),
      preferences: (spec.preferences ?? []).map((p) => ({
        strength: 'STRONG',
        origin: 'DECLARED',
        confidence: 80,
        ...p,
      })),
      training: {
        modalities: spec.modalities,
        externalSports: spec.externalSports ?? [],
        venues: spec.venues,
        activePlan: null,
        last21Days: [],
        next7Days: [],
      },
      nutrition: { activePlan: null, last7Days: [] },
      body: {
        WEIGHT: measurement(spec.weightKg),
        ...(spec.waistCm ? { WAIST: measurement(spec.waistCm) } : {}),
        ...(spec.bodyFatPercent ? { BODY_FAT_PERCENT: measurement(spec.bodyFatPercent) } : {}),
      },
      safety: {
        activeSignals: spec.signals ?? [],
        healthConsent: true,
        healthRecords: spec.health ?? [],
      },
      recentDecisions: [],
    },
  };
}

export const view = (p: Persona): StateView => parseStateView(p.slices);

const evening = (
  weekday: AvailabilityWindow['weekday'],
  maxMinutes: number,
): AvailabilityWindow => ({
  weekday,
  slot: 'EVENING',
  maxMinutes,
});
const morning = (
  weekday: AvailabilityWindow['weekday'],
  maxMinutes: number,
): AvailabilityWindow => ({
  weekday,
  slot: 'MORNING',
  maxMinutes,
});

const strengthExp = (
  level: ModalityExperience['level'],
  months: number,
  wantsToStart = false,
): ModalityExperience => ({
  modality: 'STRENGTH',
  level,
  monthsPracticing: months,
  sessionsPerWeek: months === 0 ? 0 : 3,
  wantsToStart,
});

const plusDays = (days: number) =>
  new Date(Date.parse(`${EVAL_TODAY}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Hipertrofia pedida por quem tem adiposidade alta (cintura/altura 0,60): o caso da recomposição. */
export const HIPERTROFIA_ADIPOSIDADE_ALTA = persona({
  id: 'p01',
  age: 32,
  sex: 'MALE',
  heightCm: 178,
  weightKg: 98,
  waistCm: 106,
  goal: { primary: 'HYPERTROPHY', secondary: [], emphasis: 'AESTHETICS' },
  modalities: [strengthExp('INTERMEDIATE', 30)],
  venues: ['FULL_GYM'],
  windows: [evening('MON', 75), evening('WED', 75), evening('FRI', 75), evening('SAT', 75)],
  maxSessionsPerWeek: 4,
  preferences: [
    { domain: 'FOOD', key: 'meals_per_day', value: 4 },
    { domain: 'FOOD', key: 'usual_meals', value: 'BREAKFAST,LUNCH,AFTERNOON_SNACK,DINNER' },
  ],
});

/** Iniciante, em casa, com pouco tempo: o que importa é consistência. */
export const INICIANTE_EM_CASA = persona({
  id: 'p02',
  age: 27,
  sex: 'FEMALE',
  heightCm: 165,
  weightKg: 64,
  waistCm: 76,
  goal: { primary: 'START_TRAINING', secondary: ['HEALTH'], emphasis: 'HEALTH' },
  modalities: [strengthExp('NONE', 0, true)],
  venues: ['HOME'],
  windows: [morning('TUE', 40), morning('THU', 40), morning('SAT', 45)],
  maxSessionsPerWeek: 3,
  life: { cookingCapacity: 'GOOD', foodBudget: 'TIGHT' },
  restrictions: ['VEGETARIAN'],
  preferences: [
    { domain: 'FOOD', key: 'meals_per_day', value: 4 },
    { domain: 'FOOD', key: 'usual_meals', value: 'BREAKFAST,LUNCH,AFTERNOON_SNACK,DINNER' },
  ],
  health: [{ kind: 'FOOD_ALLERGY', summary: 'amendoim (ALLERGY)' }],
});

/** Atleta HYROX com prova daqui a 10 semanas. */
export const HYROX_EM_10_SEMANAS = persona({
  id: 'p03',
  age: 29,
  sex: 'MALE',
  heightCm: 180,
  weightKg: 82,
  waistCm: 82,
  goal: {
    primary: 'HYROX_PREPARATION',
    secondary: [],
    emphasis: 'PERFORMANCE',
    targetEvent: { kind: 'HYROX_RACE', name: 'HYROX São Paulo', date: plusDays(70) },
  },
  modalities: [
    {
      modality: 'HYROX',
      level: 'INTERMEDIATE',
      monthsPracticing: 10,
      sessionsPerWeek: 2,
      hyroxRaces: 1,
      wantsToStart: false,
    },
    {
      modality: 'RUNNING',
      level: 'INTERMEDIATE',
      monthsPracticing: 24,
      sessionsPerWeek: 3,
      weeklyKm: 28,
      recent5kSeconds: 1_560,
      wantsToStart: false,
    },
    strengthExp('INTERMEDIATE', 24),
  ],
  venues: ['HYROX_GYM'],
  windows: [
    evening('MON', 80),
    evening('TUE', 80),
    evening('THU', 80),
    evening('FRI', 80),
    morning('SAT', 120),
  ],
  maxSessionsPerWeek: 5,
  preferences: [
    { domain: 'FOOD', key: 'meals_per_day', value: 5 },
    {
      domain: 'FOOD',
      key: 'usual_meals',
      value: 'BREAKFAST,LUNCH,AFTERNOON_SNACK,DINNER,PRE_WORKOUT',
    },
  ],
});

/** Musculação + corrida iniciante + luta três vezes por semana (dias fixos). */
export const HIBRIDO_COM_LUTA = persona({
  id: 'p04',
  age: 30,
  sex: 'MALE',
  heightCm: 175,
  weightKg: 78,
  waistCm: 80,
  goal: { primary: 'CONDITIONING', secondary: ['HYPERTROPHY'], emphasis: 'BALANCED' },
  modalities: [
    strengthExp('INTERMEDIATE', 18),
    {
      modality: 'RUNNING',
      level: 'BEGINNER',
      monthsPracticing: 2,
      sessionsPerWeek: 1,
      weeklyKm: 8,
      wantsToStart: true,
    },
  ],
  externalSports: [
    {
      sport: 'MARTIAL_ARTS',
      label: 'Jiu-jitsu',
      sessionsPerWeek: 3,
      minutesPerSession: 60,
      typicalRpe: 7,
      fixedDays: ['MON', 'WED', 'FRI'],
    },
  ],
  venues: ['FULL_GYM'],
  windows: [
    evening('MON', 90),
    evening('TUE', 90),
    evening('WED', 90),
    evening('THU', 90),
    evening('FRI', 90),
    morning('SAT', 90),
  ],
  maxSessionsPerWeek: 6,
  preferences: [
    { domain: 'FOOD', key: 'meals_per_day', value: 4 },
    { domain: 'FOOD', key: 'usual_meals', value: 'BREAKFAST,LUNCH,AFTERNOON_SNACK,DINNER' },
  ],
});

/** Sinais de transtorno alimentar: nada de restrição energética. */
export const SINAIS_DE_TRANSTORNO_ALIMENTAR = persona({
  id: 'p05',
  age: 22,
  sex: 'FEMALE',
  heightCm: 160,
  weightKg: 52,
  waistCm: 66,
  goal: { primary: 'FAT_LOSS', secondary: [], emphasis: 'AESTHETICS' },
  modalities: [strengthExp('BEGINNER', 5)],
  venues: ['BASIC_GYM'],
  windows: [evening('MON', 60), evening('WED', 60), evening('FRI', 60)],
  maxSessionsPerWeek: 3,
  signals: [{ kind: 'EATING_DISORDER_SIGNS', severity: 'URGENT', scope: 'NUTRITION' }],
  preferences: [
    { domain: 'FOOD', key: 'meals_per_day', value: 3 },
    { domain: 'FOOD', key: 'usual_meals', value: 'BREAKFAST,LUNCH,DINNER' },
  ],
});

/** Corredor avançado que quer ganhar força para a meia maratona. */
export const CORREDOR_QUE_QUER_FORCA = persona({
  id: 'p06',
  age: 40,
  sex: 'MALE',
  heightCm: 174,
  weightKg: 72,
  waistCm: 78,
  goal: {
    primary: 'RACE_PREPARATION',
    secondary: ['STRENGTH'],
    emphasis: 'PERFORMANCE',
    targetEvent: {
      kind: 'RUNNING_RACE',
      name: 'Meia maratona',
      date: plusDays(84),
      distanceMeters: 21_097,
      targetSeconds: 6_300,
    },
  },
  modalities: [
    {
      modality: 'RUNNING',
      level: 'ADVANCED',
      monthsPracticing: 96,
      sessionsPerWeek: 5,
      weeklyKm: 50,
      recent5kSeconds: 1_260,
      wantsToStart: false,
    },
    strengthExp('BEGINNER', 0, true),
  ],
  venues: ['FULL_GYM'],
  windows: [
    morning('MON', 60),
    morning('TUE', 75),
    morning('THU', 75),
    morning('FRI', 60),
    morning('SAT', 150),
    morning('SUN', 60),
  ],
  maxSessionsPerWeek: 6,
  preferences: [
    { domain: 'FOOD', key: 'meals_per_day', value: 5 },
    {
      domain: 'FOOD',
      key: 'usual_meals',
      value: 'BREAKFAST,LUNCH,AFTERNOON_SNACK,DINNER,PRE_WORKOUT',
    },
  ],
});

/** Avançado com dor no ombro registrada: nada que carregue o ombro entra no bloco. */
export const AVANCADO_COM_DOR_NO_OMBRO = persona({
  id: 'p07',
  age: 35,
  sex: 'MALE',
  heightCm: 182,
  weightKg: 88,
  waistCm: 86,
  goal: { primary: 'HYPERTROPHY', secondary: ['STRENGTH'], emphasis: 'AESTHETICS' },
  modalities: [strengthExp('ADVANCED', 84)],
  venues: ['FULL_GYM'],
  windows: [
    evening('MON', 90),
    evening('TUE', 90),
    evening('THU', 90),
    evening('FRI', 90),
    morning('SAT', 90),
  ],
  maxSessionsPerWeek: 5,
  health: [
    {
      kind: 'PAIN',
      summary: 'Dor 5/10 no ombro direito; tendência estável',
      movementTags: ['SHOULDER'],
    },
  ],
});

/** Semana apertada: duas janelas curtas. */
export const SEMANA_COM_POUCA_DISPONIBILIDADE = persona({
  id: 'p08',
  age: 38,
  sex: 'FEMALE',
  heightCm: 168,
  weightKg: 70,
  waistCm: 80,
  goal: { primary: 'HEALTH', secondary: ['BODY_DEFINITION'], emphasis: 'HEALTH' },
  modalities: [strengthExp('BEGINNER', 6)],
  venues: ['CONDO_GYM'],
  windows: [evening('TUE', 40), evening('THU', 40)],
  maxSessionsPerWeek: 2,
  life: { occupationRhythm: 'SHIFTS', mealsOutsideHomePerWeek: 10 },
  preferences: [
    { domain: 'FOOD', key: 'meals_per_day', value: 3 },
    { domain: 'FOOD', key: 'usual_meals', value: 'BREAKFAST,LUNCH,DINNER' },
  ],
});
