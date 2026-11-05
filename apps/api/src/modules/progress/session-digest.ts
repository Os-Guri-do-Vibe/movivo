/**
 * Resumo técnico de um treino concluído: o que foi feito contra o previsto e contra a última
 * vez que o aluno fez o mesmo. É o material que o especialista lê para dar um retorno específico
 * (e não o óbvio). Funções puras: o serviço busca os dados, aqui só se calcula.
 */
import type { EnduranceMetrics, ExecutionSet } from '@movivo/shared';

export interface PlannedExercise {
  exerciseId: string;
  name: string;
  sets: number;
  reps?: { min: number; max: number };
  durationSeconds?: number;
  rir?: number;
  loadStrategy: string;
}

export type SetRow = Pick<
  ExecutionSet,
  'exerciseId' | 'setNumber' | 'reps' | 'loadKg' | 'durationSeconds' | 'rir' | 'completed'
>;

export interface PreviousSets {
  date: string;
  sets: SetRow[];
}

export type ExerciseChange = 'NEW' | 'LOAD_UP' | 'LOAD_DOWN' | 'REPS_UP' | 'REPS_DOWN' | 'SAME';

export interface ExerciseDigest {
  exerciseId: string;
  name: string;
  plannedSets: number;
  plannedReps: string | null;
  plannedRir: number | null;
  doneSets: number;
  repsBySet: number[];
  topLoadKg: number | null;
  avgRir: number | null;
  tonnageKg: number;
  /** Repetições feitas em relação à faixa prescrita (a série de topo). */
  versusRange: 'ABOVE' | 'IN' | 'BELOW' | null;
  /** Queda de repetições da primeira para a última série (fadiga dentro do exercício). */
  repDropOff: number | null;
  previous: { date: string; topLoadKg: number | null; repsAtTop: number | null } | null;
  change: ExerciseChange;
}

export interface StrengthDigest {
  exercises: ExerciseDigest[];
  skippedExercises: string[];
  setsPlanned: number;
  setsDone: number;
  /** Séries concluídas com 2 ou menos repetições em reserva (perto da falha). */
  setsNearFailure: number;
  totalTonnageKg: number;
  previousTonnageKg: number | null;
}

const round = (value: number, places = 1) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};
const working = (sets: SetRow[], exerciseId: string) =>
  sets
    .filter((s) => s.exerciseId === exerciseId && s.setNumber >= 1 && s.completed)
    .sort((a, b) => a.setNumber - b.setNumber);
const tonnage = (sets: SetRow[]) =>
  sets.reduce((total, s) => total + (s.reps ?? 0) * (s.loadKg ?? 0), 0);

/** Série de topo: a de maior carga (e, no empate, a de mais repetições). */
function topSet(sets: SetRow[]): SetRow | null {
  return (
    [...sets].sort(
      (a, b) => (b.loadKg ?? 0) - (a.loadKg ?? 0) || (b.reps ?? 0) - (a.reps ?? 0),
    )[0] ?? null
  );
}

function changeOf(top: SetRow | null, before: SetRow | null): ExerciseChange {
  if (!before) return 'NEW';
  if (!top) return 'SAME';
  const load = (top.loadKg ?? 0) - (before.loadKg ?? 0);
  if (load > 0) return 'LOAD_UP';
  if (load < 0) return 'LOAD_DOWN';
  const reps = (top.reps ?? 0) - (before.reps ?? 0);
  if (reps > 0) return 'REPS_UP';
  if (reps < 0) return 'REPS_DOWN';
  return 'SAME';
}

export function strengthDigest(input: {
  planned: PlannedExercise[];
  sets: SetRow[];
  /** Última vez que cada exercício foi feito antes desta sessão. */
  previous: Map<string, PreviousSets>;
  previousSessionTonnageKg: number | null;
}): StrengthDigest {
  const exercises: ExerciseDigest[] = [];
  const skipped: string[] = [];
  for (const plan of input.planned) {
    const done = working(input.sets, plan.exerciseId);
    if (done.length === 0) {
      skipped.push(plan.name);
      continue;
    }
    const top = topSet(done);
    const before = input.previous.get(plan.exerciseId);
    const beforeTop = before ? topSet(working(before.sets, plan.exerciseId)) : null;
    const rirs = done.map((s) => s.rir).filter((rir): rir is number => rir !== null);
    const reps = done.map((s) => s.reps ?? 0);
    const topReps = top?.reps ?? null;
    const versusRange =
      plan.reps && topReps !== null
        ? topReps > plan.reps.max
          ? 'ABOVE'
          : topReps < plan.reps.min
            ? 'BELOW'
            : 'IN'
        : null;
    exercises.push({
      exerciseId: plan.exerciseId,
      name: plan.name,
      plannedSets: plan.sets,
      plannedReps: plan.reps
        ? `${plan.reps.min}-${plan.reps.max}`
        : plan.durationSeconds
          ? `${plan.durationSeconds}s`
          : null,
      plannedRir: plan.rir ?? null,
      doneSets: done.length,
      repsBySet: reps,
      topLoadKg: top?.loadKg ?? null,
      avgRir: rirs.length > 0 ? round(rirs.reduce((a, b) => a + b, 0) / rirs.length) : null,
      tonnageKg: Math.round(tonnage(done)),
      versusRange,
      repDropOff: reps.length >= 2 ? (reps[0] ?? 0) - (reps[reps.length - 1] ?? 0) : null,
      previous: beforeTop
        ? { date: before?.date ?? '', topLoadKg: beforeTop.loadKg, repsAtTop: beforeTop.reps }
        : null,
      change: changeOf(top, beforeTop),
    });
  }
  const all = input.planned.flatMap((p) => working(input.sets, p.exerciseId));
  return {
    exercises,
    skippedExercises: skipped,
    setsPlanned: input.planned.reduce((total, p) => total + p.sets, 0),
    setsDone: all.length,
    setsNearFailure: all.filter((s) => s.rir !== null && s.rir <= 2).length,
    totalTonnageKg: Math.round(tonnage(all)),
    previousTonnageKg: input.previousSessionTonnageKg,
  };
}

