/**
 * Entradas das tarefas de planejamento, montadas pelo CÓDIGO a partir do Estado do Aluno.
 *
 * O modelo não busca contexto: tudo que ele recebe (universo de exercícios permitido, limites
 * de energia, orçamento de sessões, fase da preparação) é calculado aqui, de forma
 * determinística e testável. É também aqui que a segurança entra antes do modelo — exercício
 * contraindicado nem chega à lista de candidatos.
 */
import type {
  CoachedModality,
  DeclaredGoalKind,
  ExperienceLevel,
  PlanSession,
  TrainingVenue,
  Weekday,
} from '@movivo/shared';

import {
  EXERCISE_CATALOG,
  type CatalogExercise,
  type ContraindicationTag,
  type ExerciseLevel,
  type ExerciseLocation,
  offeredToLevel,
  servesLocation,
} from '../catalog/exercises/exercise-catalog';
import { bodyIndicators } from './calc/body';
import { dayBounds, estimateExpenditure, type BodyInputs } from './calc/energy';
import {
  nutritionRules,
  rulesLevel,
  strengthRules,
  type NutritionRules,
  type RulesLevel,
} from './calc/params';
import { preferenceOf, usualMealsOf, type StateView } from './state-view';
import type { HyroxInput } from './tasks/hyrox';
import type { NutritionInput } from './tasks/nutrition';
import type { RunningInput } from './tasks/running';
import type { StrategyInput } from './tasks/strategy';
import type { StrengthCandidate, StrengthInput } from './tasks/strength';
import { at } from './calc/util';

const DAY_MS = 86_400_000;

export function weeksBetween(from: string, to: string): number {
  return Math.max(
    0,
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (7 * DAY_MS)),
  );
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

// --- Disponibilidade e orçamento de sessões -----------------------------------------------

export function distinctAvailableDays(view: StateView): number {
  return new Set(view.availability?.windows.map((w) => w.weekday)).size;
}

/** Sessões por semana que o aluno sustenta no total (inclui o esporte externo). */
export function sessionsPerWeekAvailable(view: StateView): number {
  const max = view.availability?.maxSessionsPerWeek ?? 3;
  const days = distinctAvailableDays(view);
  return Math.max(1, days > 0 ? Math.min(max, days) : max);
}

export function externalSessionsPerWeek(view: StateView): number {
  return view.training.externalSports.reduce((sum, s) => sum + s.sessionsPerWeek, 0);
}

/** Orçamento de sessões PRÓPRIAS (sem o esporte externo), no mínimo uma por modalidade em foco. */
export function coachedBudget(view: StateView, focusCount: number): number {
  return Math.max(focusCount, sessionsPerWeekAvailable(view) - externalSessionsPerWeek(view));
}

/**
 * Divide o orçamento entre as modalidades em foco (a ordem do foco é a prioridade): pesos 3/2/1,
 * mínimo de uma sessão cada. O que sobra de arredondamento vai para a mais prioritária.
 */
export function allocateSessions(
  focus: readonly CoachedModality[],
  budget: number,
): Record<string, number> {
  const modalities = focus.slice(0, Math.max(1, Math.min(focus.length, budget)));
  const weights = modalities.map((_, index) => 3 - index);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const result: Record<string, number> = {};
  let assigned = 0;
  modalities.forEach((modality, index) => {
    const share = Math.max(1, Math.floor((budget * at(weights, index)) / totalWeight));
    result[modality] = share;
    assigned += share;
  });
  const first = modalities[0];
  if (first) result[first] = (result[first] ?? 0) + (budget - assigned);
  return result;
}

/** Duração típica de uma sessão: a janela mediana do aluno, limitada pela preferência dele. */
export function minutesPerSession(view: StateView, min: number, max: number): number {
  const windows = view.availability?.windows.map((w) => w.maxMinutes) ?? [];
  const typical = windows.length > 0 ? median(windows) : 60;
  const preferred = preferenceOf(view, 'SESSION_LENGTH', 'session_minutes');
  const target = typeof preferred === 'number' ? Math.min(typical, preferred) : typical;
  return Math.max(min, Math.min(max, target));
}

// --- Estratégia -----------------------------------------------------------------------------

