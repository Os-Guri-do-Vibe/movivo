/**
 * A evolução que o aluno vê: o pulso (dias ativos seguidos, sem quebrar no descanso),
 * consistência, progressão nos treinos de cada modalidade, recordes e previsões de prova. Funções puras:
 * a API busca os registros e entrega aqui (a demonstração local usa as mesmas).
 */
import { HYROX_STATION_LABELS, type HyroxStation } from '../training/endurance.schema';
import type { EnduranceMetrics } from '../training/execution.schema';
import type {
  HyroxPrediction,
  PersonalRecord,
  PredictionConfidence,
  RacePrediction,
  StreakDayState,
  StudentPredictions,
  StudentProgress,
} from './student-progress.schema';

/** Datas ISO (AAAA-MM-DD) ao meio-dia UTC: sem efeito de fuso nem de horário de verão. */
function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Segunda-feira da semana da data. */
function mondayOf(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
}

const FINISHED = new Set(['COMPLETED', 'PARTIAL']);
/** Agenda que saiu da semana (remarcada ou retirada pelo treinador) não conta como falta. */
const OFF_SCHEDULE = new Set(['SKIPPED', 'MOVED']);
const STREAK_WEEKS = 4;
const TOP_EXERCISES = 4;
const MAX_POINTS = 24;
const RUN_WEEKS = 8;
/** Ritmo de corrida curta demais não vira recorde. */
const MIN_RECORD_RUN_KM = 3;