// --- Endurance -----------------------------------------------------------------------------

export interface EnduranceDigest {
  distanceKm: number | null;
  durationMinutes: number | null;
  avgPaceSecondsPerKm: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  elevationGainMeters: number | null;
  /** Variação do ritmo da segunda metade sobre a primeira (positivo = ficou mais lento). */
  paceDriftPercent: number | null;
  /** Variação da FC média da segunda metade sobre a primeira (positivo = subiu). */
  heartRateDriftPercent: number | null;
  stations: Array<{ station: string; durationSeconds: number }>;
  previous: {
    date: string;
    distanceKm: number | null;
    avgPaceSecondsPerKm: number | null;
    avgHeartRate: number | null;
  } | null;
  /** Ritmo atual contra o da última sessão parecida (negativo = mais rápido). */
  paceChangePercent: number | null;
}

const paceOf = (lap: { distanceMeters: number; durationSeconds: number }) =>
  lap.distanceMeters > 0 ? (lap.durationSeconds / lap.distanceMeters) * 1000 : null;

function halves<T>(items: T[]): [T[], T[]] {
  const mid = Math.floor(items.length / 2);
  return [items.slice(0, mid), items.slice(items.length - mid)];
}

const meanOf = (values: Array<number | null>): number | null => {
  const valid = values.filter((v): v is number => v !== null);
  return valid.length === 0 ? null : valid.reduce((a, b) => a + b, 0) / valid.length;
};

export function enduranceDigest(input: {
  metrics: EnduranceMetrics;
  durationMinutes: number | null;
  previous: { date: string; metrics: EnduranceMetrics } | null;
}): EnduranceDigest {
  const { metrics, previous } = input;
  const laps = metrics.laps ?? [];
  let paceDrift: number | null = null;
  let heartDrift: number | null = null;
  if (laps.length >= 4) {
    const [first, second] = halves(laps);
    const p1 = meanOf(first.map(paceOf));
    const p2 = meanOf(second.map(paceOf));
    if (p1 && p2) paceDrift = round(((p2 - p1) / p1) * 100);
    const h1 = meanOf(first.map((l) => l.avgHeartRate ?? null));
    const h2 = meanOf(second.map((l) => l.avgHeartRate ?? null));
    if (h1 && h2) heartDrift = round(((h2 - h1) / h1) * 100);
  }
  const pace = metrics.avgPaceSecondsPerKm ?? null;
  const beforePace = previous?.metrics.avgPaceSecondsPerKm ?? null;
  return {
    distanceKm: metrics.distanceMeters ? round(metrics.distanceMeters / 1000, 2) : null,
    durationMinutes: input.durationMinutes,
    avgPaceSecondsPerKm: pace,
    avgHeartRate: metrics.avgHeartRate ?? null,
    maxHeartRate: metrics.maxHeartRate ?? null,
    elevationGainMeters: metrics.elevationGainMeters ?? null,
    paceDriftPercent: paceDrift,
    heartRateDriftPercent: heartDrift,
    stations: (metrics.stations ?? []).map((s) => ({
      station: s.station,
      durationSeconds: Math.round(s.durationSeconds),
    })),
    previous: previous
      ? {
          date: previous.date,
          distanceKm: previous.metrics.distanceMeters
            ? round(previous.metrics.distanceMeters / 1000, 2)
            : null,
          avgPaceSecondsPerKm: beforePace,
          avgHeartRate: previous.metrics.avgHeartRate ?? null,
        }
      : null,
    paceChangePercent: pace && beforePace ? round(((pace - beforePace) / beforePace) * 100) : null,
  };
}
