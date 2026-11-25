/**
 * Snapshot de sessão: cada treino concluído lado a lado com a disposição do dia e com a última vez
 * que o aluno fez a MESMA sessão. É o dado comparável de sessão a sessão (não só carga e
 * repetições): o treinador enxerga "rendeu menos porque dormiu 4 h" ou "rendeu mais, mesmo
 * cansado" olhando a série, e não uma sessão solta. Funções puras.
 */
import type { EnduranceMetrics } from '@movivo/shared';

import type { DayScales } from '../student-state/observations';

export interface SnapshotSet {
  reps: number | null;
  loadKg: number | null;
  rir: number | null;
  completed: boolean;
  setNumber: number;
}

export interface StrengthPerformance {
  kind: 'STRENGTH';
  setsDone: number;
  setsPlanned: number | null;
  completionRatio: number | null;
  tonnageKg: number;
  avgRir: number | null;
  /** Fração das séries concluídas com 2 ou menos repetições em reserva. */
  nearFailureShare: number | null;
  rpe: number | null;
  durationMinutes: number | null;
}

export interface EndurancePerformance {
  kind: 'ENDURANCE';
  distanceKm: number | null;
  paceSecPerKm: number | null;
  avgHeartRate: number | null;
  rpe: number | null;
  durationMinutes: number | null;
}

export type SessionPerformance = StrengthPerformance | EndurancePerformance;

export interface SnapshotReadiness extends DayScales {
  sleepHours: number | null;
  /** O aluno contou como estava ANTES do treino (chat). */
  reportedBefore: boolean;
  /** O treinador mexeu na sessão por causa disso (ex.: encurtou, recomendou baixar a carga). */
  agentAdjusted: string | null;
}

export interface SnapshotComparison {
  previous: { date: string; executionId: string } | null;
  tonnageDeltaPct: number | null;
  avgRirDelta: number | null;
  paceDeltaPct: number | null;
  rpeDelta: number | null;
  /** Leitura do código: rendimento e disposição contra a última vez (o especialista confirma). */
  pattern:
    | 'FIRST_TIME'
    | 'BETTER_DESPITE_LOW_READINESS'
    | 'WORSE_WITH_LOW_READINESS'
    | 'WORSE_WITH_GOOD_READINESS'
    | 'BETTER_WITH_GOOD_READINESS'
    | 'SIMILAR';
}

const round = (value: number, places = 1) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};
const pct = (now: number, before: number) =>
  before > 0 ? round(((now - before) / before) * 100) : null;

/** Chave estável de "a mesma sessão": título normalizado (a sessão A de força continua a A). */
export function sessionKeyOf(title: string | null, modality: string): string {
  const base = (title ?? modality)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${modality.toLowerCase()}:${base}`.slice(0, 80);
}

export function strengthPerformance(input: {
  sets: readonly SnapshotSet[];
  setsPlanned: number | null;
  rpe: number | null;
  durationMinutes: number | null;
}): StrengthPerformance {
  const done = input.sets.filter((s) => s.completed && s.setNumber >= 1);
  const rirs = done.map((s) => s.rir).filter((r): r is number => r !== null);
  const tonnage = done.reduce((t, s) => t + (s.reps ?? 0) * (s.loadKg ?? 0), 0);
  return {
    kind: 'STRENGTH',
    setsDone: done.length,
    setsPlanned: input.setsPlanned,
    completionRatio:
      input.setsPlanned && input.setsPlanned > 0 ? round(done.length / input.setsPlanned, 2) : null,
    tonnageKg: Math.round(tonnage),
    avgRir: rirs.length > 0 ? round(rirs.reduce((a, b) => a + b, 0) / rirs.length) : null,
    nearFailureShare:
      rirs.length > 0 ? round(rirs.filter((r) => r <= 2).length / rirs.length, 2) : null,
    rpe: input.rpe,
    durationMinutes: input.durationMinutes,
  };
}

export function endurancePerformance(input: {
  metrics: EnduranceMetrics;
  rpe: number | null;
  durationMinutes: number | null;
}): EndurancePerformance {
  const { metrics } = input;
  return {
    kind: 'ENDURANCE',
    distanceKm:
      metrics.distanceMeters !== undefined ? round(metrics.distanceMeters / 1000, 2) : null,
    paceSecPerKm: metrics.avgPaceSecondsPerKm ?? null,
    avgHeartRate: metrics.avgHeartRate ?? null,
    rpe: input.rpe,
    durationMinutes: input.durationMinutes,
  };
}

/** Disposição baixa: sono, energia ou corpo em 2 ou menos, ou estresse em 4 ou mais. */
export function lowReadiness(r: DayScales): boolean {
  return (
    (r.sleep !== null && r.sleep <= 2) ||
    (r.energy !== null && r.energy <= 2) ||
    (r.soreness !== null && r.soreness <= 2) ||
    (r.stress !== null && r.stress >= 4)
  );
}

export function compareSessions(input: {
  now: SessionPerformance;
  readiness: DayScales;
  previous: {
    date: string;
    executionId: string;
    performance: SessionPerformance;
  } | null;
}): SnapshotComparison {
  const { now, previous } = input;
  if (!previous || previous.performance.kind !== now.kind) {
    return {
      previous: previous ? { date: previous.date, executionId: previous.executionId } : null,
      tonnageDeltaPct: null,
      avgRirDelta: null,
      paceDeltaPct: null,
      rpeDelta: null,
      pattern: 'FIRST_TIME',
    };
  }
  let tonnageDeltaPct: number | null = null;
  let avgRirDelta: number | null = null;
  let paceDeltaPct: number | null = null;
  if (now.kind === 'STRENGTH' && previous.performance.kind === 'STRENGTH') {
    tonnageDeltaPct = pct(now.tonnageKg, previous.performance.tonnageKg);
    avgRirDelta =
      now.avgRir !== null && previous.performance.avgRir !== null
        ? round(now.avgRir - previous.performance.avgRir)
        : null;
  }
  if (now.kind === 'ENDURANCE' && previous.performance.kind === 'ENDURANCE') {
    // Pace menor é melhor: o delta positivo significa mais rápido.
    paceDeltaPct =
      now.paceSecPerKm !== null && previous.performance.paceSecPerKm !== null
        ? pct(previous.performance.paceSecPerKm, now.paceSecPerKm)
        : null;
  }
  const rpeDelta =
    now.rpe !== null && previous.performance.rpe !== null
      ? round(now.rpe - previous.performance.rpe)
      : null;
  const output = tonnageDeltaPct ?? paceDeltaPct;
  const low = lowReadiness(input.readiness);
  const pattern: SnapshotComparison['pattern'] =
    output === null
      ? 'SIMILAR'
      : output >= 3
        ? low
          ? 'BETTER_DESPITE_LOW_READINESS'
          : 'BETTER_WITH_GOOD_READINESS'
        : output <= -3
          ? low
            ? 'WORSE_WITH_LOW_READINESS'
            : 'WORSE_WITH_GOOD_READINESS'
          : 'SIMILAR';
  return {
    previous: { date: previous.date, executionId: previous.executionId },
    tonnageDeltaPct,
    avgRirDelta,
    paceDeltaPct,
    rpeDelta,
    pattern,
  };
}