export interface ProgressInput {
  today: string;
  scheduled: ReadonlyArray<{ date: string; status: string }>;
  executions: ReadonlyArray<{
    id: string;
    date: string;
    status: string;
    modality: string;
    durationMinutes: number | null;
    /** Só números confirmados pelo aluno. */
    metrics: EnduranceMetrics | null;
  }>;
  /** Séries válidas e feitas (aquecimento fora). */
  sets: ReadonlyArray<{
    executionId: string;
    date: string;
    exerciseId: string;
    reps: number | null;
    loadKg: number | null;
  }>;
  exerciseNames: ReadonlyMap<string, string>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const kgText = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg`;
const kmText = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km`;
const clock = (seconds: number) => {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

/** 1RM estimado (Epley). Só vale de 1 a 12 repetições: além disso a estimativa perde sentido. */
export function estimatedOneRepMax(loadKg: number | null, reps: number | null): number | null {
  if (!loadKg || !reps || reps < 1 || reps > 12) return null;
  return round1(reps === 1 ? loadKg : loadKg * (1 + reps / 30));
}

/**
 * Estado de cada dia, do primeiro registro até hoje. Treino feito soma; descanso (dia sem treino
 * previsto) não soma nem quebra; treino previsto e não feito quebra; hoje ainda em aberto não quebra.
 */
export function dayStates(
  input: Pick<ProgressInput, 'today' | 'scheduled' | 'executions'>,
  from: string,
) {
  const states = new Map<string, StreakDayState>();
  for (let date = from; date <= input.today; date = addDays(date, 1)) {
    const done = input.executions.some((e) => e.date === date && FINISHED.has(e.status));
    const planned = input.scheduled.some((s) => s.date === date && !OFF_SCHEDULE.has(s.status));
    const gaveUp = input.executions.some((e) => e.date === date && e.status === 'ABANDONED');
    states.set(
      date,
      done
        ? 'DONE'
        : date === input.today && planned && !gaveUp
          ? 'PENDING'
          : planned || gaveUp
            ? 'MISSED'
            : 'REST',
    );
  }
  return states;
}

export function streakOf(
  input: Pick<ProgressInput, 'today' | 'scheduled' | 'executions'>,
): StudentProgress['streak'] {
  const dates = [...input.scheduled.map((s) => s.date), ...input.executions.map((e) => e.date)];
  const windowStart = addDays(mondayOf(input.today), -7 * (STREAK_WEEKS - 1));
  const first = dates.filter((d) => d <= input.today).sort()[0] ?? windowStart;
  const from = first < windowStart ? first : windowStart;
  const states = dayStates(input, from);
  let current = 0;
  let best = 0;
  for (const state of states.values()) {
    if (state === 'DONE') {
      current += 1;
      best = Math.max(best, current);
    } else if (state === 'MISSED') {
      current = 0;
    }
  }
  const days = Array.from({ length: STREAK_WEEKS * 7 }, (_, i) => {
    const date = addDays(windowStart, i);
    return { date, state: date > input.today ? 'FUTURE' : (states.get(date) ?? 'REST') } as const;
  });
  return { current, best, activeToday: states.get(input.today) === 'DONE', days };
}

export function consistencyOf(
  input: Pick<ProgressInput, 'today' | 'scheduled' | 'executions'>,
): StudentProgress['consistency'] {
  const from = addDays(input.today, -27);
  const inWindow = (date: string) => date >= from && date <= input.today;
  // Hoje ainda em aberto não entra na conta (não é falta).
  const planned = input.scheduled.filter(
    (s) =>
      inWindow(s.date) &&
      !OFF_SCHEDULE.has(s.status) &&
      !(s.date === input.today && s.status === 'PLANNED'),
  );
  const doneScheduled = planned.filter((s) => s.status === 'DONE' || s.status === 'PARTIAL');
  const finished = input.executions.filter((e) => inWindow(e.date) && FINISHED.has(e.status));
  return {
    adherencePct:
      planned.length > 0 ? Math.round((doneScheduled.length / planned.length) * 100) : null,
    sessions28d: finished.length,
    minutes28d: finished.reduce((total, e) => total + (e.durationMinutes ?? 0), 0),
  };
}

export function strengthOf(input: ProgressInput): StudentProgress['strength'] {
  const perExercise = new Map<string, Map<string, ProgressInput['sets'][number][]>>();
  for (const row of input.sets) {
    const sessions = perExercise.get(row.exerciseId) ?? new Map();
    sessions.set(row.executionId, [...(sessions.get(row.executionId) ?? []), row]);
    perExercise.set(row.exerciseId, sessions);
  }
  return [...perExercise]
    .filter(([, sessions]) => [...sessions.values()].some((rows) => rows.some((r) => r.loadKg)))
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, TOP_EXERCISES)
    .map(([exerciseId, sessions]) => ({
      exerciseId,
      name: input.exerciseNames.get(exerciseId) ?? exerciseId.replaceAll('_', ' '),
      sessions: sessions.size,
      points: [...sessions.values()]
        .sort((a, b) => (a[0]?.date ?? '').localeCompare(b[0]?.date ?? ''))
        .slice(-MAX_POINTS)
        .map((rows) => {
          const top = [...rows].sort(
            (a, b) => (b.loadKg ?? 0) - (a.loadKg ?? 0) || (b.reps ?? 0) - (a.reps ?? 0),
          )[0];
          const best = Math.max(0, ...rows.map((r) => estimatedOneRepMax(r.loadKg, r.reps) ?? 0));
          return {
            date: rows[0]?.date ?? input.today,
            topLoadKg: top?.loadKg ?? null,
            reps: top?.reps ?? null,
            e1rmKg: best > 0 ? best : null,
          };
        }),
    }));
}

const paceOf = (m: EnduranceMetrics): number | null => {
  if (m.avgPaceSecondsPerKm) return m.avgPaceSecondsPerKm;
  const seconds = m.movingSeconds ?? m.elapsedSeconds;
  return seconds && m.distanceMeters ? Math.round(seconds / (m.distanceMeters / 1000)) : null;
};

export function runningOf(input: ProgressInput): StudentProgress['running'] {
  const runs = input.executions
    .filter((e) => e.modality === 'RUNNING' && FINISHED.has(e.status) && e.metrics?.distanceMeters)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (runs.length === 0) return null;
  const points = runs.map((e) => {
    const metrics = e.metrics as EnduranceMetrics;
    return {
      date: e.date,
      distanceKm: round2((metrics.distanceMeters ?? 0) / 1000),
      paceSecondsPerKm: paceOf(metrics),
      avgHeartRate: metrics.avgHeartRate ?? null,
    };
  });
  const firstWeek = addDays(mondayOf(input.today), -7 * (RUN_WEEKS - 1));
  const paces = points
    .filter((p) => p.distanceKm >= MIN_RECORD_RUN_KM && p.paceSecondsPerKm)
    .map((p) => p.paceSecondsPerKm as number);
  return {
    runs: points.length,
    totalKm: round1(points.reduce((total, p) => total + p.distanceKm, 0)),
    longestKm: Math.max(...points.map((p) => p.distanceKm)),
    bestPaceSecondsPerKm: paces.length > 0 ? Math.min(...paces) : null,
    points: points.slice(-MAX_POINTS),
    weeks: Array.from({ length: RUN_WEEKS }, (_, i) => {
      const weekStart = addDays(firstWeek, i * 7);
      const end = addDays(weekStart, 6);
      return {
        weekStart,
        km: round1(
          points
            .filter((p) => p.date >= weekStart && p.date <= end)
            .reduce((total, p) => total + p.distanceKm, 0),
        ),
      };
    }),
  };
}

export function hyroxOf(input: ProgressInput): StudentProgress['hyrox'] {
  const sessions = input.executions
    .filter((e) => e.modality === 'HYROX' && FINISHED.has(e.status))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (sessions.length === 0) return null;
  const byStation = new Map<HyroxStation, number[]>();
  for (const e of sessions) {
    for (const s of e.metrics?.stations ?? []) {
      byStation.set(s.station, [
        ...(byStation.get(s.station) ?? []),
        Math.round(s.durationSeconds),
      ]);
    }
  }
  return {
    sessions: sessions.length,
    points: sessions.slice(-MAX_POINTS).map((e) => ({
      date: e.date,
      totalSeconds:
        e.metrics?.movingSeconds ??
        e.metrics?.elapsedSeconds ??
        (e.durationMinutes !== null ? e.durationMinutes * 60 : null),
    })),
    stations: [...byStation].map(([station, times]) => ({
      station,
      firstSeconds: times[0] ?? 0,
      bestSeconds: Math.min(...times),
      lastSeconds: times[times.length - 1] ?? 0,
    })),
  };
}

/** Os recordes pessoais que valem comemorar (no máximo 6). */
export function recordsOf(
  progress: Omit<StudentProgress, 'records' | 'predictions'>,
): PersonalRecord[] {
  const records: PersonalRecord[] = [];
  // Dois exercícios no máximo, para corrida e HYROX também aparecerem.
  for (const exercise of progress.strength.slice(0, 2)) {
    const top = [...exercise.points]
      .filter((p) => p.topLoadKg)
      .sort((a, b) => (b.topLoadKg ?? 0) - (a.topLoadKg ?? 0) || a.date.localeCompare(b.date))[0];
    if (top?.topLoadKg) {
      records.push({
        label: `Maior carga · ${exercise.name}`,
        value: `${kgText(top.topLoadKg)}${top.reps ? ` × ${top.reps}` : ''}`,
        date: top.date,
      });
    }
  }
  if (progress.running) {
    const longest = [...progress.running.points].sort(
      (a, b) => b.distanceKm - a.distanceKm || a.date.localeCompare(b.date),
    )[0];
    if (longest) {
      records.push({
        label: 'Maior distância',
        value: kmText(longest.distanceKm),
        date: longest.date,
      });
    }
    const fastest = progress.running.points
      .filter((p) => p.distanceKm >= MIN_RECORD_RUN_KM && p.paceSecondsPerKm)
      .sort((a, b) => (a.paceSecondsPerKm ?? 0) - (b.paceSecondsPerKm ?? 0))[0];
    if (fastest?.paceSecondsPerKm) {
      records.push({
        label: 'Melhor ritmo médio',
        value: `${clock(fastest.paceSecondsPerKm)} /km`,
        date: fastest.date,
      });
    }
  }
  if (progress.hyrox) {
    const fastest = progress.hyrox.points
      .filter((p) => p.totalSeconds)
      .sort((a, b) => (a.totalSeconds ?? 0) - (b.totalSeconds ?? 0))[0];
    if (fastest?.totalSeconds) {
      records.push({
        label: 'HYROX mais rápido',
        value: clock(fastest.totalSeconds),
        date: fastest.date,
      });
    }
    const station = [...progress.hyrox.stations].sort(
      (a, b) => b.firstSeconds - b.bestSeconds - (a.firstSeconds - a.bestSeconds),
    )[0];
    if (station && station.firstSeconds > station.bestSeconds) {
      records.push({
        label: `Melhor ${HYROX_STATION_LABELS[station.station]}`,
        value: clock(station.bestSeconds),
        date: progress.hyrox.points[progress.hyrox.points.length - 1]?.date ?? '',
      });
    }
  }
  return records.slice(0, 6);
}

// --- Previsões de prova ----------------------------------------------------------------------

/** Expoente de Riegel: o ritmo cai um pouco a cada vez que a distância dobra. */
const RIEGEL = 1.06;
const RACES: ReadonlyArray<{ race: RacePrediction['race']; km: number }> = [
  { race: '5K', km: 5 },
  { race: '10K', km: 10 },
  { race: 'HALF', km: 21.0975 },
  { race: 'MARATHON', km: 42.195 },
];
/** Corrida curta demais não serve de base para estimar prova. */
const MIN_BASE_KM = 3;

/** Tempo previsto para outra distância (fórmula de Riegel). */
export function riegel(seconds: number, fromKm: number, toKm: number): number {
  return seconds * (toKm / fromKm) ** RIEGEL;
}

/**
 * Confiança pela distância mais longa já corrida: perto da prova (≥ 50%) é boa; até 25% é média;
 * abaixo disso (ex.: maratona com treinos de 8 km) a estimativa é só um norte.
 */
function confidenceOf(longestKm: number, targetKm: number): PredictionConfidence {
  const ratio = longestKm / targetKm;
  return ratio >= 0.5 ? 'HIGH' : ratio >= 0.25 ? 'MEDIUM' : 'LOW';
}

/**
 * Referência de tempo por estação numa prova HYROX Open (distâncias e cargas oficiais), usada
 * quando o aluno ainda não tem a estação medida nos treinos.
 */
export const HYROX_STATION_REFERENCE_SECONDS: Readonly<Record<HyroxStation, number>> = {
  SKIERG: 285,
  SLED_PUSH: 210,
  SLED_PULL: 270,
  BURPEE_BROAD_JUMP: 300,
  ROWING: 285,
  FARMERS_CARRY: 120,
  SANDBAG_LUNGES: 300,
  WALL_BALLS: 390,
};
/** O km de corrida entre estações sai mais lento que o ritmo de 10 km (pernas já cansadas). */
const HYROX_RUN_FATIGUE = 1.12;
/** Trocas entre corrida e estação: cerca de 45 s em cada uma das 8. */
const HYROX_ROXZONE_SECONDS = 8 * 45;

export function predictionsOf(
  running: StudentProgress['running'],
  hyrox: StudentProgress['hyrox'],
): StudentPredictions {
  // Base: o treino de 3 km para cima com o melhor desempenho equivalente em 10 km.
  const candidates = (running?.points ?? [])
    .filter((p) => p.distanceKm >= MIN_BASE_KM && p.paceSecondsPerKm)
    .map((p) => {
      const seconds = (p.paceSecondsPerKm as number) * p.distanceKm;
      return {
        date: p.date,
        distanceKm: p.distanceKm,
        seconds,
        tenK: riegel(seconds, p.distanceKm, 10),
      };
    })
    .sort((a, b) => a.tenK - b.tenK);
  const base = candidates[0];
  if (!base || !running) return { basedOn: null, running: [], hyrox: null };

  const races = RACES.map(({ race, km }) => {
    const seconds = Math.round(riegel(base.seconds, base.distanceKm, km));
    return {
      race,
      km,
      seconds,
      paceSecondsPerKm: Math.round(seconds / km),
      confidence: confidenceOf(running.longestKm, km),
    };
  });

  let hyroxPrediction: HyroxPrediction | null = null;
  if (hyrox) {
    const runSeconds = Math.round((base.tenK / 10) * HYROX_RUN_FATIGUE * 8);
    const best = new Map(hyrox.stations.map((s) => [s.station, s.bestSeconds]));
    const stationsSeconds = (Object.keys(HYROX_STATION_REFERENCE_SECONDS) as HyroxStation[]).reduce(
      (total, station) => total + (best.get(station) ?? HYROX_STATION_REFERENCE_SECONDS[station]),
      0,
    );
    const measured = best.size;
    hyroxPrediction = {
      seconds: runSeconds + stationsSeconds + HYROX_ROXZONE_SECONDS,
      runSeconds,
      stationsSeconds,
      roxzoneSeconds: HYROX_ROXZONE_SECONDS,
      measuredStations: measured,
      confidence: measured >= 6 ? 'HIGH' : measured >= 3 ? 'MEDIUM' : 'LOW',
    };
  }

  return {
    basedOn: { date: base.date, distanceKm: base.distanceKm, seconds: Math.round(base.seconds) },
    running: races,
    hyrox: hyroxPrediction,
  };
}

export function studentProgressOf(input: ProgressInput): StudentProgress {
  const base = {
    streak: streakOf(input),
    consistency: consistencyOf(input),
    strength: strengthOf(input),
    running: runningOf(input),
    hyrox: hyroxOf(input),
  };
  return {
    ...base,
    records: recordsOf(base),
    predictions: predictionsOf(base.running, base.hyrox),
  };
}
