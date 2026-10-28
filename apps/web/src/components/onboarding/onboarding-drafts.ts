/**
 * Rascunhos (estado de formulário, com números como texto) de cada etapa da anamnese e a
 * conversão para o payload que a API valida. Tudo aqui é função pura: o servidor continua sendo
 * a autoridade, e esta camada só evita enviar o que ele recusaria.
 */
import type {
  DeclaredGoalKind,
  DaySlot,
  ExternalSport,
  ExperienceLevel,
  MealSlot,
  MeasurementKind,
  TrainingVenue,
  Weekday,
} from '@movivo/shared';

import { EMPTY_PAIN, type PainData } from './pain-section';

const WEEKDAYS: readonly Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

function num(text: string): number | undefined {
  const parsed = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(parsed) ? parsed : undefined;
}

/** `mm:ss`, `h:mm:ss` ou só minutos (`25`) → segundos. */
export function parseClock(text: string): number | undefined {
  const value = text.trim();
  if (!value) return undefined;
  if (!value.includes(':')) {
    const minutes = num(value);
    return minutes === undefined ? undefined : Math.round(minutes * 60);
  }
  const parts = value.split(':').map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p) || p < 0) || parts.length > 3) return undefined;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

const orUndefined = <T>(text: string, build: (clean: string) => T): T | undefined => {
  const clean = text.trim();
  return clean === '' ? undefined : build(clean);
};

// --- 2. Objetivos -------------------------------------------------------------------------

export type GoalEmphasis = 'AESTHETICS' | 'PERFORMANCE' | 'HEALTH' | 'BALANCED';
export type EventKind = 'RUNNING_RACE' | 'HYROX_RACE' | 'COMPETITION' | 'PERSONAL_DATE';

export interface GoalsDraft {
  primary: DeclaredGoalKind | null;
  secondary: DeclaredGoalKind[];
  emphasis: GoalEmphasis | null;
  hasEvent: boolean;
  eventKind: EventKind;
  eventName: string;
  eventDate: string;
  eventDistanceKm: string;
  motivation: string;
}

export const EMPTY_GOALS: GoalsDraft = {
  primary: null,
  secondary: [],
  emphasis: null,
  hasEvent: false,
  eventKind: 'RUNNING_RACE',
  eventName: '',
  eventDate: '',
  eventDistanceKm: '',
  motivation: '',
};

export function goalsPayload(d: GoalsDraft) {
  const distance = num(d.eventDistanceKm);
  return {
    goal: {
      primary: d.primary,
      secondary: d.secondary.filter((goal) => goal !== d.primary),
      emphasis: d.emphasis,
      ...(d.hasEvent
        ? {
            targetEvent: {
              kind: d.eventKind,
              name: d.eventName.trim(),
              date: d.eventDate,
              ...(d.eventKind === 'RUNNING_RACE' && distance
                ? { distanceMeters: Math.round(distance * 1000) }
                : {}),
            },
          }
        : {}),
    },
    ...orUndefined(d.motivation, (motivation) => ({ motivation })),
  };
}

export function goalsComplete(d: GoalsDraft): boolean {
  return (
    d.primary !== null &&
    d.emphasis !== null &&
    (!d.hasEvent || (d.eventName.trim().length > 0 && d.eventDate !== ''))
  );
}

export function goalsFromBlock(block: unknown): GoalsDraft {
  const goal = (block as { goal?: Record<string, unknown> } | undefined)?.goal;
  if (!goal) return EMPTY_GOALS;
  const event = goal.targetEvent as
    { kind: EventKind; name: string; date: string; distanceMeters?: number } | undefined;
  return {
    ...EMPTY_GOALS,
    primary: (goal.primary as DeclaredGoalKind) ?? null,
    secondary: (goal.secondary as DeclaredGoalKind[]) ?? [],
    emphasis: (goal.emphasis as GoalEmphasis) ?? null,
    hasEvent: Boolean(event),
    eventKind: event?.kind ?? 'RUNNING_RACE',
    eventName: event?.name ?? '',
    eventDate: event?.date ?? '',
    eventDistanceKm: event?.distanceMeters ? String(event.distanceMeters / 1000) : '',
  };
}

