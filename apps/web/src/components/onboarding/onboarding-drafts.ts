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
  MuscleEmphasisRegion,
  TrainingVenue,
  Weekday,
} from '@movivo/shared';
import { defaultVenueOf, EXTERNAL_SPORT_LABELS, MEASUREMENT_BOUNDS } from '@movivo/shared';

import { clockToTotal, minutesToClock, secondsToClock, secondsToRaceTime } from './masks';
import { EMPTY_PAIN, type PainData } from './pain-section';

const WEEKDAYS: readonly Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

function num(text: string): number | undefined {
  const parsed = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(parsed) ? parsed : undefined;
}

const orUndefined = <T>(text: string, build: (clean: string) => T): T | undefined => {
  const clean = text.trim();
  return clean === '' ? undefined : build(clean);
};

/** Opção da lista cujo valor numérico fica mais perto de `value`. */
function nearestOption(options: readonly string[], value: number): string {
  return options.reduce((best, option) =>
    Math.abs(Number(option) - value) < Math.abs(Number(best) - value) ? option : best,
  );
}

/** Hoje no calendário do aluno, `AAAA-MM-DD`. */
export function todayIso(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

// --- Validação de faixa e formato (mensagens exibidas ao aluno) ---------------------------
//
// Campo vazio nunca é erro aqui: obrigatoriedade é do `*Complete`, que trava o "Continuar".

/** Número preenchido fora de `[min, max]` (ou com casas, quando `integer`). */
function outOfRange(text: string, min: number, max: number, integer = false): boolean {
  if (text.trim() === '') return false;
  const value = num(text);
  return value === undefined || value < min || value > max || (integer && !Number.isInteger(value));
}

/** Tempo `mm:ss`, `h:mm:ss` ou `hh:mm:ss` incompleto ou fora de `[min, max]` segundos. */
function timeInvalid(text: string, minSeconds: number, maxSeconds: number): boolean {
  if (text.trim() === '') return false;
  if (!/^\d{1,2}(:\d{2}){1,2}$/.test(text.trim())) return true;
  const seconds = clockToTotal(text) ?? -1;
  return seconds < minSeconds || seconds > maxSeconds;
}

const MAX_EVENT_YEARS_AHEAD = 3;

/** Último dia aceito para um evento: 31/12 de daqui a 3 anos (o mesmo teto do calendário). */
export function lastEventDate(now = new Date()): Date {
  return new Date(now.getFullYear() + MAX_EVENT_YEARS_AHEAD, 11, 31);
}

export function eventDateError(date: string, now = new Date()): string | undefined {
  if (date === '') return undefined;
  return date < todayIso(now) || date > todayIso(lastEventDate(now))
    ? `Escolha uma data a partir de hoje e até ${MAX_EVENT_YEARS_AHEAD} anos à frente.`
    : undefined;
}

export const eventDistanceError = (text: string) =>
  outOfRange(text, 1, 100) ? 'Informe uma distância entre 1 e 100 km.' : undefined;

export const weeklyKmError = (text: string) =>
  outOfRange(text, 0, 300) ? 'Informe de 0 a 300 km por semana.' : undefined;

export const fiveKError = (text: string) =>
  timeInvalid(text, 600, 7_200)
    ? 'Use minutos e segundos (ex.: 28:30), entre 10:00 e 2:00:00.'
    : undefined;

export const hyroxRacesError = (text: string) =>
  outOfRange(text, 0, 100, true) ? 'Informe um número de 0 a 100.' : undefined;

export const hyroxBestError = (text: string) =>
  timeInvalid(text, 2_400, 14_400)
    ? 'Use horas, minutos e segundos (ex.: 01:25:00), entre 00:40:00 e 04:00:00.'
    : undefined;

export const sportDurationError = (text: string) =>
  timeInvalid(text, MIN_SESSION_MINUTES * 60, MAX_SESSION_MINUTES * 60)
    ? 'Use minutos e segundos (ex.: 45:00) ou horas (ex.: 1:30:00), entre 10 minutos e 10 horas.'
    : undefined;

export const mealsOutsideError = (text: string) =>
  outOfRange(text, 0, 21, true) ? 'Informe de 0 a 21 refeições por semana.' : undefined;

/** Teto do orçamento aceito pela API: R$ 1.000.000,00, em centavos. */
const MAX_FOOD_BUDGET_CENTS = 100_000_000;

export function foodBudgetError(cents: string): string | undefined {
  if (cents === '') return undefined;
  const value = Number(cents);
  if (!(value > 0)) return 'Informe um valor maior que zero.';
  return value > MAX_FOOD_BUDGET_CENTS ? 'Informe um valor de até R$ 1.000.000,00.' : undefined;
}

export function measurementError(kind: MeasurementKind, text: string): string | undefined {
  const [min, max] = MEASUREMENT_BOUNDS[kind];
  return outOfRange(text, min, max) ? `Informe entre ${min} e ${max} cm.` : undefined;
}

// --- 2. Objetivos -------------------------------------------------------------------------

export type GoalEmphasis = 'AESTHETICS' | 'PERFORMANCE' | 'HEALTH' | 'BALANCED';
export type EventKind = 'RUNNING_RACE' | 'HYROX_RACE' | 'STRENGTH_EVENT' | 'OTHER_EVENT';

export interface GoalsDraft {
  primary: DeclaredGoalKind | null;
  secondary: DeclaredGoalKind[];
  emphasis: GoalEmphasis | null;
  hasEvent: boolean | undefined;
  eventKind: EventKind | null;
  eventName: string;
  eventDate: string;
  eventDistanceKm: string;
  motivation: string;
}

export const EMPTY_GOALS: GoalsDraft = {
  primary: null,
  secondary: [],
  emphasis: null,
  hasEvent: undefined,
  eventKind: null,
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
      ...(d.hasEvent && d.eventKind
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
    d.hasEvent !== undefined &&
    (!d.hasEvent ||
      (d.eventKind !== null &&
        d.eventName.trim().length > 0 &&
        d.eventDate !== '' &&
        !eventDateError(d.eventDate) &&
        (d.eventKind !== 'RUNNING_RACE' || !eventDistanceError(d.eventDistanceKm))))
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
    eventKind: event?.kind ?? null,
    eventName: event?.name ?? '',
    eventDate: event?.date ?? '',
    eventDistanceKm: event?.distanceMeters ? String(event.distanceMeters / 1000) : '',
  };
}

// --- 3. Seu treino com a MOVIVO -----------------------------------------------------------

export type CoachedModalityKey = 'STRENGTH' | 'RUNNING' | 'HYROX';

export interface ModalityDraft {
  selected: boolean;
  /** `true` = já pratica; `false` = quer começar; `null` = ainda não respondeu. */
  practicing: boolean | null;
  level: Exclude<ExperienceLevel, 'NONE'> | null;
  /** Onde faz a maior parte dos treinos da modalidade (pratique ou queira começar). */
  venue: TrainingVenue | null;
  weeklyKm: string;
  /** `mm:ss` ou `h:mm:ss`. */
  fiveK: string;
  hyroxRaces: string;
  /** `hh:mm:ss`. */
  hyroxBest: string;
}

export interface ModalitiesDraft {
  modalities: Record<CoachedModalityKey, ModalityDraft>;
}

const EMPTY_MODALITY: ModalityDraft = {
  selected: false,
  practicing: null,
  level: null,
  venue: null,
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
};

export function modalitiesPayload(d: ModalitiesDraft) {
  return {
    modalities: (Object.keys(d.modalities) as CoachedModalityKey[])
      .filter((key) => d.modalities[key].selected)
      .map((key) => {
        const m = d.modalities[key];
        if (m.practicing !== true) {
          return {
            modality: key,
            level: 'NONE',
            wantsToStart: true,
            venue: m.venue,
          };
        }
        return {
          modality: key,
          level: m.level,
          wantsToStart: false,
          venue: m.venue,
          ...(key === 'RUNNING'
            ? { weeklyKm: num(m.weeklyKm), recent5kSeconds: clockToTotal(m.fiveK) }
            : {}),
          ...(key === 'HYROX'
            ? {
                hyroxRaces: Math.round(num(m.hyroxRaces) ?? 0),
                // Sem prova feita não há melhor tempo (o campo some da tela, o valor também).
                ...((num(m.hyroxRaces) ?? 0) > 0
                  ? { hyroxBestSeconds: clockToTotal(m.hyroxBest) }
                  : {}),
              }
            : {}),
        };
      }),
  };
}

function modalityComplete(m: ModalityDraft, key: CoachedModalityKey): boolean {
  if (m.practicing === null || m.venue === null) return false;
  if (!m.practicing) return true;
  if (m.level === null) return false;
  if (key === 'RUNNING') {
    return num(m.weeklyKm) !== undefined && !weeklyKmError(m.weeklyKm) && !fiveKError(m.fiveK);
  }
  if (key === 'HYROX') {
    const races = num(m.hyroxRaces);
    return (
      races !== undefined &&
      !hyroxRacesError(m.hyroxRaces) &&
      (races === 0 || !hyroxBestError(m.hyroxBest))
    );
  }
  return true;
}

export function modalitiesComplete(d: ModalitiesDraft): boolean {
  const keys = (Object.keys(d.modalities) as CoachedModalityKey[]).filter(
    (key) => d.modalities[key].selected,
  );
  return keys.length > 0 && keys.every((key) => modalityComplete(d.modalities[key], key));
}

export function modalitiesFromBlock(block: unknown): ModalitiesDraft {
  const data = block as
    | {
        modalities?: Array<Record<string, unknown>>;
        /** Blocos antigos: um local para todas as modalidades. */
        venues?: TrainingVenue[];
      }
    | undefined;
  if (!data?.modalities) return EMPTY_MODALITIES;
  const modalities = structuredClone(EMPTY_MODALITIES.modalities);
  for (const m of data.modalities) {
    const key = m.modality as CoachedModalityKey;
    const wantsToStart = m.wantsToStart === true;
    modalities[key] = {
      selected: true,
      practicing: !wantsToStart,
      level: m.level === 'NONE' ? null : (m.level as ModalityDraft['level']),
      venue: (m.venue as TrainingVenue | undefined) ?? defaultVenueOf(key, data.venues ?? []),
      weeklyKm: m.weeklyKm ? String(m.weeklyKm) : '',
      fiveK: m.recent5kSeconds ? secondsToRaceTime(Number(m.recent5kSeconds)) : '',
      hyroxRaces: m.hyroxRaces !== undefined ? String(m.hyroxRaces) : '',
      hyroxBest: m.hyroxBestSeconds ? secondsToClock(Number(m.hyroxBestSeconds)) : '',
    };
  }
  return { modalities };
}

// --- 4. Sua semana -------------------------------------------------------------------------
//
// Ordem da etapa: o que já ocupa a semana (esporte externo), quando dá para treinar, o teto de
// treinos e, por último, sono e estresse. Tudo é informação: a MOVIVO decide o resto.

export interface ExternalSportDraft {
  sport: ExternalSport | null;
  /** Dias por semana (1 a 7). */
  sessions: string;
  /** Duração média de uma sessão: `mm:ss` (45:00) ou `h:mm:ss` a partir de uma hora. */
  duration: string;
  rpe: number | null;
  fixedDays: Weekday[];
}

export const newExternalSport = (): ExternalSportDraft => ({
  sport: null,
  sessions: '',
  duration: '',
  rpe: null,
  fixedDays: [],
});

const MIN_SESSION_MINUTES = 10;
const MAX_SESSION_MINUTES = 600;

/** Mais dias fixos do que dias por semana não faz sentido. */
export function fixedDaysExceedSessions(sessions: string, fixedDays: readonly Weekday[]): boolean {
  const days = num(sessions);
  return days !== undefined && fixedDays.length > days;
}

/** Duração digitada como `mm:ss` / `h:mm:ss` → minutos. */
function durationMinutes(text: string): number | undefined {
  const seconds = clockToTotal(text);
  return seconds === undefined ? undefined : Math.round(seconds / 60);
}

function externalSportComplete(s: ExternalSportDraft): boolean {
  const sessions = num(s.sessions);
  return (
    s.sport !== null &&
    sessions !== undefined &&
    sessions >= 1 &&
    sessions <= 7 &&
    s.duration.trim() !== '' &&
    !sportDurationError(s.duration) &&
    s.rpe !== null &&
    !fixedDaysExceedSessions(s.sessions, s.fixedDays)
  );
}

function externalSportsPayload(sports: readonly ExternalSportDraft[]) {
  return sports.flatMap((s) =>
    s.sport === null
      ? []
      : [
          {
            sport: s.sport,
            label: EXTERNAL_SPORT_LABELS[s.sport],
            sessionsPerWeek: Math.round(num(s.sessions) ?? 1),
            minutesPerSession: durationMinutes(s.duration) ?? 60,
            typicalRpe: s.rpe ?? 6,
            fixedDays: s.fixedDays,
          },
        ],
  );
}

function externalSportsFromBlock(sports: Array<Record<string, unknown>>): ExternalSportDraft[] {
  return sports.map((s) => ({
    sport: s.sport as ExternalSport,
    sessions: s.sessionsPerWeek ? String(s.sessionsPerWeek) : '',
    duration: s.minutesPerSession ? secondsToRaceTime(Number(s.minutesPerSession) * 60) : '',
    rpe: s.typicalRpe === undefined ? null : Number(s.typicalRpe),
    fixedDays: (s.fixedDays as Weekday[]) ?? [],
  }));
}

/** Tempo disponível por treino (minutos); `90` representa "mais de 60 minutos". */
export const AVAILABLE_MINUTES_OPTIONS = ['30', '45', '60', '90'] as const;
const MIN_SLEEP_HOURS = 3;
const MAX_SLEEP_HOURS = 12;

export interface DayWindowDraft {
  slot: DaySlot;
  minutes: string;
}

export interface RoutineDraft {
  /** `undefined` = ainda não respondeu; `false` = não pratica outro esporte. */
  practicesOtherSport: boolean | undefined;
  /** Esportes que o aluno já pratica por fora: a MOVIVO planeja em volta deles. */
  externalSports: ExternalSportDraft[];
  /** Dias da semana em que o aluno pode treinar. */
  days: Weekday[];
  /** Período da maioria dos dias marcados (padrão). */
  slot: DaySlot | null;
  /** Tempo por treino na maioria dos dias marcados (padrão). */
  availableMinutes: string;
  /** `true` = algum dia tem período ou tempo próprio; sem resposta vale como não. */
  hasDayOverrides: boolean | undefined;
  /** Período e tempo dos dias que fogem do padrão. */
  overrides: Partial<Record<Weekday, DayWindowDraft>>;
  variesWeekly: boolean | undefined;
  /** Horas de sono, `hh:mm`. */
  sleep: string;
  stress: '' | 'LOW' | 'MODERATE' | 'HIGH';
}

export const EMPTY_ROUTINE: RoutineDraft = {
  practicesOtherSport: undefined,
  externalSports: [],
  days: [],
  slot: null,
  availableMinutes: '',
  hasDayOverrides: undefined,
  overrides: {},
  variesWeekly: undefined,
  sleep: '',
  stress: '',
};

/** Período e tempo valendo num dia: o próprio, quando há, senão o padrão. */
export function dayWindow(d: RoutineDraft, day: Weekday) {
  const own = d.hasDayOverrides === true ? d.overrides[day] : undefined;
  return { slot: own?.slot ?? d.slot, minutes: own?.minutes || d.availableMinutes };
}

function sleepHours(text: string): number | undefined {
  const minutes = clockToTotal(text);
  return minutes === undefined ? undefined : minutes / 60;
}

export function routinePayload(d: RoutineDraft) {
  const sleep = sleepHours(d.sleep);
  return {
    externalSports: d.practicesOtherSport ? externalSportsPayload(d.externalSports) : [],
    windows: WEEKDAYS.filter((day) => d.days.includes(day)).map((weekday) => {
      const window = dayWindow(d, weekday);
      return {
        weekday,
        slot: window.slot ?? 'ANY',
        maxMinutes: Math.round(num(window.minutes) ?? 60),
      };
    }),
    variesWeekly: d.variesWeekly === true,
    lifeContext: {
      ...(sleep ? { sleepHoursTypical: Math.round(sleep * 100) / 100 } : {}),
      ...(d.stress ? { stressLevel: d.stress } : {}),
    },
  };
}

/** Horas de sono fora da faixa que a API aceita. */
export function sleepOutOfRange(text: string): boolean {
  const hours = sleepHours(text);
  return hours !== undefined && (hours < MIN_SLEEP_HOURS || hours > MAX_SLEEP_HOURS);
}

export const sleepError = (text: string) =>
  text !== '' && (!/^\d{2}:\d{2}$/.test(text) || sleepOutOfRange(text))
    ? 'Use horas e minutos (ex.: 07:30), entre 03:00 e 12:00.'
    : undefined;

export function routineComplete(d: RoutineDraft): boolean {
  return (
    d.practicesOtherSport !== undefined &&
    (!d.practicesOtherSport ||
      (d.externalSports.length > 0 && d.externalSports.every(externalSportComplete))) &&
    d.days.length > 0 &&
    d.slot !== null &&
    d.availableMinutes !== '' &&
    d.variesWeekly !== undefined &&
    !sleepError(d.sleep)
  );
}

/** Valor mais repetido; no empate, o que aparece primeiro. */
function mostFrequent<T>(values: readonly T[]): T | undefined {
  const count = (value: T) => values.filter((v) => v === value).length;
  return values.reduce<T | undefined>(
    (best, value) => (best === undefined || count(value) > count(best) ? value : best),
    undefined,
  );
}

type SportsBlock = { externalSports?: Array<Record<string, unknown>> } | undefined;

/**
 * Esporte externo salvo: o da etapa 4; em sessão salva antes da mudança, o da etapa 3. Sem
 * nenhum dos dois, a pergunta fica sem resposta.
 */
function savedExternalSports(routine: SportsBlock, legacyModalities: SportsBlock) {
  const sports = routine?.externalSports ?? legacyModalities?.externalSports;
  if (!sports) return { practicesOtherSport: undefined, externalSports: [] };
  const externalSports = externalSportsFromBlock(sports);
  return { practicesOtherSport: externalSports.length > 0, externalSports };
}

/**
 * Etapa 4 salva → rascunho. `legacyModalities` é o bloco da etapa 3: sessões salvas antes da
 * mudança guardavam lá o esporte externo.
 */
export function routineFromBlock(block: unknown, legacyModalities?: unknown): RoutineDraft {
  const data = block as
    | {
        externalSports?: Array<Record<string, unknown>>;
        windows?: Array<{ weekday: Weekday; slot: DaySlot; maxMinutes: number }>;
        variesWeekly?: boolean;
        maxSessionsPerWeek?: number;
        lifeContext?: Record<string, unknown>;
      }
    | undefined;
  const sports = savedExternalSports(data, legacyModalities as SportsBlock);
  if (!data?.windows) {
    return sports.practicesOtherSport === undefined
      ? EMPTY_ROUTINE
      : { ...EMPTY_ROUTINE, ...sports };
  }
  const windows = data.windows.map((w) => ({
    weekday: w.weekday,
    slot: w.slot,
    minutes: nearestOption(AVAILABLE_MINUTES_OPTIONS, w.maxMinutes),
  }));
  const slot = mostFrequent(windows.map((w) => w.slot)) ?? null;
  const availableMinutes = mostFrequent(windows.map((w) => w.minutes)) ?? '';
  const overrides: RoutineDraft['overrides'] = {};
  for (const w of windows) {
    if (w.slot !== slot || w.minutes !== availableMinutes) {
      overrides[w.weekday] = { slot: w.slot, minutes: w.minutes };
    }
  }
  const life = data.lifeContext ?? {};
  const sleep = Number(life.sleepHoursTypical);
  return {
    ...EMPTY_ROUTINE,
    ...sports,
    days: windows.map((w) => w.weekday),
    slot,
    availableMinutes,
    hasDayOverrides: Object.keys(overrides).length > 0 || undefined,
    overrides,
    variesWeekly: data.variesWeekly,
    sleep: sleep > 0 ? minutesToClock(Math.round(sleep * 60)) : '',
    stress: (life.stressLevel as RoutineDraft['stress']) ?? '',
  };
}

// --- 5. Preferências de treino e saúde geral ----------------------------------------------

export interface PreferencesDraft {
  priority: 'MAX_RESULT' | 'BALANCED' | 'ENJOYMENT' | null;
  muscleEmphasis: MuscleEmphasisRegion[];
  hasTrainingPreferences: boolean | undefined;
  trainingPreferences: string;
  hasDislikedExercises: boolean | undefined;
  dislikedExercises: string;
  hasCondition: boolean | undefined;
  conditions: string;
  medications: string;
  hasProfessionalGuidance: boolean | undefined;
  professionalGuidance: string;
}

export const EMPTY_PREFERENCES: PreferencesDraft = {
  priority: null,
  muscleEmphasis: [],
  hasTrainingPreferences: undefined,
  trainingPreferences: '',
  hasDislikedExercises: undefined,
  dislikedExercises: '',
  hasCondition: undefined,
  conditions: '',
  medications: '',
  hasProfessionalGuidance: undefined,
  professionalGuidance: '',
};

export function preferencesPayload(d: PreferencesDraft) {
  const withCondition = d.hasCondition === true;
  return {
    preferences: {
      priority: d.priority,
      muscleEmphasis: d.muscleEmphasis,
    },
    trainingPreferences: (d.hasTrainingPreferences && d.trainingPreferences.trim()) || undefined,
    dislikedExercises: (d.hasDislikedExercises && d.dislikedExercises.trim()) || undefined,
    conditions: (withCondition && d.conditions.trim()) || undefined,
    medications: (withCondition && d.medications.trim()) || undefined,
    professionalGuidance: (d.hasProfessionalGuidance && d.professionalGuidance.trim()) || undefined,
  };
}

/** Pergunta de sim ou não: respondida e, com "sim", com o texto preenchido. */
function answeredWithText(answer: boolean | undefined, text: string): boolean {
  return answer !== undefined && (!answer || text.trim() !== '');
}

export function preferencesComplete(d: PreferencesDraft): boolean {
  return (
    d.priority !== null &&
    answeredWithText(d.hasTrainingPreferences, d.trainingPreferences) &&
    answeredWithText(d.hasDislikedExercises, d.dislikedExercises) &&
    d.hasCondition !== undefined &&
    (!d.hasCondition || d.conditions.trim() !== '' || d.medications.trim() !== '') &&
    answeredWithText(d.hasProfessionalGuidance, d.professionalGuidance)
  );
}

export function preferencesFromBlock(block: unknown): PreferencesDraft {
  const prefs = (block as { preferences?: Record<string, unknown> } | undefined)?.preferences;
  if (!prefs) return EMPTY_PREFERENCES;
  return {
    ...EMPTY_PREFERENCES,
    priority: (prefs.priority as PreferencesDraft['priority']) ?? null,
    muscleEmphasis: (prefs.muscleEmphasis as MuscleEmphasisRegion[] | undefined) ?? [],
  };
}

// --- 6. Dores e limitações ----------------------------------------------------------------

export { EMPTY_PAIN };

export function painPayload(pain: PainData) {
  if (pain.hasPain !== true) return { pain: { hasPain: false, points: [] } };
  return {
    pain: {
      hasPain: true,
      points: pain.points.map((p) => ({
        region: p.region,
        intensity: p.intensity,
        regionOther: p.regionOther || undefined,
      })),
      trend: pain.trend ?? undefined,
      trigger: pain.trigger || undefined,
      hasProfessionalExplanation: pain.hasProfessionalExplanation === true,
      professionalExplanation: pain.professionalExplanation || undefined,
      underMedicalFollowUp: pain.underMedicalFollowUp === true,
      hasAvoidanceRecommendation: pain.hasAvoidanceRecommendation === true,
      avoidanceRecommendation: pain.avoidanceRecommendation || undefined,
    },
  };
}

export function painComplete(pain: PainData): boolean {
  if (pain.hasPain === undefined) return false;
  if (!pain.hasPain) return true;
  return (
    pain.points.length > 0 &&
    pain.points.every((point) => point.region !== 'OTHER' || point.regionOther.trim() !== '') &&
    pain.trend !== null &&
    pain.hasProfessionalExplanation !== undefined &&
    (pain.hasProfessionalExplanation !== true || pain.professionalExplanation.trim() !== '') &&
    pain.underMedicalFollowUp !== undefined &&
    pain.hasAvoidanceRecommendation !== undefined &&
    (pain.hasAvoidanceRecommendation !== true || pain.avoidanceRecommendation.trim() !== '')
  );
}

// --- 7. Alimentação -----------------------------------------------------------------------

export type DietaryRestriction =
  'VEGETARIAN' | 'VEGAN' | 'LACTOSE_FREE' | 'GLUTEN_FREE' | 'HALAL' | 'KOSHER';
export type Supplement =
  'CREATINE' | 'WHEY' | 'CAFFEINE' | 'VITAMIN_D' | 'OMEGA_3' | 'MULTIVITAMIN' | 'OTHER';

export interface AllergyDraft {
  allergen: string;
  severity: 'INTOLERANCE' | 'ALLERGY' | 'SEVERE_ALLERGY' | null;
}

export interface NutritionDraft {
  cookingCapacity: 'NONE' | 'BASIC' | 'GOOD' | null;
  mealsOutsideHomePerWeek: string;
  /** Orçamento mensal para alimentação, em centavos (só dígitos). */
  foodBudgetCents: string;
  usualMeals: MealSlot[];
  dietaryRestrictions: DietaryRestriction[];
  hasAllergy: boolean | undefined;
  allergies: AllergyDraft[];
  supplements: Supplement[];
  supplementOther: string;
  hunger: 'LOW' | 'NORMAL' | 'HIGH' | 'VARIES' | null;
  likedFoods: string;
  dislikedFoods: string;
}

export const EMPTY_NUTRITION: NutritionDraft = {
  cookingCapacity: null,
  mealsOutsideHomePerWeek: '',
  foodBudgetCents: '',
  usualMeals: [],
  dietaryRestrictions: [],
  hasAllergy: undefined,
  allergies: [],
  supplements: [],
  supplementOther: '',
  hunger: null,
  likedFoods: '',
  dislikedFoods: '',
};

export function nutritionPayload(d: NutritionDraft) {
  return {
    cookingCapacity: d.cookingCapacity,
    mealsOutsideHomePerWeek: Math.round(num(d.mealsOutsideHomePerWeek) ?? 0),
    foodBudgetMonthlyBrl: Number(d.foodBudgetCents) / 100,
    // O número de refeições é a quantidade marcada: o aluno responde uma pergunta só.
    mealsPerDay: d.usualMeals.length,
    usualMeals: d.usualMeals,
    dietaryRestrictions: d.dietaryRestrictions,
    allergies: d.hasAllergy
      ? d.allergies
          .filter((a) => a.allergen.trim() !== '')
          .map((a) => ({ allergen: a.allergen.trim(), severity: a.severity }))
      : [],
    supplements: d.supplements,
    supplementOther: (d.supplements.includes('OTHER') && d.supplementOther.trim()) || undefined,
    hunger: d.hunger,
    likedFoods: d.likedFoods.trim() || undefined,
    dislikedFoods: d.dislikedFoods.trim() || undefined,
  };
}

export function nutritionComplete(d: NutritionDraft): boolean {
  return (
    d.cookingCapacity !== null &&
    d.foodBudgetCents !== '' &&
    !foodBudgetError(d.foodBudgetCents) &&
    d.mealsOutsideHomePerWeek.trim() !== '' &&
    !mealsOutsideError(d.mealsOutsideHomePerWeek) &&
    d.usualMeals.length > 0 &&
    d.hasAllergy !== undefined &&
    (!d.hasAllergy ||
      (d.allergies.length > 0 &&
        d.allergies.every((a) => a.allergen.trim() !== '' && a.severity !== null))) &&
    (!d.supplements.includes('OTHER') || d.supplementOther.trim() !== '') &&
    d.hunger !== null
  );
}

export function nutritionFromBlock(block: unknown): NutritionDraft {
  const data = block as
    | (Partial<Record<keyof NutritionDraft, unknown>> & { foodBudgetMonthlyBrl?: unknown })
    | undefined;
  if (!data?.usualMeals) return EMPTY_NUTRITION;
  return {
    ...EMPTY_NUTRITION,
    cookingCapacity: (data.cookingCapacity as NutritionDraft['cookingCapacity']) ?? null,
    mealsOutsideHomePerWeek:
      data.mealsOutsideHomePerWeek === undefined ? '' : String(data.mealsOutsideHomePerWeek),
    foodBudgetCents:
      typeof data.foodBudgetMonthlyBrl === 'number'
        ? String(Math.round(data.foodBudgetMonthlyBrl * 100))
        : '',
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

/** A etapa é opcional: só bloqueia medida preenchida fora da faixa plausível. */
export function bodyValid(d: BodyDraft): boolean {
  return BODY_FIELDS.every((kind) => !measurementError(kind, d[kind] ?? ''));
}