export function levelOf(view: StateView, modality: CoachedModality): RulesLevel {
  return rulesLevel(
    view.training.modalities.find((m) => m.modality === modality)?.level as ExperienceLevel,
  );
}

export function strategyInputOf(
  view: StateView,
  nutrition: NutritionRules,
  today: string,
): StrategyInput | null {
  if (!view.goal || view.training.modalities.length === 0) return null;
  const heightCm = view.identity.heightCm;
  const indicators = bodyIndicators(view.body, heightCm, view.identity.biologicalSex, nutrition);
  const event = view.goal.declared.targetEvent;
  return {
    declared: view.goal.declared,
    modalities: view.training.modalities.map((m) => ({
      modality: m.modality,
      level: m.level,
      wantsToStart: m.wantsToStart,
    })),
    derived: {
      adiposity: indicators.adiposity,
      bmi: indicators.bmi,
      weeksToEvent: event ? weeksBetween(today, event.date) : null,
      hasExternalSport: view.training.externalSports.length > 0,
      sessionsPerWeekAvailable: sessionsPerWeekAvailable(view),
    },
  };
}

// --- Força ----------------------------------------------------------------------------------

const VENUE_TO_LOCATION: Record<TrainingVenue, ExerciseLocation> = {
  FULL_GYM: 'FULL_GYM',
  HYROX_GYM: 'FULL_GYM',
  BASIC_GYM: 'CONDO_GYM',
  CONDO_GYM: 'CONDO_GYM',
  HOME: 'HOME',
  OUTDOOR: 'OUTDOOR',
  TRACK: 'OUTDOOR',
};

const LEVEL_TO_CATALOG: Record<RulesLevel, ExerciseLevel> = {
  BEGINNER: 'INICIANTE',
  INTERMEDIATE: 'INTERMEDIARIO',
  ADVANCED: 'AVANCADO',
};

/** Local e nível do aluno no vocabulário do catálogo (para equivalentes seguros). */
export function catalogProfileOf(view: StateView): {
  location: ExerciseLocation;
  level: ExerciseLevel;
} {
  return {
    location: VENUE_TO_LOCATION[view.training.venues[0] ?? 'FULL_GYM'],
    level: LEVEL_TO_CATALOG[levelOf(view, 'STRENGTH')],
  };
}

/** Tags de contraindicação do aluno: dor/lesão registradas e sinais de segurança ativos. */
export function contraindicationsOf(view: StateView): Set<ContraindicationTag> {
  const tags = new Set<ContraindicationTag>();
  for (const record of view.safety.records) {
    for (const tag of record.movementTags ?? []) tags.add(tag as ContraindicationTag);
    if (record.kind === 'PREGNANCY') tags.add('PREGNANCY');
  }
  for (const signal of view.safety.signals) {
    if (signal.kind === 'PREGNANCY') tags.add('PREGNANCY');
    if (signal.kind === 'FAINTING_OR_DIZZINESS') tags.add('BALANCE_FALL_RISK');
    if (signal.kind === 'CHEST_PAIN' || signal.kind === 'SHORTNESS_OF_BREATH') tags.add('CARDIAC');
  }
  return tags;
}

export function exercisePreference(view: StateView, kind: 'LIKES' | 'DISLIKES'): Set<string> {
  return new Set(
    view.preferences
      .filter((p) => p.domain === 'EXERCISE' && p.value === kind)
      .map((p) => p.key.replace(/^exercise:/, '')),
  );
}

const MAJOR_GROUPS = new Set([
  'peito',
  'costas',
  'ombro',
  'quadríceps',
  'posterior de coxa',
  'glúteo',
]);
const PER_MAJOR_GROUP = 14;
const PER_OTHER_GROUP = 6;
const CANDIDATE_CAP = 160;

/**
 * Universo de exercícios permitido: viável no local e no nível do aluno, sem contraindicação
 * registrada, sem o que ele rejeitou. Equilibrado por grupo muscular para o modelo ter opção
 * de montar qualquer divisão. Cardio fica com o treinador de corrida.
 */