// --- 3. Modalidades -----------------------------------------------------------------------

export type CoachedModalityKey = 'STRENGTH' | 'RUNNING' | 'HYROX';

export interface ModalityDraft {
  selected: boolean;
  /** `true` = já pratica; `false` = quer começar. */
  practicing: boolean;
  level: Exclude<ExperienceLevel, 'NONE'>;
  months: string;
  sessions: string;
  weeklyKm: string;
  fiveK: string;
  hyroxRaces: string;
  hyroxBest: string;
}

export interface ExternalSportDraft {
  sport: ExternalSport;
  label: string;
  sessions: string;
  minutes: string;
  rpe: number;
  fixedDays: Weekday[];
}

export interface ModalitiesDraft {
  modalities: Record<CoachedModalityKey, ModalityDraft>;
  externalSports: ExternalSportDraft[];
  venues: TrainingVenue[];
}

const EMPTY_MODALITY: ModalityDraft = {
  selected: false,
  practicing: true,
  level: 'BEGINNER',
  months: '',
  sessions: '',
  weeklyKm: '',
  fiveK: '',
  hyroxRaces: '',
  hyroxBest: '',
};

export const EMPTY_MODALITIES: ModalitiesDraft = {
  modalities: {
    STRENGTH: { ...EMPTY_MODALITY },
    RUNNING: { ...EMPTY_MODALITY },
    HYROX: { ...EMPTY_MODALITY },
  },
  externalSports: [],
  venues: [],
};

export const newExternalSport = (): ExternalSportDraft => ({
  sport: 'MARTIAL_ARTS',
  label: '',
  sessions: '',
  minutes: '',
  rpe: 6,
  fixedDays: [],
});

export function modalitiesPayload(d: ModalitiesDraft) {
  return {
    modalities: (Object.keys(d.modalities) as CoachedModalityKey[])
      .filter((key) => d.modalities[key].selected)
      .map((key) => {
        const m = d.modalities[key];
        if (!m.practicing) {
          return {
            modality: key,
            level: 'NONE',
            monthsPracticing: 0,
            sessionsPerWeek: 0,
            wantsToStart: true,
          };
        }
        return {
          modality: key,
          level: m.level,
          monthsPracticing: Math.round(num(m.months) ?? 0),
          sessionsPerWeek: Math.round(num(m.sessions) ?? 0),
          wantsToStart: false,
          ...(key === 'RUNNING'
            ? { weeklyKm: num(m.weeklyKm), recent5kSeconds: parseClock(m.fiveK) }
            : {}),
          ...(key === 'HYROX'
            ? {
                hyroxRaces: Math.round(num(m.hyroxRaces) ?? 0),
                hyroxBestSeconds: parseClock(m.hyroxBest),
              }
            : {}),
        };
      }),
    externalSports: d.externalSports.map((s) => ({
      sport: s.sport,
      label: s.label.trim() || s.sport,
      sessionsPerWeek: Math.round(num(s.sessions) ?? 1),
      minutesPerSession: Math.round(num(s.minutes) ?? 60),
      typicalRpe: s.rpe,
      fixedDays: s.fixedDays,
    })),
    venues: d.venues,
  };
}

export function modalitiesComplete(d: ModalitiesDraft): boolean {
  const chosen = Object.values(d.modalities).filter((m) => m.selected);
  return chosen.length > 0 && d.venues.length > 0;
}

