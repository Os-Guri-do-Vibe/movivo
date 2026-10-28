/**
 * Leitura tipada dos parâmetros publicados da metodologia.
 *
 * O documento publicado é um JSON genérico (`seção → campo → valor`; tabelas viram
 * `linha → coluna → valor`). Aqui ele vira regras com tipo para os validadores e os cálculos.
 * Campo ausente vira `null`: o validador correspondente deixa de checar aquela regra (a
 * publicação exige o documento completo, então em produção nada fica ausente).
 */
import type { ExperienceLevel, MethodologyParameters } from '@movivo/shared';

export interface Range {
  min: number;
  max: number;
}

export type RulesLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

export function rulesLevel(level: ExperienceLevel | undefined): RulesLevel {
  if (level === 'ADVANCED' || level === 'INTERMEDIATE') return level;
  return 'BEGINNER';
}

type Params = MethodologyParameters | undefined;

function field(params: Params, section: string, name: string): unknown {
  return params?.[section]?.[name];
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asRange(value: unknown): Range | null {
  if (typeof value !== 'object' || value === null) return null;
  const { min, max } = value as Record<string, unknown>;
  const lo = asNumber(min);
  const hi = asNumber(max);
  return lo !== null && hi !== null ? { min: lo, max: hi } : null;
}

function cell(params: Params, section: string, name: string, row: string, column: string) {
  const table = field(params, section, name) as Record<string, Record<string, unknown>> | undefined;
  return table?.[row]?.[column];
}

function rowsAsRanges(params: Params, section: string, name: string, column: string) {
  const table = field(params, section, name) as Record<string, Record<string, unknown>> | undefined;
  const out: Record<string, Range> = {};
  for (const [row, columns] of Object.entries(table ?? {})) {
    const range = asRange(columns?.[column]);
    if (range) out[row] = range;
  }
  return out;
}

// --- Força --------------------------------------------------------------------------------

export interface StrengthRules {
  weeklySetsPerMuscle: Range | null;
  maxSetsPerMusclePerSession: number | null;
  minFrequencyPerMuscle: number | null;
  maxExercisesPerSession: number | null;
  deloadEveryWeeks: number | null;
  mesocycleWeeks: Range | null;
  rirByPhase: Record<string, Range>;
  repsByGoal: Record<string, Range>;
  restByKind: Record<string, Range>;
  allowedSplits: {
    fullBody: boolean;
    upperLower: boolean;
    pushPullLegs: boolean;
    bodyPart: boolean;
  };
}

export function strengthRules(params: Params, level: RulesLevel): StrengthRules {
  const splits = (
    field(params, 'structure', 'allowedSplits') as
      Record<string, Record<string, unknown>> | undefined
  )?.[level];
  return {
    weeklySetsPerMuscle: asRange(cell(params, 'volume', 'weeklySets', level, 'sets')),
    maxSetsPerMusclePerSession: asNumber(field(params, 'volume', 'maxSetsPerMusclePerSession')),
    minFrequencyPerMuscle: asNumber(field(params, 'volume', 'minFrequencyPerMuscle')),
    maxExercisesPerSession: asNumber(field(params, 'structure', 'maxExercisesPerSession')),
    deloadEveryWeeks: asNumber(cell(params, 'periodization', 'deloadEveryWeeks', level, 'weeks')),
    mesocycleWeeks: asRange(field(params, 'periodization', 'mesocycleWeeks')),
    rirByPhase: rowsAsRanges(params, 'intensity', 'rirByPhase', 'rir'),
    repsByGoal: rowsAsRanges(params, 'intensity', 'repsByGoal', 'reps'),
    restByKind: rowsAsRanges(params, 'intensity', 'restSeconds', 'seconds'),
    allowedSplits: {
      fullBody: splits?.fullBody !== false,
      upperLower: splits?.upperLower !== false,
      pushPullLegs: splits?.pushPullLegs === true,
      bodyPart: splits?.bodyPart === true,
    },
  };
}

// --- Corrida ------------------------------------------------------------------------------

export interface RunningRules {
  easySharePct: number | null;
  qualitySessionsPerWeekMax: number | null;
  minEasyDaysBetweenQuality: number | null;
  weeklyIncreaseMaxPct: number | null;
  longRunMaxSharePct: number | null;
  longRunMaxMinutes: number | null;
  zoneBoundsPctHrMax: Record<string, Range>;
}

export function runningRules(params: Params, level: RulesLevel): RunningRules {
  return {
    easySharePct: asNumber(cell(params, 'distribution', 'easySharePct', level, 'pct')),
    qualitySessionsPerWeekMax: asNumber(
      cell(params, 'distribution', 'qualitySessionsPerWeek', level, 'max'),
    ),
    minEasyDaysBetweenQuality: asNumber(field(params, 'distribution', 'minEasyDaysBetweenQuality')),
    weeklyIncreaseMaxPct: asNumber(field(params, 'progression', 'weeklyIncreaseMaxPct')),
    longRunMaxSharePct: asNumber(field(params, 'progression', 'longRunMaxSharePct')),
    longRunMaxMinutes: asNumber(cell(params, 'progression', 'longRunMaxMinutes', level, 'minutes')),
    zoneBoundsPctHrMax: rowsAsRanges(params, 'zones', 'zoneBoundsPctHrMax', 'pct'),
  };
}

// --- HYROX --------------------------------------------------------------------------------

export interface HyroxRules {
  simulationEveryWeeks: number | null;
  compromisedRunningPerWeek: number | null;
  taperWeeks: number | null;
  /** Carga de prova (kg) por estação para a categoria; 0 = estação sem carga. */
  raceLoadKg: Record<string, number>;
}

export function hyroxRules(
  params: Params,
  category: 'openMale' | 'openFemale' | 'proMale' | 'proFemale' = 'openMale',
): HyroxRules {
  const loads = field(params, 'loads', 'stationLoadsKg') as
    Record<string, Record<string, unknown>> | undefined;
  const raceLoadKg: Record<string, number> = {};
  for (const [station, columns] of Object.entries(loads ?? {})) {
    const kg = asNumber(columns?.[category]);
    if (kg !== null) raceLoadKg[station] = kg;
  }
  return {
    simulationEveryWeeks: asNumber(field(params, 'phases', 'simulationEveryWeeks')),
    compromisedRunningPerWeek: asNumber(field(params, 'phases', 'compromisedRunningPerWeek')),
    taperWeeks: asNumber(field(params, 'phases', 'taperWeeks')),
    raceLoadKg,
  };
}

// --- Híbrido ------------------------------------------------------------------------------

export interface HybridRules {
  hoursBetweenHeavyLowerAndIntenseRun: number | null;
  maxIntenseSessionsPerWeek: number | null;
  allowTwoSessionsSameDay: boolean;
  minRestDaysPerWeek: number | null;
  acuteChronicMax: number | null;
  weeklyLoadIncreaseMaxPct: number | null;
}

export function hybridRules(params: Params): HybridRules {
  return {
    hoursBetweenHeavyLowerAndIntenseRun: asNumber(
      field(params, 'interference', 'hoursBetweenHeavyLowerAndIntenseRun'),
    ),
    maxIntenseSessionsPerWeek: asNumber(field(params, 'interference', 'maxIntenseSessionsPerWeek')),
    allowTwoSessionsSameDay: field(params, 'interference', 'allowTwoSessionsSameDay') === true,
    minRestDaysPerWeek: asNumber(field(params, 'interference', 'minRestDaysPerWeek')),
    acuteChronicMax: asNumber(field(params, 'load', 'acuteChronicMax')),
    weeklyLoadIncreaseMaxPct: asNumber(field(params, 'load', 'weeklyLoadIncreaseMaxPct')),
  };
}

// --- Nutrição -----------------------------------------------------------------------------

export type ProteinGoalKey = 'HYPERTROPHY' | 'FAT_LOSS' | 'RECOMPOSITION' | 'ENDURANCE' | 'HEALTH';

export interface NutritionRules {
  proteinGPerKg: Record<string, Range>;
  proteinPerMealMinG: number | null;
  estimationMethod: 'MIFFLIN_ST_JEOR' | 'KATCH_MCARDLE';
  deficitPct: Range | null;
  surplusPct: Range | null;
  recompositionPct: Range | null;
  maxWeeklyWeightLossPct: number | null;
  energyFloorKcal: { FEMALE: number | null; MALE: number | null };
  bodyFatThresholdPct: { FEMALE: number | null; MALE: number | null };
  waistToHeightThreshold: number | null;
  fatMinGPerKg: number | null;
  fiberGPer1000Kcal: number | null;
  waterMlPerKg: number | null;
  allowedSupplements: string[];
}

export function nutritionRules(params: Params): NutritionRules {
  const supplements = field(params, 'supplements', 'allowed');
  return {
    proteinGPerKg: rowsAsRanges(params, 'protein', 'gPerKgByGoal', 'gPerKg'),
    proteinPerMealMinG: asNumber(field(params, 'protein', 'perMealMinG')),
    estimationMethod:
      field(params, 'energy', 'estimationMethod') === 'KATCH_MCARDLE'
        ? 'KATCH_MCARDLE'
        : 'MIFFLIN_ST_JEOR',
    deficitPct: asRange(field(params, 'energy', 'deficitPct')),
    surplusPct: asRange(field(params, 'energy', 'surplusPct')),
    recompositionPct: asRange(field(params, 'energy', 'recompositionDeficitPct')),
    maxWeeklyWeightLossPct: asNumber(field(params, 'energy', 'maxWeeklyWeightLossPct')),
    energyFloorKcal: {
      FEMALE: asNumber(cell(params, 'energy', 'energyFloorKcal', 'FEMALE', 'kcal')),
      MALE: asNumber(cell(params, 'energy', 'energyFloorKcal', 'MALE', 'kcal')),
    },
    bodyFatThresholdPct: {
      FEMALE: asNumber(cell(params, 'recomposition', 'bodyFatThresholdPct', 'FEMALE', 'pct')),
      MALE: asNumber(cell(params, 'recomposition', 'bodyFatThresholdPct', 'MALE', 'pct')),
    },
    waistToHeightThreshold: asNumber(field(params, 'recomposition', 'waistToHeightThreshold')),
    fatMinGPerKg: asNumber(field(params, 'micro', 'fatMinGPerKg')),
    fiberGPer1000Kcal: asNumber(field(params, 'micro', 'fiberGPer1000Kcal')),
    waterMlPerKg: asNumber(field(params, 'micro', 'waterMlPerKg')),
    allowedSupplements: Array.isArray(supplements)
      ? supplements.filter((s): s is string => typeof s === 'string')
      : [],
  };
}