export function selectStrengthCandidates(
  view: StateView,
  level: RulesLevel,
  catalog: readonly CatalogExercise[] = EXERCISE_CATALOG,
): { candidates: StrengthCandidate[]; preferredExerciseIds: string[] } {
  const location = VENUE_TO_LOCATION[view.training.venues[0] ?? 'FULL_GYM'];
  const catalogLevel = LEVEL_TO_CATALOG[level];
  const blocked = contraindicationsOf(view);
  const disliked = exercisePreference(view, 'DISLIKES');
  const liked = exercisePreference(view, 'LIKES');

  const viable = catalog.filter(
    (e) =>
      e.pattern !== 'CARDIO' &&
      offeredToLevel(e, catalogLevel) &&
      servesLocation(e, location) &&
      !disliked.has(e.id) &&
      !e.contraindicatedFor.some((tag) => blocked.has(tag)),
  );
  const byGroup = new Map<string, CatalogExercise[]>();
  for (const exercise of viable) {
    const group = exercise.muscleGroups[0] ?? 'outros';
    byGroup.set(group, [...(byGroup.get(group) ?? []), exercise]);
  }
  const rank = (e: CatalogExercise) =>
    (liked.has(e.id) ? 0 : 4) + (e.isFavorite ? 0 : 2) + (e.pattern === 'ISOLATION' ? 1 : 0);
  const picked: CatalogExercise[] = [];
  for (const [group, exercises] of byGroup) {
    const cap = MAJOR_GROUPS.has(group) ? PER_MAJOR_GROUP : PER_OTHER_GROUP;
    picked.push(...[...exercises].sort((a, b) => rank(a) - rank(b)).slice(0, cap));
  }
  const candidates = picked.slice(0, CANDIDATE_CAP).map<StrengthCandidate>((e) => ({
    id: e.id,
    name: e.name,
    pattern: e.pattern,
    muscleGroups: e.muscleGroups.slice(0, 3),
    equipment: e.equipment.slice(0, 3),
    measurement: e.measurement ?? 'REPS',
  }));
  const ids = new Set(candidates.map((c) => c.id));
  return { candidates, preferredExerciseIds: [...liked].filter((id) => ids.has(id)) };
}

const SPLITS = ['FULL_BODY', 'UPPER_LOWER', 'PUSH_PULL_LEGS', 'BODY_PART'] as const;

function strengthGoalOf(primary: DeclaredGoalKind, strengthIsPrimary: boolean) {
  if (strengthIsPrimary) {
    if (primary === 'STRENGTH') return 'STRENGTH' as const;
    return 'HYPERTROPHY' as const;
  }
  if (primary === 'RUNNING_PERFORMANCE' || primary === 'RACE_PREPARATION')
    return 'STRENGTH' as const;
  return 'MUSCULAR_ENDURANCE' as const;
}

export function strengthInputOf(
  view: StateView,
  params: Parameters<typeof strengthRules>[0],
  options: {
    sessions: number;
    priority: number;
    strengthIsPrimary: boolean;
    catalog?: readonly CatalogExercise[];
  },
): StrengthInput | null {
  if (!view.goal) return null;
  const level = levelOf(view, 'STRENGTH');
  const rules = strengthRules(params, level);
  const experience = view.training.modalities.find((m) => m.modality === 'STRENGTH');
  const goal = strengthGoalOf(view.goal.declared.primary, options.strengthIsPrimary);
  const beginner = level === 'BEGINNER' || (experience?.monthsPracticing ?? 0) < 3;
  const preferredSplit = preferenceOf(view, 'TRAINING_STRUCTURE', 'split');
  const split =
    typeof preferredSplit === 'string' && (SPLITS as readonly string[]).includes(preferredSplit)
      ? (preferredSplit as (typeof SPLITS)[number])
      : 'NO_PREFERENCE';
  const { candidates, preferredExerciseIds } = selectStrengthCandidates(
    view,
    level,
    options.catalog,
  );
  if (candidates.length < 8) return null;
  return {
    level,
    goal,
    phase: beginner ? 'ADAPTATION' : goal === 'STRENGTH' ? 'STRENGTH' : 'HYPERTROPHY',
    sessionsPerWeek: Math.min(6, options.sessions),
    minutesPerSession: minutesPerSession(view, 20, 180),
    weeksInBlock: rules.mesocycleWeeks ? Math.round(rules.mesocycleWeeks.min) : 4,
    split,
    modalityPriority: options.priority,
    candidates,
    preferredExerciseIds,
  };
}