export function modalitiesFromBlock(block: unknown): ModalitiesDraft {
  const data = block as
    | {
        modalities?: Array<Record<string, unknown>>;
        externalSports?: Array<Record<string, unknown>>;
        venues?: TrainingVenue[];
      }
    | undefined;
  if (!data?.modalities) return EMPTY_MODALITIES;
  const modalities = structuredClone(EMPTY_MODALITIES.modalities);
  for (const m of data.modalities) {
    const key = m.modality as CoachedModalityKey;
    modalities[key] = {
      selected: true,
      practicing: m.wantsToStart !== true,
      level: m.level === 'NONE' ? 'BEGINNER' : (m.level as ModalityDraft['level']),
      months: String(m.monthsPracticing ?? ''),
      sessions: String(m.sessionsPerWeek ?? ''),
      weeklyKm: m.weeklyKm ? String(m.weeklyKm) : '',
      fiveK: '',
      hyroxRaces: m.hyroxRaces ? String(m.hyroxRaces) : '',
      hyroxBest: '',
    };
  }
  return {
    modalities,
    externalSports: (data.externalSports ?? []).map((s) => ({
      sport: s.sport as ExternalSport,
      label: String(s.label ?? ''),
      sessions: String(s.sessionsPerWeek ?? ''),
      minutes: String(s.minutesPerSession ?? ''),
      rpe: Number(s.typicalRpe ?? 6),
      fixedDays: (s.fixedDays as Weekday[]) ?? [],
    })),
    venues: data.venues ?? [],
  };
}

// --- 4. Rotina ----------------------------------------------------------------------------

export interface DayDraft {
  on: boolean;
  slot: DaySlot;
  minutes: string;
}

export interface RoutineDraft {
  days: Record<Weekday, DayDraft>;
  variesWeekly: boolean;
  maxSessions: string;
  occupationRhythm: 'REGULAR' | 'SHIFTS' | 'TRAVELS_OFTEN' | 'IRREGULAR';
  cookingCapacity: 'NONE' | 'BASIC' | 'GOOD';
  mealsOutsideHomePerWeek: string;
  foodBudget: 'TIGHT' | 'MODERATE' | 'COMFORTABLE';
  sleepHours: string;
  stress: '' | 'LOW' | 'MODERATE' | 'HIGH';
}

export const EMPTY_ROUTINE: RoutineDraft = {
  days: Object.fromEntries(
    WEEKDAYS.map((day) => [day, { on: false, slot: 'ANY', minutes: '60' }]),
  ) as Record<Weekday, DayDraft>,
  variesWeekly: false,
  maxSessions: '',
  occupationRhythm: 'REGULAR',
  cookingCapacity: 'BASIC',
  mealsOutsideHomePerWeek: '',
  foodBudget: 'MODERATE',
  sleepHours: '',
  stress: '',
};

export function routinePayload(d: RoutineDraft) {
  const sleep = num(d.sleepHours);
  return {
    windows: WEEKDAYS.filter((day) => d.days[day].on).map((weekday) => ({
      weekday,
      slot: d.days[weekday].slot,
      maxMinutes: Math.round(num(d.days[weekday].minutes) ?? 60),
    })),
    variesWeekly: d.variesWeekly,
    maxSessionsPerWeek: Math.round(num(d.maxSessions) ?? 1),
    lifeContext: {
      occupationRhythm: d.occupationRhythm,
      cookingCapacity: d.cookingCapacity,
      mealsOutsideHomePerWeek: Math.round(num(d.mealsOutsideHomePerWeek) ?? 0),
      foodBudget: d.foodBudget,
      ...(sleep ? { sleepHoursTypical: sleep } : {}),
      ...(d.stress ? { stressLevel: d.stress } : {}),
    },
  };
}

export function routineComplete(d: RoutineDraft): boolean {
  const days = WEEKDAYS.filter((day) => d.days[day].on).length;
  const max = num(d.maxSessions);
  return days > 0 && max !== undefined && max >= 1 && max <= 14;
}

