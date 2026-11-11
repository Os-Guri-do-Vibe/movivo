/**
 * Observações do aluno: o que ele conta no dia a dia (sono, estresse, energia, corpo, doença,
 * viagem, trabalho) vira dado comparável. Funções puras: o serviço grava e lê; aqui se decide
 * como o relato entra na leitura do dia.
 */
import type { ObservationKind, ObservationPhase } from '../../core/database/schema';

export interface ObservationView {
  date: string;
  kind: ObservationKind;
  /** 1 = pior (estresse: 1 = sem estresse), como no check-in do dia. */
  score: number | null;
  /** Horas de sono, doses de álcool… quando o aluno disse a quantidade. */
  valueNum: number | null;
  phase: ObservationPhase;
  source: 'CHAT' | 'CHECK_IN' | 'SESSION';
  /** O que ele disse, em poucas palavras (só com consentimento de saúde ativo). */
  note: string | null;
  recordedAt: string;
}

/** Relatos que preenchem as mesmas escalas do check-in do dia. */
export const SCALE_KINDS = {
  SLEEP: 'sleep',
  ENERGY: 'energy',
  SORENESS: 'soreness',
  MOOD: 'mood',
  STRESS: 'stress',
} as const satisfies Partial<Record<ObservationKind, string>>;
export type ScaleField = (typeof SCALE_KINDS)[keyof typeof SCALE_KINDS];

export interface DayScales {
  energy: number | null;
  sleep: number | null;
  soreness: number | null;
  mood: number | null;
  stress: number | null;
}

/** Horas de sono viram nota quando o aluno só disse a quantidade ("dormi 4 horas"). */
export function sleepScoreOfHours(hours: number): number {
  if (hours < 5) return 1;
  if (hours < 6) return 2;
  if (hours < 7) return 3;
  if (hours < 8) return 4;
  return 5;
}

/** Nota do relato: a que o aluno deu, ou a derivada das horas de sono. */
export function scoreOf(o: Pick<ObservationView, 'kind' | 'score' | 'valueNum'>): number | null {
  if (o.score !== null) return o.score;
  if (o.kind === 'SLEEP' && o.valueNum !== null) return sleepScoreOfHours(o.valueNum);
  return null;
}

/** Estresse é a única escala invertida: nota alta é pior. */
const worseOf = (field: ScaleField, a: number | null, b: number | null): number | null => {
  if (a === null) return b;
  if (b === null) return a;
  return field === 'stress' ? Math.max(a, b) : Math.min(a, b);
};

/**
 * Junta o check-in do dia com os relatos do chat. Se os dois falam da mesma coisa, vale o pior
 * (decisão conservadora para a recuperação): quem escreveu "dormi mal" antes do treino não é
 * contrariado por um "dormi ok" marcado depois.
 */
export function mergeObservationScales(
  base: DayScales,
  observations: readonly ObservationView[],
): DayScales {
  const merged: DayScales = { ...base };
  for (const o of observations) {
    const score = scoreOf(o);
    if (score === null) continue;
    const field = SCALE_KINDS[o.kind as keyof typeof SCALE_KINDS];
    if (!field) continue;
    merged[field] = worseOf(field, merged[field], score);
  }
  return merged;
}

/** Relato de que o aluno vai treinar ou está treinando mal hoje, em palavras do código. */
export function summarizeObservations(observations: readonly ObservationView[]): {
  kinds: ObservationKind[];
  sleepHours: number | null;
  illness: boolean;
  travel: boolean;
  alcohol: boolean;
} {
  const hours = observations.find((o) => o.kind === 'SLEEP' && o.valueNum !== null)?.valueNum;
  return {
    kinds: [...new Set(observations.map((o) => o.kind))],
    sleepHours: hours ?? null,
    illness: observations.some((o) => o.kind === 'ILLNESS'),
    travel: observations.some((o) => o.kind === 'TRAVEL'),
    alcohol: observations.some((o) => o.kind === 'ALCOHOL'),
  };
}