// --- Corrida e HYROX ------------------------------------------------------------------------

export type RacePhase = 'BASE' | 'BUILD' | 'PEAK' | 'TAPER' | 'MAINTENANCE';

export function racePhase(weeksToRace: number | null, taperWeeks = 2): RacePhase {
  if (weeksToRace === null) return 'BASE';
  if (weeksToRace <= taperWeeks) return 'TAPER';
  if (weeksToRace <= 6) return 'PEAK';
  if (weeksToRace <= 14) return 'BUILD';
  return 'BASE';
}

export function runningInputOf(
  view: StateView,
  options: { sessions: number; priority: number; today: string; runningIsPrimary: boolean },
): RunningInput | null {
  if (!view.goal) return null;
  const experience = view.training.modalities.find((m) => m.modality === 'RUNNING');
  const event = view.goal.declared.targetEvent;
  const race =
    event && event.kind === 'RUNNING_RACE' && event.distanceMeters
      ? {
          distanceMeters: event.distanceMeters,
          weeksToRace: weeksBetween(options.today, event.date),
          targetSeconds: event.targetSeconds ?? null,
        }
      : null;
  const primary = view.goal.declared.primary;
  const goal = race
    ? ('RACE' as const)
    : primary === 'RUNNING_PERFORMANCE'
      ? ('PERFORMANCE' as const)
      : options.runningIsPrimary
        ? ('FITNESS' as const)
        : ('COMPLEMENT' as const);
  const weeks = race ? Math.max(2, Math.min(4, race.weeksToRace)) : 4;
  return {
    level: levelOf(view, 'RUNNING'),
    goal,
    phase: race ? racePhase(race.weeksToRace) : 'BASE',
    sessionsPerWeek: Math.min(6, options.sessions),
    minutesPerSession: minutesPerSession(view, 20, 240),
    weeksInBlock: weeks,
    currentWeeklyKm: experience?.weeklyKm ?? 0,
    recent5kSeconds: experience?.recent5kSeconds ?? null,
    race,
    modalityPriority: options.priority,
  };
}

/** Estações com equipamento oficial presumido por tipo de local (conservador). */
const STATIONS_BY_VENUE: Record<TrainingVenue, HyroxInput['stationsWithEquipment']> = {
  HYROX_GYM: [
    'SKIERG',
    'SLED_PUSH',
    'SLED_PULL',
    'BURPEE_BROAD_JUMP',
    'ROWING',
    'FARMERS_CARRY',
    'SANDBAG_LUNGES',
    'WALL_BALLS',
  ],
  FULL_GYM: ['SKIERG', 'SLED_PUSH', 'SLED_PULL', 'ROWING', 'FARMERS_CARRY', 'WALL_BALLS'],
  BASIC_GYM: ['ROWING', 'FARMERS_CARRY', 'WALL_BALLS'],
  CONDO_GYM: ['FARMERS_CARRY'],
  HOME: [],
  OUTDOOR: [],
  TRACK: [],
};

export function hyroxInputOf(
  view: StateView,
  params: { taperWeeks: number | null; simulationEveryWeeks: number | null },
  options: { sessions: number; priority: number; today: string },
): HyroxInput | null {
  if (!view.goal) return null;
  const event = view.goal.declared.targetEvent;
  const weeksToRace =
    event && event.kind === 'HYROX_RACE' ? weeksBetween(options.today, event.date) : null;
  const experience = view.training.modalities.find((m) => m.modality === 'HYROX');
  const sex = view.identity.biologicalSex === 'FEMALE' ? 'openFemale' : 'openMale';
  const venue = view.training.venues[0] ?? 'FULL_GYM';
  const phase = racePhase(weeksToRace, params.taperWeeks ?? 1);
  return {
    level: levelOf(view, 'HYROX'),
    division: 'OPEN',
    category: sex,
    phase,
    weeksToRace,
    sessionsPerWeek: Math.min(5, options.sessions),
    minutesPerSession: minutesPerSession(view, 20, 180),
    weeksInBlock: weeksToRace === null ? 4 : Math.max(2, Math.min(4, weeksToRace)),
    simulationDue: phase === 'PEAK' && (weeksToRace ?? 0) > 1,
    stationsWithEquipment: STATIONS_BY_VENUE[venue],
    currentWeeklyKm:
      view.training.modalities.find((m) => m.modality === 'RUNNING')?.weeklyKm ??
      experience?.weeklyKm ??
      0,
    modalityPriority: options.priority,
  };
}