export function routineFromBlock(block: unknown): RoutineDraft {
  const data = block as
    | {
        windows?: Array<{ weekday: Weekday; slot: DaySlot; maxMinutes: number }>;
        variesWeekly?: boolean;
        maxSessionsPerWeek?: number;
        lifeContext?: Record<string, unknown>;
      }
    | undefined;
  if (!data?.windows) return EMPTY_ROUTINE;
  const days = structuredClone(EMPTY_ROUTINE.days);
  for (const w of data.windows)
    days[w.weekday] = { on: true, slot: w.slot, minutes: String(w.maxMinutes) };
  const life = data.lifeContext ?? {};
  return {
    ...EMPTY_ROUTINE,
    days,
    variesWeekly: data.variesWeekly ?? false,
    maxSessions: String(data.maxSessionsPerWeek ?? ''),
    occupationRhythm: (life.occupationRhythm as RoutineDraft['occupationRhythm']) ?? 'REGULAR',
    cookingCapacity: (life.cookingCapacity as RoutineDraft['cookingCapacity']) ?? 'BASIC',
    mealsOutsideHomePerWeek: String(life.mealsOutsideHomePerWeek ?? ''),
    foodBudget: (life.foodBudget as RoutineDraft['foodBudget']) ?? 'MODERATE',
    sleepHours: life.sleepHoursTypical ? String(life.sleepHoursTypical) : '',
    stress: (life.stressLevel as RoutineDraft['stress']) ?? '',
  };
}

// --- 5. Preferências e saúde --------------------------------------------------------------

export interface PreferencesDraft {
  split: 'FULL_BODY' | 'UPPER_LOWER' | 'PUSH_PULL_LEGS' | 'BODY_PART' | 'NO_PREFERENCE' | null;
  effort: 'NEAR_FAILURE' | 'AVOID_FAILURE' | 'UNSURE' | null;
  priority: 'MAX_RESULT' | 'BALANCED' | 'ENJOYMENT' | null;
  sessionMinutes: string;
  likedTraining: string;
  dislikedExercises: string;
  pain: PainData;
  conditions: string;
  medications: string;
  professionalGuidance: string;
}

export const EMPTY_PREFERENCES: PreferencesDraft = {
  split: null,
  effort: null,
  priority: null,
  sessionMinutes: '50',
  likedTraining: '',
  dislikedExercises: '',
  pain: EMPTY_PAIN,
  conditions: '',
  medications: '',
  professionalGuidance: '',
};

export function painPayload(pain: PainData) {
  if (!pain.hasPain) return { hasPain: false, points: [] };
  return {
    hasPain: true,
    points: pain.points.map((p) => ({
      region: p.region,
      intensity: p.intensity,
      regionOther: p.regionOther || undefined,
    })),
    trend: pain.trend ?? undefined,
    trigger: pain.trigger || undefined,
    hasProfessionalExplanation: pain.hasProfessionalExplanation,
    professionalExplanation: pain.professionalExplanation || undefined,
    underMedicalFollowUp: pain.underMedicalFollowUp,
    hasAvoidanceRecommendation: pain.hasAvoidanceRecommendation,
    avoidanceRecommendation: pain.avoidanceRecommendation || undefined,
  };
}

export function preferencesPayload(d: PreferencesDraft) {
  return {
    preferences: {
      split: d.split,
      effort: d.effort,
      priority: d.priority,
      preferredSessionMinutes: Math.round(num(d.sessionMinutes) ?? 50),
    },
    likedTraining: d.likedTraining.trim() || undefined,
    dislikedExercises: d.dislikedExercises.trim() || undefined,
    pain: painPayload(d.pain),
    conditions: d.conditions.trim() || undefined,
    medications: d.medications.trim() || undefined,
    professionalGuidance: d.professionalGuidance.trim() || undefined,
  };
}

export function preferencesComplete(d: PreferencesDraft): boolean {
  const minutes = num(d.sessionMinutes);
  return (
    d.split !== null &&
    d.effort !== null &&
    d.priority !== null &&
    minutes !== undefined &&
    minutes >= 15 &&
    (!d.pain.hasPain || (d.pain.points.length > 0 && d.pain.trend !== null))
  );
}

