/**
 * O estudo do dia: todos os sinais do aluno em um único registro, comparável dia a dia. É o que
 * os especialistas leem para ver o aluno inteiro (sono, estresse, treino, comida, peso, contato)
 * e não só o último check-in. Funções puras: o serviço busca os dados.
 */
import type { DayScales, ObservationView } from '../student-state/observations';

export interface DayDigest {
  date: string;
  /** Escalas do dia: check-in + relatos do chat (vale o pior quando os dois falam da mesma coisa). */
  scales: DayScales;
  nutritionCheck: 'ON_TRACK' | 'PARTIAL' | 'OFF' | null;
  sleepHours: number | null;
  /** O que o aluno contou no chat, sem texto livre. */
  reports: Array<{
    kind: string;
    score: number | null;
    value: number | null;
    phase: string;
  }>;
  training: {
    planned: number;
    done: number;
    partial: number;
    missed: number;
    minutes: number;
    rpeAvg: number | null;
  };
  nutrition: {
    loggedMeals: number;
    energyKcal: number | null;
    proteinG: number | null;
    waterMl: number | null;
  };
  weightKg: number | null;
  contact: { studentMessages: number | null; agentOutreach: number };
  /** Marcas de atenção calculadas pelo código (os especialistas leem, não recalculam). */
  flags: string[];
  /** O que os agentes fizeram com este dia (ajuste de sessão, conversa, alerta). */
  agentActions: Array<{ by: string; type: string; detail: string }>;
}

export interface DayDigestInput {
  date: string;
  scales: DayScales;
  nutritionCheck: DayDigest['nutritionCheck'];
  observations: readonly ObservationView[];
  sessions: ReadonlyArray<{ status: string; minutes: number | null }>;
  executions: ReadonlyArray<{ status: string; rpe: number | null }>;
  meals: ReadonlyArray<{ energyKcal: number; proteinG: number }>;
  waterMl: number | null;
  weightKg: number | null;
  studentMessages: number | null;
  agentOutreach: number;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function buildDayDigest(input: DayDigestInput): Omit<DayDigest, 'agentActions'> {
  const finished = input.executions.filter(
    (e) => e.status === 'COMPLETED' || e.status === 'PARTIAL',
  );
  const rpes = finished.map((e) => e.rpe).filter((r): r is number => r !== null);
  const hours = input.observations.find((o) => o.kind === 'SLEEP' && o.valueNum !== null);
  const training = {
    planned: input.sessions.filter((s) => s.status !== 'SKIPPED' && s.status !== 'MOVED').length,
    done: input.sessions.filter((s) => s.status === 'DONE').length,
    partial: input.sessions.filter((s) => s.status === 'PARTIAL').length,
    missed: input.sessions.filter((s) => s.status === 'MISSED').length,
    minutes: input.sessions.reduce((total, s) => total + (s.minutes ?? 0), 0),
    rpeAvg: rpes.length > 0 ? round1(rpes.reduce((a, b) => a + b, 0) / rpes.length) : null,
  };
  const nutrition = {
    loggedMeals: input.meals.length,
    energyKcal:
      input.meals.length > 0 ? Math.round(sum(input.meals.map((m) => m.energyKcal))) : null,
    proteinG: input.meals.length > 0 ? Math.round(sum(input.meals.map((m) => m.proteinG))) : null,
    waterMl: input.waterMl,
  };
  const flags: string[] = [];
  if (input.scales.sleep !== null && input.scales.sleep <= 2) flags.push('SLEEP_LOW');
  if (input.scales.stress !== null && input.scales.stress >= 4) flags.push('STRESS_HIGH');
  if (input.scales.energy !== null && input.scales.energy <= 2) flags.push('ENERGY_LOW');
  if (input.scales.mood !== null && input.scales.mood <= 2) flags.push('MOOD_LOW');
  if (input.scales.soreness !== null && input.scales.soreness <= 2) flags.push('BODY_SORE');
  for (const kind of ['ILLNESS', 'ALCOHOL', 'TRAVEL'] as const) {
    if (input.observations.some((o) => o.kind === kind)) flags.push(kind);
  }
  if (training.missed > 0) flags.push('SESSION_MISSED');
  if (training.planned > 0 && training.done + training.partial === 0 && training.missed === 0) {
    flags.push('SESSION_PENDING');
  }
  const hasAnySignal =
    Object.values(input.scales).some((v) => v !== null) ||
    input.observations.length > 0 ||
    finished.length > 0 ||
    input.meals.length > 0 ||
    input.waterMl !== null ||
    input.weightKg !== null ||
    (input.studentMessages ?? 0) > 0;
  if (!hasAnySignal) flags.push('NO_SIGNAL');

  return {
    date: input.date,
    scales: input.scales,
    nutritionCheck: input.nutritionCheck,
    sleepHours: hours?.valueNum ?? null,
    reports: input.observations.map((o) => ({
      kind: o.kind,
      score: o.score,
      value: o.valueNum,
      phase: o.phase,
    })),
    training,
    nutrition,
    weightKg: input.weightKg,
    contact: { studentMessages: input.studentMessages, agentOutreach: input.agentOutreach },
    flags,
  };
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
