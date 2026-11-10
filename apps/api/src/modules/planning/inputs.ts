/**
 * Entradas das tarefas de planejamento, montadas pelo CÓDIGO a partir do Estado do Aluno.
 *
 * O modelo não busca contexto: tudo que ele recebe (universo de exercícios permitido, limites
 * de energia, orçamento de sessões, fase da preparação) é calculado aqui, de forma
 * determinística e testável. É também aqui que a segurança entra antes do modelo — exercício
 * contraindicado nem chega à lista de candidatos.
 */
import {
  defaultVenueOf,
  eligibleRunningWorkouts,
  externalSportName,
  MESOCYCLE_LABELS,
  MUSCLE_EMPHASIS_GROUPS,
  RUNNING_WORKOUTS,
  type CoachedModality,
  type DeclaredGoalKind,
  type ExperienceLevel,
  type Mesocycle,
  type MethodologyParameters,
  type MuscleEmphasisRegion,
  type PlanPhase,
  type PlanSession,
  type SessionPlan,
  type TrainingVenue,
  type Weekday,
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
import { CARDIO_PROFILE, cardioPrescription } from './calc/cardio';
import { dayBounds, estimateExpenditure, type BodyInputs } from './calc/energy';
import type { PlanCheckContext } from './calc/plan-check';
import {
  hybridRules,
  nutritionRules,
  rulesLevel,
  runningRules,
  strengthRules,
  type HybridRules,
  type NutritionRules,
  type RulesLevel,
} from './calc/params';
import { isStarter, runningWeekRoles } from './calc/running-week';
import type { ScheduleContext } from './plan-publisher.service';
import { preferenceOf, usualMealsOf, type StateView } from './state-view';
import type { HyroxInput } from './tasks/hyrox';
import type { NutritionInput } from './tasks/nutrition';
import type { RunningInput } from './tasks/running';
import type { SessionLimits, StrategyInput } from './tasks/strategy';
import {
  strengthTimeBudget,
  type CardioCandidate,
  type StrengthCandidate,
  type StrengthInput,
} from './tasks/strength';

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

/**
 * Teto de sessões próprias por semana, calculado em código: o aluno informa os dias em que PODE
 * treinar; quantas sessões fazem sentido, quem decide é a MOVIVO (agente de estratégia), sempre
 * abaixo deste teto. Respeita o descanso mínimo da metodologia e só conta sessão dupla (mais de
 * uma no mesmo dia) quando a metodologia a permite: no máximo uma dupla a cada dois dias de treino.
 */
export function sessionLimitsOf(view: StateView, rules: HybridRules): SessionLimits {
  const stored = view.availability?.maxSessionsPerWeek ?? 3;
  const availableDays = distinctAvailableDays(view) || Math.min(7, stored);
  const minRestDays = Math.max(0, rules.minRestDaysPerWeek ?? 1);
  const maxTrainingDays = Math.max(1, Math.min(availableDays, 7 - minRestDays));
  const doubleDays = rules.allowTwoSessionsSameDay ? Math.floor(maxTrainingDays / 2) : 0;
  return {
    availableDays,
    maxTrainingDays,
    minRestDays,
    allowTwoSessionsSameDay: rules.allowTwoSessionsSameDay,
    maxSessions: Math.min(14, maxTrainingDays + doubleDays),
  };
}

/** Duração típica de uma sessão: a janela mediana do aluno, limitada pela preferência dele (inferida das conversas). */
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

/** Local da modalidade: o escolhido na anamnese ou, em perfil antigo, o mais completo entre os locais. */
export function venueOf(view: StateView, modality: CoachedModality): TrainingVenue {
  return (
    view.training.modalities.find((m) => m.modality === modality)?.venue ??
    defaultVenueOf(modality, view.training.venues)
  );
}

/**
 * Frequência de respaldo para estratégias salvas antes de a MOVIVO decidir o plano de sessões:
 * o que a anamnese guardou como teto, limitado ao teto atual, dividido por igual entre as
 * modalidades (a sobra vai para as mais prioritárias). Estratégia nova nunca passa por aqui.
 */
export function fallbackSessionPlan(
  view: StateView,
  focus: readonly CoachedModality[],
  rules: HybridRules,
): SessionPlan {
  const limits = sessionLimitsOf(view, rules);
  const stored = view.availability?.maxSessionsPerWeek ?? 3;
  const weekly = Math.max(focus.length, Math.min(stored, limits.maxSessions));
  const base = Math.floor(weekly / focus.length);
  const extra = weekly - base * focus.length;
  return {
    weekly,
    byModality: focus.map((modality, index) => ({
      modality,
      sessions: Math.min(6, base + (index < extra ? 1 : 0)),
    })),
    reason: 'Frequência de respaldo: a estratégia anterior não registrou o plano de sessões.',
  };
}

export function strategyInputOf(
  view: StateView,
  nutrition: NutritionRules,
  today: string,
  hybrid: HybridRules,
): StrategyInput | null {
  if (!view.goal || view.training.modalities.length === 0) return null;
  const heightCm = view.identity.heightCm;
  const indicators = bodyIndicators(
    view.body,
    heightCm,
    view.identity.biologicalSex,
    nutrition,
    view.bodyComposition?.bodyFatRange ?? null,
  );
  const event = view.goal.declared.targetEvent;
  return {
    declared: view.goal.declared,
    modalities: view.training.modalities.map((m) => ({
      modality: m.modality,
      level: m.level,
      wantsToStart: m.wantsToStart,
    })),
    externalSports: view.training.externalSports.map((sport) => ({
      name: externalSportName(sport.sport, sport.label),
      sessionsPerWeek: sport.sessionsPerWeek,
      minutesPerSession: sport.minutesPerSession,
      typicalRpe: sport.typicalRpe,
      fixedDays: sport.fixedDays,
    })),
    derived: {
      adiposity: indicators.adiposity,
      adiposityBasis: indicators.adiposityBasis,
      bmi: indicators.bmi,
      weeksToEvent: event ? weeksBetween(today, event.date) : null,
      hasExternalSport: view.training.externalSports.length > 0,
      sessionLimits: sessionLimitsOf(view, hybrid),
    },
  };
}

// --- Força ----------------------------------------------------------------------------------

const VENUE_TO_LOCATION: Record<TrainingVenue, ExerciseLocation> = {
  FULL_GYM: 'FULL_GYM',
  HYROX_GYM: 'FULL_GYM',
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
    location: VENUE_TO_LOCATION[venueOf(view, 'STRENGTH')],
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

/** Exercícios de força seguros e viáveis: local e nível do aluno, sem contraindicação nem rejeição. */
export function viableStrengthExercises(
  view: StateView,
  level: RulesLevel,
  catalog: readonly CatalogExercise[] = EXERCISE_CATALOG,
): CatalogExercise[] {
  const location = VENUE_TO_LOCATION[venueOf(view, 'STRENGTH')];
  const catalogLevel = LEVEL_TO_CATALOG[level];
  const blocked = contraindicationsOf(view);
  const disliked = exercisePreference(view, 'DISLIKES');
  return catalog.filter(
    (e) =>
      e.pattern !== 'CARDIO' &&
      offeredToLevel(e, catalogLevel) &&
      servesLocation(e, location) &&
      !disliked.has(e.id) &&
      !e.contraindicatedFor.some((tag) => blocked.has(tag)),
  );
}

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
  const liked = exercisePreference(view, 'LIKES');
  const viable = viableStrengthExercises(view, level, catalog);
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

/**
 * Cardio de apoio à musculação: só os exercícios de cardio JÁ cadastrados no catálogo e listados
 * em `CARDIO_PROFILE`, viáveis no local e no nível do aluno, sem contraindicação nem rejeição.
 * Iniciante só recebe cardio moderado; o vigoroso (HIIT, tiros) fica para quem já tem base.
 */
export function selectCardioCandidates(
  view: StateView,
  level: RulesLevel,
  catalog: readonly CatalogExercise[] = EXERCISE_CATALOG,
): CardioCandidate[] {
  const location = VENUE_TO_LOCATION[venueOf(view, 'STRENGTH')];
  const catalogLevel = LEVEL_TO_CATALOG[level];
  const blocked = contraindicationsOf(view);
  const disliked = exercisePreference(view, 'DISLIKES');
  const liked = exercisePreference(view, 'LIKES');
  return catalog
    .filter((e) => {
      const intensity = CARDIO_PROFILE[e.id];
      return (
        e.pattern === 'CARDIO' &&
        intensity !== undefined &&
        (level !== 'BEGINNER' || intensity === 'MODERATE') &&
        offeredToLevel(e, catalogLevel) &&
        servesLocation(e, location) &&
        !disliked.has(e.id) &&
        !e.contraindicatedFor.some((tag) => blocked.has(tag))
      );
    })
    .sort(
      (a, b) =>
        (liked.has(a.id) ? 0 : 2) +
        (a.isFavorite ? 0 : 1) -
        ((liked.has(b.id) ? 0 : 2) + (b.isFavorite ? 0 : 1)),
    )
    .map<CardioCandidate>((e) => ({
      id: e.id,
      name: e.name,
      intensity: CARDIO_PROFILE[e.id] ?? 'MODERATE',
    }));
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
    /** Mesociclo escolhido pela reavaliação do ciclo anterior. */
    mesocycle?: Mesocycle;
    /** O que o plano já tem de outra atividade aeróbia: desconta da meta de cardio da OMS. */
    otherCardio?: { runningSessions: number; externalMinutesPerWeek: number };
  },
): StrengthInput | null {
  if (!view.goal) return null;
  const level = levelOf(view, 'STRENGTH');
  const rules = strengthRules(params, level);
  const experience = view.training.modalities.find((m) => m.modality === 'STRENGTH');
  const declaredGoal = strengthGoalOf(view.goal.declared.primary, options.strengthIsPrimary);
  const months = experience?.monthsPracticing;
  const beginner =
    level === 'BEGINNER' ||
    experience?.wantsToStart === true ||
    (months !== undefined && months < 3);
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
  const phase = mesocycleOf({
    goal: declaredGoal,
    beginner,
    previous: view.training.activeMesocycle,
    chosen: options.mesocycle,
  });
  // As faixas de repetição seguem o mesociclo quando ele é de Força ou de Hipertrofia.
  const goal =
    phase === 'STRENGTH'
      ? 'STRENGTH'
      : phase === 'HYPERTROPHY' && declaredGoal === 'STRENGTH'
        ? 'HYPERTROPHY'
        : declaredGoal;
  const blockWeeks = rules.blockWeeksByPhase[phase];
  const sessionMinutes = minutesPerSession(view, 20, 180);
  const cardio = cardioOf(view, level, {
    beginner,
    strengthSessions: Math.min(6, options.sessions),
    minutesPerSession: sessionMinutes,
    otherCardio: options.otherCardio,
    catalog: options.catalog,
  });
  return {
    level,
    goal,
    phase,
    sessionsPerWeek: Math.min(6, options.sessions),
    minutesPerSession: sessionMinutes,
    weeksInBlock: blockWeeks
      ? Math.min(12, Math.max(1, Math.round(blockWeeks.min)))
      : DEFAULT_BLOCK_WEEKS[phase],
    split,
    modalityPriority: options.priority,
    candidates,
    preferredExerciseIds,
    emphasisMuscleGroups: emphasisGroupsOf(view),
    ...cardio,
    timeBudget: strengthTimeBudget(
      {
        minutesPerSession: sessionMinutes,
        sessionsPerWeek: Math.min(6, options.sessions),
        candidates,
        cardio: cardio.cardio,
      },
      rules,
    ),
  };
}

/** Tempo típico de uma sessão de corrida do plano para contar como atividade aeróbia da semana. */
const RUNNING_MINUTES_PER_SESSION = 40;

/** Quanto de cardio (OMS) a musculação carrega, o que sobra para o dia a dia e o que pode usar. */
function cardioOf(
  view: StateView,
  level: RulesLevel,
  options: {
    beginner: boolean;
    strengthSessions: number;
    minutesPerSession: number;
    otherCardio?: { runningSessions: number; externalMinutesPerWeek: number };
    catalog?: readonly CatalogExercise[];
  },
): Pick<StrengthInput, 'cardio' | 'dailyActivityMinutes'> {
  if (!view.goal) return {};
  const prescription = cardioPrescription({
    goals: [view.goal.declared.primary, ...view.goal.declared.secondary],
    beginner: options.beginner,
    strengthSessions: options.strengthSessions,
    minutesPerSession: options.minutesPerSession,
    runningMinutesPerWeek:
      (options.otherCardio?.runningSessions ?? 0) *
      Math.min(RUNNING_MINUTES_PER_SESSION, options.minutesPerSession),
    externalMinutesPerWeek: options.otherCardio?.externalMinutesPerWeek ?? 0,
  });
  const candidates = selectCardioCandidates(view, level, options.catalog);
  if (prescription.weeklyMinutes === 0 || candidates.length === 0) {
    // Não coube na sessão (curta) ou não há cardio viável: a meta se completa no dia a dia.
    const missing = Math.max(0, prescription.targetMinutes - prescription.coveredMinutes);
    return missing >= 5 ? { dailyActivityMinutes: missing } : {};
  }
  return {
    cardio: {
      targetMinutes: prescription.targetMinutes,
      coveredMinutes: prescription.coveredMinutes,
      weeklyMinutes: prescription.weeklyMinutes,
      perSessionMinutes: prescription.perSession,
      leftoverMinutes: prescription.leftoverMinutes,
      candidates: candidates.slice(0, 12),
    },
  };
}

/** Sem a tabela publicada na Metodologia: faixas clássicas (Adaptação curta, deload de 1 semana). */
const DEFAULT_BLOCK_WEEKS: Readonly<Record<Mesocycle, number>> = {
  ADAPTATION: 3,
  HYPERTROPHY: 4,
  STRENGTH: 4,
  DELOAD: 1,
};

/**
 * Mesociclo do bloco de musculação. A reavaliação do ciclo escolhe o próximo; sem ela, o ponto de
 * entrada: Adaptação para iniciante ou quem não treina hoje (retorno após parada), salvo se o
 * aluno já cumpriu um ciclo na MOVIVO; depois, Força ou Hipertrofia conforme o objetivo.
 */
export function mesocycleOf(input: {
  goal: StrengthInput['goal'];
  beginner: boolean;
  previous: Mesocycle | null;
  chosen?: Mesocycle;
}): Mesocycle {
  if (input.chosen) return input.chosen;
  if (input.beginner && input.previous === null) return 'ADAPTATION';
  return input.goal === 'STRENGTH' ? 'STRENGTH' : 'HYPERTROPHY';
}

/**
 * A fase do bloco é o mesociclo decidido pelo código, com a duração da Metodologia: a IA só
 * descreve o foco e diz se o bloco termina com semana leve.
 */
export function mesocyclePhaseOf(
  input: Pick<StrengthInput, 'phase' | 'weeksInBlock'>,
  drafted: readonly PlanPhase[],
): PlanPhase {
  return {
    mesocycle: input.phase,
    name: MESOCYCLE_LABELS[input.phase],
    focus: drafted[0]?.focus ?? MESOCYCLE_LABELS[input.phase],
    weeks: input.weeksInBlock,
    endsWithDeload: input.phase !== 'DELOAD' && drafted.some((phase) => phase.endsWithDeload),
  };
}

/** Grupos musculares da ênfase declarada na anamnese (`muscle_emphasis`, regiões separadas por vírgula). */
function emphasisGroupsOf(view: StateView): string[] {
  const raw = preferenceOf(view, 'TRAINING_STRUCTURE', 'muscle_emphasis');
  if (typeof raw !== 'string' || raw === '') return [];
  return raw
    .split(',')
    .flatMap((region) => MUSCLE_EMPHASIS_GROUPS[region as MuscleEmphasisRegion] ?? []);
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

/** Treinos que dependem de uma prova marcada: sem prova, não entram no bloco. */
const RACE_ONLY_WORKOUTS: readonly string[] = [
  'RACE_SIMULATION',
  'RACE_PACE_RUN',
  'RACE_PACE_REPEATS',
];

const GYM_VENUES: readonly TrainingVenue[] = ['FULL_GYM', 'HYROX_GYM', 'CONDO_GYM'];

/** O treino cabe no local de corrida do aluno? (trilha, areia e descida pedem rua; esteira, academia) */
function workoutFitsVenue(
  spec: (typeof RUNNING_WORKOUTS)[keyof typeof RUNNING_WORKOUTS],
  type: string,
  venue: TrainingVenue,
): boolean {
  const outdoors = venue === 'OUTDOOR' || venue === 'TRACK';
  if (spec.terrain === 'TRAIL' || spec.terrain === 'SAND' || type === 'DOWNHILL_RUN')
    return venue === 'OUTDOOR';
  if (spec.terrain === 'TREADMILL') return GYM_VENUES.includes(venue);
  // Subida: na rua, no morro; na academia, a inclinação da esteira.
  if (spec.terrain === 'HILLS') return outdoors || GYM_VENUES.includes(venue);
  return true;
}

/** Objetivos declarados (principal e secundários): quem quer correr melhor, em qualquer posição. */
function wantsRunningPerformance(view: StateView): boolean {
  const declared = view.goal?.declared;
  if (!declared) return false;
  return [declared.primary, ...declared.secondary].some(
    (goal) => goal === 'RUNNING_PERFORMANCE' || goal === 'RACE_PREPARATION',
  );
}

export function runningInputOf(
  view: StateView,
  options: {
    sessions: number;
    priority: number;
    today: string;
    /** Parâmetros publicados da metodologia de corrida (teto de sessões de qualidade). */
    params?: Parameters<typeof runningRules>[0];
  },
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
  // Quem escolhe corrida na anamnese quer treino estruturado, não só "cardio": sem prova nem
  // objetivo de desempenho, o treino segue estruturado (qualidade + longão), em foco de condicionamento.
  const goal = race
    ? ('RACE' as const)
    : wantsRunningPerformance(view)
      ? ('PERFORMANCE' as const)
      : ('FITNESS' as const);
  const level = levelOf(view, 'RUNNING');
  const currentWeeklyKm = experience?.weeklyKm ?? 0;
  const starter = isStarter(currentWeeklyKm, level);
  // Periodização: com prova, pela distância até ela; sem, a base aeróbia vem antes da construção
  // (iniciante ou com pouco volume começa na base; quem já corre bem entra em construção).
  const phase = race
    ? racePhase(race.weeksToRace)
    : level === 'BEGINNER' || currentWeeklyKm < 15
      ? ('BASE' as const)
      : ('BUILD' as const);
  const weeks = race ? Math.max(2, Math.min(4, race.weeksToRace)) : 4;
  const sessions = Math.min(6, options.sessions);
  const venue = venueOf(view, 'RUNNING');
  const qualityMax = options.params
    ? runningRules(options.params, level).qualitySessionsPerWeekMax
    : null;
  const roles = runningWeekRoles({ sessions, goal, phase, level, qualityMax, starter });
  const workouts = eligibleRunningWorkouts({ level, phase })
    .filter((type) => {
      const spec = RUNNING_WORKOUTS[type];
      if (!race && RACE_ONLY_WORKOUTS.includes(type)) return false;
      if (starter && (spec.intensity === 'HARD' || spec.kind === 'MODERATE')) return false;
      return workoutFitsVenue(spec, type, venue);
    })
    .map((type) => {
      const spec = RUNNING_WORKOUTS[type];
      return {
        type,
        label: spec.label,
        kind: spec.kind,
        intensity: spec.intensity,
        stimulus: spec.stimulus,
        objective: spec.objective,
        adaptation: spec.adaptation,
        needsPaceAnchor: spec.needsPaceAnchor,
        ...(spec.terrain ? { terrain: spec.terrain } : {}),
        ...(spec.caution ? { caution: spec.caution } : {}),
      };
    });
  return {
    level,
    goal,
    phase,
    sessionsPerWeek: sessions,
    minutesPerSession: minutesPerSession(view, 20, 240),
    weeksInBlock: weeks,
    currentWeeklyKm,
    recent5kSeconds: experience?.recent5kSeconds ?? null,
    race,
    modalityPriority: options.priority,
    venue,
    starter,
    weekRoles: roles,
    workouts,
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
  const venue = venueOf(view, 'HYROX');
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

/** Contexto da agenda: janelas do aluno, regras do híbrido e o espaçamento entre treinos intensos. */
export function scheduleContextOf(
  view: StateView,
  hybridParameters: MethodologyParameters | undefined,
  runningParameters: MethodologyParameters | undefined,
): ScheduleContext {
  return {
    windows: view.availability?.windows ?? [],
    rules: hybridRules(hybridParameters),
    minEasyDaysBetweenIntense: Math.max(
      0,
      runningRules(runningParameters, levelOf(view, 'RUNNING')).minEasyDaysBetweenQuality ?? 1,
    ),
    externalFixedDays: externalSessionsOf(view).fixedDays,
  };
}

/** Carga semanal média (sRPE) das últimas três semanas; `null` sem histórico confiável. */
export function recentWeeklyLoad(view: StateView): number | null {
  const done = view.training.executions.filter((e) => e.load !== null);
  if (done.length < 4) return null;
  return Math.round(done.reduce((sum, e) => sum + (e.load ?? 0), 0) / 3);
}

/** Contexto da verificação final do plano (`checkTrainingPlan`) a partir do Estado do Aluno. */
export function planCheckContextOf(
  view: StateView,
  focus: readonly CoachedModality[],
  hybridParameters: MethodologyParameters | undefined,
  runningParameters: MethodologyParameters | undefined,
  startsOn: string,
  /** Total semanal decidido pela estratégia; sem ele vale o teto calculado em código. */
  weeklySessions?: number,
): PlanCheckContext {
  const schedule = scheduleContextOf(view, hybridParameters, runningParameters);
  return {
    ...schedule,
    maxSessionsPerWeek: Math.max(
      1,
      weeklySessions ?? sessionLimitsOf(view, schedule.rules).maxSessions,
    ),
    focus,
    recentWeeklyLoad: recentWeeklyLoad(view),
    startsOn,
  };
}

/** O nome exibido do exercício vem SEMPRE do catálogo, não do que o modelo (ou a edição) escreveu. */
export function withCatalogNames(
  sessions: readonly PlanSession[],
  catalog: readonly Pick<CatalogExercise, 'id' | 'name'>[],
): PlanSession[] {
  const byId = new Map(catalog.map((e) => [e.id, e.name]));
  return sessions.map((session) =>
    session.content.modality === 'STRENGTH'
      ? {
          ...session,
          content: {
            ...session.content,
            exercises: session.content.exercises.map((e) => ({
              ...e,
              name: byId.get(e.exerciseId) ?? e.name,
            })),
          },
        }
      : session,
  );
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
    foodBudgetMonthlyBrl: life?.foodBudgetMonthlyBrl ?? null,
    mealsOutsideHomePerWeek: life?.mealsOutsideHomePerWeek ?? 0,
    // Os alimentos permitidos vêm da base (`FoodCandidatesService`), não do Estado do Aluno.
    foods: [],
    dailyBudgetBrl:
      life?.foodBudgetMonthlyBrl != null
        ? Math.round((life.foodBudgetMonthlyBrl / 30) * 100) / 100
        : null,
  };
}
