/**
 * A semana alimentar do aluno em números: o que registrou contra a meta do plano, quais refeições
 * somem, como ele diz que está indo e para onde o peso caminha. Funções puras: o serviço busca os
 * dados e o especialista de nutrição lê este resumo.
 */
import { addDays } from '../planning/calc/week-planner';

export interface LoggedMeal {
  date: string;
  meal: string;
  energyKcal: number;
  proteinG: number;
  fiberG: number;
}

export interface DayTargets {
  energyKcal: { min: number; max: number };
  proteinG: number;
  fiberG: number;
}

export interface NutritionWeek {
  /** Dias com ao menos um registro. */
  loggedDays: number;
  /** Dias em que 3 ou mais refeições foram registradas (dia razoavelmente completo). */
  fullDays: number;
  /** Médias só dos dias completos (registro parcial subestima e enganaria). */
  avgEnergyKcal: number | null;
  avgProteinG: number | null;
  avgFiberG: number | null;
  /** Média do aluno ÷ meta do plano para os mesmos dias (1 = na meta). */
  energyRatio: number | null;
  proteinRatio: number | null;
  fiberRatio: number | null;
  /** Em quantos dias cada refeição foi registrada. */
  daysBySlot: Record<string, number>;
  checkIn: { onTrack: number; partial: number; off: number };
  weight: {
    points: number;
    firstKg: number | null;
    lastKg: number | null;
    /** kg por semana (regressão simples); `null` sem 2 pesagens com 7 dias ou mais entre elas. */
    slopeKgPerWeek: number | null;
    /** Pesagens das últimas 8 semanas, da mais antiga à mais nova (o check-in de domingo). */
    history: Array<{ date: string; kg: number }>;
    /** Variação da última pesagem para a anterior (kg); `null` sem duas pesagens. */
    lastChangeKg: number | null;
    /** Dias desde a última pesagem; `null` se nunca se pesou. */
    daysSinceLast: number | null;
  };
}

const round = (value: number, places = 2) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const target = (t: DayTargets) => (t.energyKcal.min + t.energyKcal.max) / 2;

export function weightSlopePerWeek(
  points: ReadonlyArray<{ date: string; value: number }>,
): number | null {
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const t0 = Date.parse(`${sorted[0]?.date}T00:00:00Z`);
  const xs = sorted.map((p) => (Date.parse(`${p.date}T00:00:00Z`) - t0) / 86_400_000);
  if ((xs.at(-1) ?? 0) < 7) return null;
  const ys = sorted.map((p) => p.value);
  const mx = mean(xs);
  const my = mean(ys);
  const denominator = xs.reduce((total, x) => total + (x - mx) ** 2, 0);
  if (denominator === 0) return null;
  const slope = xs.reduce((total, x, i) => total + (x - mx) * ((ys[i] ?? 0) - my), 0) / denominator;
  return round(slope * 7);
}

export function summarizeNutritionWeek(input: {
  today: string;
  logs: readonly LoggedMeal[];
  trainingDay: DayTargets;
  restDay: DayTargets;
  trainingDates: ReadonlySet<string>;
  checkIns: ReadonlyArray<{ date: string; nutrition: string | null }>;
  weights: ReadonlyArray<{ date: string; value: number }>;
}): NutritionWeek {
  const from = addDays(input.today, -6);
  const logs = input.logs.filter((l) => l.date >= from && l.date <= input.today);
  const byDay = new Map<string, LoggedMeal[]>();
  for (const log of logs) byDay.set(log.date, [...(byDay.get(log.date) ?? []), log]);

  const daysBySlot: Record<string, number> = {};
  for (const [, meals] of byDay) {
    for (const slot of new Set(meals.map((m) => m.meal))) {
      daysBySlot[slot] = (daysBySlot[slot] ?? 0) + 1;
    }
  }

  const full = [...byDay].filter(([, meals]) => new Set(meals.map((m) => m.meal)).size >= 3);
  const totals = full.map(([date, meals]) => ({
    date,
    energy: meals.reduce((t, m) => t + m.energyKcal, 0),
    protein: meals.reduce((t, m) => t + m.proteinG, 0),
    fiber: meals.reduce((t, m) => t + m.fiberG, 0),
    targets: input.trainingDates.has(date) ? input.trainingDay : input.restDay,
  }));
  const avg = (pick: (t: (typeof totals)[number]) => number) =>
    totals.length > 0 ? round(mean(totals.map(pick)), 0) : null;
  const ratio = (value: (t: (typeof totals)[number]) => number, goal: (t: DayTargets) => number) =>
    totals.length > 0
      ? round(mean(totals.map((t) => value(t) / Math.max(goal(t.targets), 1))))
      : null;

  const checkIns = input.checkIns.filter((c) => c.date >= from && c.date <= input.today);
  const weights = input.weights
    .filter((w) => w.date >= addDays(input.today, -56) && w.date <= input.today)
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    loggedDays: byDay.size,
    fullDays: full.length,
    avgEnergyKcal: avg((t) => t.energy),
    avgProteinG: avg((t) => t.protein),
    avgFiberG: avg((t) => t.fiber),
    energyRatio: ratio((t) => t.energy, target),
    proteinRatio: ratio(
      (t) => t.protein,
      (g) => g.proteinG,
    ),
    fiberRatio: ratio(
      (t) => t.fiber,
      (g) => g.fiberG,
    ),
    daysBySlot,
    checkIn: {
      onTrack: checkIns.filter((c) => c.nutrition === 'ON_TRACK').length,
      partial: checkIns.filter((c) => c.nutrition === 'PARTIAL').length,
      off: checkIns.filter((c) => c.nutrition === 'OFF').length,
    },
    weight: {
      points: weights.length,
      firstKg: weights[0]?.value ?? null,
      lastKg: weights.at(-1)?.value ?? null,
      slopeKgPerWeek: weightSlopePerWeek(weights),
      history: weights.slice(-8).map((w) => ({ date: w.date, kg: round(w.value, 1) })),
      lastChangeKg:
        weights.length >= 2
          ? round((weights.at(-1)?.value ?? 0) - (weights.at(-2)?.value ?? 0), 1)
          : null,
      daysSinceLast: weights.length
        ? Math.round(
            (Date.parse(`${input.today}T00:00:00Z`) -
              Date.parse(`${weights.at(-1)?.date}T00:00:00Z`)) /
              86_400_000,
          )
        : null,
    },
  };
}