export function preferencesFromBlock(block: unknown): PreferencesDraft {
  const prefs = (block as { preferences?: Record<string, unknown> } | undefined)?.preferences;
  if (!prefs) return EMPTY_PREFERENCES;
  return {
    ...EMPTY_PREFERENCES,
    split: (prefs.split as PreferencesDraft['split']) ?? null,
    effort: (prefs.effort as PreferencesDraft['effort']) ?? null,
    priority: (prefs.priority as PreferencesDraft['priority']) ?? null,
    sessionMinutes: String(prefs.preferredSessionMinutes ?? '50'),
  };
}

// --- 7. Alimentação -----------------------------------------------------------------------

export type DietaryRestriction =
  'VEGETARIAN' | 'VEGAN' | 'LACTOSE_FREE' | 'GLUTEN_FREE' | 'HALAL' | 'KOSHER';
export type Supplement =
  'CREATINE' | 'WHEY' | 'CAFFEINE' | 'VITAMIN_D' | 'OMEGA_3' | 'MULTIVITAMIN' | 'OTHER';

export interface AllergyDraft {
  allergen: string;
  severity: 'INTOLERANCE' | 'ALLERGY' | 'SEVERE_ALLERGY';
}

export interface NutritionDraft {
  mealsPerDay: string;
  usualMeals: MealSlot[];
  dietaryRestrictions: DietaryRestriction[];
  allergies: AllergyDraft[];
  supplements: Supplement[];
  hunger: 'LOW' | 'NORMAL' | 'HIGH' | 'VARIES' | null;
  likedFoods: string;
  dislikedFoods: string;
}

export const EMPTY_NUTRITION: NutritionDraft = {
  mealsPerDay: '',
  usualMeals: [],
  dietaryRestrictions: [],
  allergies: [],
  supplements: [],
  hunger: null,
  likedFoods: '',
  dislikedFoods: '',
};

export function nutritionPayload(d: NutritionDraft) {
  return {
    mealsPerDay: Math.round(num(d.mealsPerDay) ?? 0),
    usualMeals: d.usualMeals,
    dietaryRestrictions: d.dietaryRestrictions,
    allergies: d.allergies
      .filter((a) => a.allergen.trim() !== '')
      .map((a) => ({ allergen: a.allergen.trim(), severity: a.severity })),
    supplements: d.supplements,
    hunger: d.hunger,
    likedFoods: d.likedFoods.trim() || undefined,
    dislikedFoods: d.dislikedFoods.trim() || undefined,
  };
}

export function nutritionComplete(d: NutritionDraft): boolean {
  const meals = num(d.mealsPerDay);
  return (
    meals !== undefined && meals >= 1 && meals <= 8 && d.usualMeals.length > 0 && d.hunger !== null
  );
}

export function nutritionFromBlock(block: unknown): NutritionDraft {
  const data = block as Partial<Record<keyof NutritionDraft, unknown>> | undefined;
  if (!data?.mealsPerDay) return EMPTY_NUTRITION;
  return {
    ...EMPTY_NUTRITION,
    mealsPerDay: String(data.mealsPerDay),
    usualMeals: (data.usualMeals as MealSlot[]) ?? [],
    dietaryRestrictions: (data.dietaryRestrictions as DietaryRestriction[]) ?? [],
    supplements: (data.supplements as Supplement[]) ?? [],
    hunger: (data.hunger as NutritionDraft['hunger']) ?? null,
  };
}

// --- 8. Corpo (opcional) ------------------------------------------------------------------

export const BODY_FIELDS: readonly MeasurementKind[] = [
  'WAIST',
  'HIP',
  'NECK',
  'CHEST',
  'ARM',
  'THIGH',
  'CALF',
];

export type BodyDraft = Partial<Record<MeasurementKind, string>>;

export function bodyPayload(d: BodyDraft, measuredOn: string) {
  return {
    measurements: BODY_FIELDS.flatMap((kind) => {
      const value = num(d[kind] ?? '');
      return value === undefined ? [] : [{ kind, value, method: 'SELF_TAPE', measuredOn }];
    }),
  };
}
