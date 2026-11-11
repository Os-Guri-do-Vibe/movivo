/**
 * Métricas de carga e prontidão do aluno, calculadas a partir do que ele já registra (esforço e
 * minutos do treino, check-in do dia). O aluno nunca preenche isso: a plataforma deriva.
 *
 * Funções puras e sem relógio: a data de referência vem de fora. Os limiares são de orientação
 * para os agentes (não são diagnóstico) e seguem a literatura de monitoramento de carga:
 * sRPE (Foster), razão aguda:crônica (Gabbett), monotonia e strain (Foster).
 */
import { addDays } from '../planning/calc/week-planner';

export interface LoadDay {
  date: string;
  /** sRPE realizado no dia (soma de todas as sessões). */
  load: number;
}

export interface PlannedDay {
  date: string;
  /** Carga que a agenda previa para o dia (estimada pelo histórico do próprio aluno). */
  load: number;
}

export interface ReadinessDay {
  date: string;
  /** Escalas 1–5 do check-in; `stress` 1 = tranquilo, 5 = muito estressado. */
  energy: number | null;
  sleep: number | null;
  soreness: number | null;
  mood: number | null;
  stress: number | null;
}

export type RiskKind =
  | 'ACWR_HIGH'
  | 'ACWR_ELEVATED'
  | 'ACWR_LOW'
  | 'LOAD_SPIKE'
  | 'MONOTONY_HIGH'
  | 'READINESS_LOW'
  | 'SLEEP_LOW'
  | 'STRESS_HIGH'
  | 'PLANNED_UNDERDONE';

export interface RiskFlag {
  kind: RiskKind;
  /** Frase curta, em linguagem de acompanhamento, para o agente usar de base. */
  detail: string;
}

export interface LoadMetrics {
  asOf: string;
  /** Carga somada dos últimos 7 dias (inclui o dia de referência). */
  weeklyLoad: number;
  /** Carga somada dos 7 dias anteriores a esses. */
  previousWeeklyLoad: number;
  /** Média diária dos últimos 7 dias. */
  acuteDaily: number;
  /** Média diária dos últimos 28 dias. */
  chronicDaily: number;
  /** Aguda ÷ crônica; `null` sem 3 semanas de histórico (a razão enganaria). */
  acwr: number | null;
  /** Média ÷ desvio-padrão da carga diária dos últimos 7 dias; `null` se não variou ou sem carga. */
  monotony: number | null;
  /** Carga semanal × monotonia. */
  strain: number | null;
  plannedLoad7d: number;
  realizedLoad7d: number;
  /** Realizado ÷ planejado nos últimos 7 dias; `null` sem carga planejada. */
  adherenceRatio: number | null;
  /** Dias com treino nos últimos 7 dias. */
  activeDays7d: number;
  readiness: ReadinessSummary;
  risks: RiskFlag[];
}

export interface ReadinessSummary {
  /** 0–100 (maior = mais pronto) do dia mais recente respondido nos últimos 3 dias. */
  score: number | null;
  /** Média dos 14 dias anteriores a ele. */
  baseline: number | null;
  /** score − baseline; negativo = abaixo do que é normal para este aluno. */
  delta: number | null;
  answeredDays14d: number;
  /** Média das últimas respostas de sono (1–5) e estresse (1–5), para os agentes citarem. */
  sleepAvg7d: number | null;
  stressAvg7d: number | null;
}

/** Histórico mínimo para a razão aguda:crônica deixar de ser ruído. */
export const MIN_ACWR_HISTORY_DAYS = 21;
const ACUTE_DAYS = 7;
const CHRONIC_DAYS = 28;

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const mean = (values: number[]) => (values.length === 0 ? 0 : sum(values) / values.length);
const round = (value: number, places = 2) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/** Carga por dia numa janela de `days` dias terminando em `asOf`; dia sem treino vale zero. */
export function dailySeries(days: LoadDay[], asOf: string, count: number): number[] {
  const byDay = new Map<string, number>();
  for (const day of days) byDay.set(day.date, (byDay.get(day.date) ?? 0) + day.load);
  return Array.from({ length: count }, (_, i) => byDay.get(addDays(asOf, i - count + 1)) ?? 0);
}

