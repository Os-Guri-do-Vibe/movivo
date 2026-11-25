/**
 * Continuidade da agenda: o plano publica 2 semanas e uma rotina diária mantém a agenda sempre
 * 2 semanas à frente. Funções puras: semana do plano e semana leve (deload) de cada fase.
 */
import type { PlanPhase, PlanSession, SessionAdjustment } from '@movivo/shared';

import { addDays, mondayOf } from './week-planner';

/** Semanas de agenda mantidas à frente (a semana corrente e a seguinte). */
export const HORIZON_WEEKS = 2;
/** Fração do volume de uma semana leve (deload). */
export const DELOAD_FACTOR = 0.7;

const MS_WEEK = 7 * 86_400_000;

/** Índice (0, 1, 2…) da semana dentro do plano: semanas desde a segunda-feira do início. */
export function weekIndexOf(startsOn: string, weekStart: string): number {
  const first = Date.parse(`${mondayOf(startsOn)}T00:00:00Z`);
  const week = Date.parse(`${weekStart}T00:00:00Z`);
  return Math.max(0, Math.round((week - first) / MS_WEEK));
}

/**
 * A semana é a última de uma fase que o protocolo desenhou com mesociclo de deload? A semana
 * leve só existe quando o protocolo a prevê: não há deload fixo por tempo e, passado o fim do
 * plano (até a reavaliação gerar o próximo ciclo), a agenda segue sem semana leve.
 */
export function isDeloadWeek(phases: readonly PlanPhase[], weekIndex: number): boolean {
  let cursor = weekIndex;
  for (const phase of phases) {
    if (cursor < phase.weeks) return phase.endsWithDeload && cursor === phase.weeks - 1;
    cursor -= phase.weeks;
  }
  return false;
}

/** Ajuste da semana leve para uma sessão de `estimatedMinutes`. */
export function deloadAdjustment(estimatedMinutes: number): SessionAdjustment {
  return {
    shorten: {
      targetMinutes: Math.min(240, Math.max(10, Math.round(estimatedMinutes * DELOAD_FACTOR))),
      factor: DELOAD_FACTOR,
    },
  };
}

/** Crescimento semanal do volume da corrida dentro do plano (metade do teto de 10% da metodologia). */
export const RUNNING_WEEKLY_PROGRESS = 0.05;
/** Teto do acúmulo no plano; o longão cresce menos para não passar do limite de duração. */
export const RUNNING_PROGRESS_CAP = 1.2;
export const RUNNING_LONG_PROGRESS_CAP = 1.1;

/**
 * Periodização da corrida: a semana `weekIndex` (0 = primeira do plano) cresce 5% sobre a anterior
 * até o teto. O plano guarda o volume da primeira semana, já validado contra o que o aluno corre
 * hoje; a agenda sobe daí. Só planos com treino do catálogo (`workoutType`) progridem, e a semana
 * leve (deload) nunca cresce.
 */
export function runningProgressionAdjustment(
  session: Pick<PlanSession, 'content'>,
  weekIndex: number,
  deload: boolean,
): SessionAdjustment | undefined {
  const content = session.content;
  if (deload || weekIndex <= 0 || content.modality !== 'RUNNING' || !content.workoutType) {
    return undefined;
  }
  const cap = content.kind === 'LONG' ? RUNNING_LONG_PROGRESS_CAP : RUNNING_PROGRESS_CAP;
  const factor = Math.min(cap, 1 + RUNNING_WEEKLY_PROGRESS * weekIndex);
  return factor > 1 ? { progress: { factor: Math.round(factor * 100) / 100 } } : undefined;
}

/** Segundas-feiras que a agenda precisa cobrir a partir de hoje. */
export function horizonWeeks(today: string): string[] {
  const monday = mondayOf(today);
  return Array.from({ length: HORIZON_WEEKS }, (_, i) => addDays(monday, i * 7));
}