// --- Esporte externo e híbrido --------------------------------------------------------------

export function externalSessionsOf(view: StateView): {
  sessions: PlanSession[];
  fixedDays: Record<string, Weekday[]>;
} {
  const sessions: PlanSession[] = [];
  const fixedDays: Record<string, Weekday[]> = {};
  view.training.externalSports.forEach((sport, index) => {
    const key = `EXT_${index + 1}`;
    sessions.push({
      key,
      title: sport.label,
      purpose: 'Esporte que você já pratica: o plano é montado em volta dele.',
      priority: 'IMPORTANT',
      weeklyFrequency: sport.sessionsPerWeek,
      estimatedMinutes: sport.minutesPerSession,
      estimatedRpe: sport.typicalRpe,
      content: {
        modality: 'EXTERNAL_SPORT',
        sport: sport.sport,
        label: sport.label,
        plannedMinutes: sport.minutesPerSession,
        plannedRpe: sport.typicalRpe,
      },
    });
    fixedDays[key] = sport.fixedDays;
  });
  return { sessions, fixedDays };
}

/** Carga semanal média (sRPE) das últimas três semanas; `null` sem histórico confiável. */
export function recentWeeklyLoad(view: StateView): number | null {
  const done = view.training.executions.filter((e) => e.load !== null);
  if (done.length < 4) return null;
  return Math.round(done.reduce((sum, e) => sum + (e.load ?? 0), 0) / 3);
}

// --- Nutrição -------------------------------------------------------------------------------

export function nutritionInputOf(
  view: StateView,
  params: Parameters<typeof nutritionRules>[0],
  options: {
    strategy: NutritionInput['strategy'];
    sessions: readonly PlanSession[];
    enduranceFocus: boolean;
  },
): NutritionInput | null {
  const rules = nutritionRules(params);
  const { identity } = view;
  const weightKg = view.body['WEIGHT']?.latest;
  if (!identity.biologicalSex || !identity.ageYears || !identity.heightCm || !weightKg) return null;
  const body: BodyInputs = {
    sex: identity.biologicalSex,
    ageYears: identity.ageYears,
    heightCm: identity.heightCm,
    weightKg,
    bodyFatPercent: view.body['BODY_FAT_PERCENT']?.latest ?? null,
  };
  const expenditure = estimateExpenditure(body, options.sessions, rules);
  const bound = (kcal: number) => {
    const b = dayBounds(options.strategy, kcal, body, rules, options.enduranceFocus);
    return {
      energyKcal: b.energyKcal,
      proteinG: {
        min: b.proteinG.min,
        max: Number.isFinite(b.proteinG.max) ? b.proteinG.max : null,
      },
      fatMinG: b.fatMinG,
      fiberMinG: b.fiberMinG,
      waterMinMl: b.waterMinMl,
      expenditureKcal: kcal,
    };
  };
  const meals = usualMealsOf(view);
  const mealsPerDay = preferenceOf(view, 'FOOD', 'meals_per_day');
  const life = identity.lifeContext;
  return {
    strategy: options.strategy,
    weightKg,
    bounds: {
      trainingDay: bound(expenditure.trainingDayKcal),
      restDay: bound(expenditure.restDayKcal),
    },
    mealsPerDay: typeof mealsPerDay === 'number' ? mealsPerDay : Math.max(3, meals.length),
    usualMeals: meals.length > 0 ? meals : ['BREAKFAST', 'LUNCH', 'DINNER'],
    dietaryRestrictions: view.dietaryRestrictions,
    allowedSupplements: rules.allowedSupplements,
    proteinPerMealMinG: rules.proteinPerMealMinG,
    maxWeeklyWeightLossPct: rules.maxWeeklyWeightLossPct,
    cookingCapacity: life?.cookingCapacity ?? 'BASIC',
    foodBudget: life?.foodBudget ?? 'MODERATE',
    mealsOutsideHomePerWeek: life?.mealsOutsideHomePerWeek ?? 0,
  };
}