function standardDeviation(values: number[]): number {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

/**
 * Prontidão de 0 a 100 de um dia: média das respostas já viradas para "maior = melhor"
 * (o estresse é invertido). Dia sem nenhuma resposta não tem nota.
 */
export function readinessScore(day: ReadinessDay): number | null {
  const parts = [
    day.energy,
    day.sleep,
    day.soreness,
    day.mood,
    day.stress === null ? null : 6 - day.stress,
  ].filter((value): value is number => value !== null);
  if (parts.length === 0) return null;
  return Math.round(((mean(parts) - 1) / 4) * 100);
}

function summarizeReadiness(days: ReadinessDay[], asOf: string): ReadinessSummary {
  const window14 = days.filter((d) => d.date <= asOf && d.date > addDays(asOf, -14));
  const scored = window14
    .map((d) => ({ date: d.date, score: readinessScore(d) }))
    .filter((d): d is { date: string; score: number } => d.score !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = [...scored].reverse().find((d) => d.date > addDays(asOf, -3));
  const before = scored.filter((d) => d.date !== latest?.date);
  const baseline = before.length >= 3 ? Math.round(mean(before.map((d) => d.score))) : null;
  const last7 = window14.filter((d) => d.date > addDays(asOf, -7));
  const avgOf = (pick: (d: ReadinessDay) => number | null) => {
    const values = last7.map(pick).filter((value): value is number => value !== null);
    return values.length === 0 ? null : round(mean(values), 1);
  };
  return {
    score: latest?.score ?? null,
    baseline,
    delta: latest && baseline !== null ? latest.score - baseline : null,
    answeredDays14d: scored.length,
    sleepAvg7d: avgOf((d) => d.sleep),
    stressAvg7d: avgOf((d) => d.stress),
  };
}

export function computeLoadMetrics(input: {
  asOf: string;
  executions: LoadDay[];
  planned: PlannedDay[];
  checkIns: ReadinessDay[];
  /** Primeiro dia com treino registrado; limita o histórico válido para a razão aguda:crônica. */
  firstTrainingDay: string | null;
}): LoadMetrics {
  const { asOf } = input;
  const series28 = dailySeries(input.executions, asOf, CHRONIC_DAYS);
  const series7 = series28.slice(-ACUTE_DAYS);
  const previous7 = series28.slice(-2 * ACUTE_DAYS, -ACUTE_DAYS);

  const weeklyLoad = sum(series7);
  const previousWeeklyLoad = sum(previous7);
  const acuteDaily = mean(series7);
  const chronicDaily = mean(series28);

  const historyDays = input.firstTrainingDay
    ? Math.round(
        (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${input.firstTrainingDay}T00:00:00Z`)) /
          86_400_000,
      ) + 1
    : 0;
  const acwr =
    historyDays >= MIN_ACWR_HISTORY_DAYS && chronicDaily > 0
      ? round(acuteDaily / chronicDaily)
      : null;

  const deviation = standardDeviation(series7);
  const monotony = weeklyLoad > 0 && deviation > 1e-9 ? round(acuteDaily / deviation) : null;
  const strain = monotony === null ? null : Math.round(weeklyLoad * monotony);

  const plannedLoad7d = sum(
    input.planned
      .filter((d) => d.date <= asOf && d.date > addDays(asOf, -ACUTE_DAYS))
      .map((d) => d.load),
  );
  const adherenceRatio = plannedLoad7d > 0 ? round(weeklyLoad / plannedLoad7d) : null;
  const readiness = summarizeReadiness(input.checkIns, asOf);

  const risks: RiskFlag[] = [];
  if (acwr !== null && acwr > 1.5) {
    risks.push({
      kind: 'ACWR_HIGH',
      detail: `a carga da semana está ${acwr}× acima do que o corpo vinha absorvendo`,
    });
  } else if (acwr !== null && acwr > 1.3) {
    risks.push({
      kind: 'ACWR_ELEVATED',
      detail: `a carga da semana subiu (${acwr}× a média das últimas semanas)`,
    });
  } else if (acwr !== null && acwr < 0.8) {
    risks.push({
      kind: 'ACWR_LOW',
      detail: `a carga recente está abaixo do habitual (${acwr}× a média das últimas semanas)`,
    });
  }
  if (previousWeeklyLoad > 0 && weeklyLoad > previousWeeklyLoad * 1.3) {
    risks.push({
      kind: 'LOAD_SPIKE',
      detail: `a carga semanal subiu ${Math.round((weeklyLoad / previousWeeklyLoad - 1) * 100)}% sobre a semana anterior`,
    });
  }
  if (monotony !== null && monotony > 2) {
    risks.push({
      kind: 'MONOTONY_HIGH',
      detail: `os dias de treino da semana foram muito parecidos (monotonia ${monotony})`,
    });
  }
  if (readiness.score !== null && (readiness.score < 40 || (readiness.delta ?? 0) <= -20)) {
    risks.push({
      kind: 'READINESS_LOW',
      detail: `prontidão ${readiness.score}/100${readiness.delta === null ? '' : `, ${Math.abs(readiness.delta)} pontos abaixo do normal dele`}`,
    });
  }
  if (readiness.sleepAvg7d !== null && readiness.sleepAvg7d <= 2.5) {
    risks.push({
      kind: 'SLEEP_LOW',
      detail: `sono médio de ${readiness.sleepAvg7d} em 5 nos últimos 7 dias`,
    });
  }
  if (readiness.stressAvg7d !== null && readiness.stressAvg7d >= 4) {
    risks.push({
      kind: 'STRESS_HIGH',
      detail: `estresse médio de ${readiness.stressAvg7d} em 5 nos últimos 7 dias`,
    });
  }
  if (adherenceRatio !== null && adherenceRatio < 0.5 && plannedLoad7d > 0) {
    risks.push({
      kind: 'PLANNED_UNDERDONE',
      detail: `menos da metade da carga planejada foi realizada (${Math.round(adherenceRatio * 100)}%)`,
    });
  }

  return {
    asOf,
    weeklyLoad,
    previousWeeklyLoad,
    acuteDaily: round(acuteDaily, 1),
    chronicDaily: round(chronicDaily, 1),
    acwr,
    monotony,
    strain,
    plannedLoad7d,
    realizedLoad7d: weeklyLoad,
    adherenceRatio,
    activeDays7d: series7.filter((load) => load > 0).length,
    readiness,
    risks,
  };
}

/** O recorte que os agentes leem (sem séries nem datas internas). */
export function loadMetricsView(metrics: LoadMetrics) {
  const { readiness } = metrics;
  return {
    weeklyLoad: metrics.weeklyLoad,
    previousWeeklyLoad: metrics.previousWeeklyLoad,
    plannedLoad7d: metrics.plannedLoad7d,
    adherenceRatio: metrics.adherenceRatio,
    acwr: metrics.acwr,
    monotony: metrics.monotony,
    strain: metrics.strain,
    activeDays7d: metrics.activeDays7d,
    readiness: {
      score: readiness.score,
      baseline: readiness.baseline,
      delta: readiness.delta,
      sleepAvg7d: readiness.sleepAvg7d,
      stressAvg7d: readiness.stressAvg7d,
    },
    risks: metrics.risks,
  };
}
