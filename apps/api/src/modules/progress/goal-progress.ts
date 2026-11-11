/**
 * Progresso das metas, sem modelo: microtarefa concluída por EVENTO (treino feito, refeição
 * registrada, medida lançada), nunca por declaração; marco verificado contra o número real.
 */
import type { GoalIndicator, GoalMilestone, GoalTaskKind, MeasurementKind } from '@movivo/shared';

/** Contagens dentro da janela de uma microtarefa. */
export interface TaskWindowCounts {
  executionsDone: number;
  keySessionsDone: number;
  foodLogDays: number;
  proteinDays: number;
  measurements: number;
  photos: number;
  checkInsAnswered: number;
}

/** Progresso medido da microtarefa; `null` quando o tipo não é verificável por evento. */
export function taskProgress(kind: GoalTaskKind, counts: TaskWindowCounts): number | null {
  switch (kind) {
    case 'COMPLETE_SESSIONS':
      return counts.executionsDone;
    case 'COMPLETE_KEY_SESSION':
      return counts.keySessionsDone;
    case 'LOG_MEALS':
      return counts.foodLogDays;
    case 'HIT_PROTEIN':
      return counts.proteinDays;
    case 'RECORD_MEASUREMENTS':
      return counts.measurements;
    case 'RECORD_PHOTOS':
      return counts.photos;
    case 'ANSWER_CHECK_IN':
      return counts.checkInsAnswered;
    case 'SLEEP_ROUTINE':
    case 'CUSTOM':
      return null;
  }
}

export type TaskStatus = 'OPEN' | 'DONE' | 'MISSED';

/** Estado da microtarefa dada a janela: concluída ao bater o alvo, perdida ao vencer sem bater. */
export function taskStatus(
  progress: number,
  target: number,
  windowEnd: string,
  today: string,
): TaskStatus {
  if (progress >= target) return 'DONE';
  return today > windowEnd ? 'MISSED' : 'OPEN';
}

const MEASUREMENT_BY_KEY: readonly [string, MeasurementKind][] = [
  ['weight', 'WEIGHT'],
  ['peso', 'WEIGHT'],
  ['waist', 'WAIST'],
  ['cintura', 'WAIST'],
  ['hip', 'HIP'],
  ['body_fat', 'BODY_FAT_PERCENT'],
  ['gordura', 'BODY_FAT_PERCENT'],
];

/** Medida corporal que um indicador acompanha, pela chave do indicador (ou `null`). */
export function measurementOf(indicator: GoalIndicator): MeasurementKind | null {
  if (indicator.source !== 'BODY') return null;
  return MEASUREMENT_BY_KEY.find(([prefix]) => indicator.key.startsWith(prefix))?.[1] ?? null;
}

export interface IndicatorReading {
  current: number | null;
  /** Primeira leitura depois do início da meta (para `CHANGE_BY`). */
  baseline: number | null;
}

export type MilestoneVerdict = 'ACHIEVED' | 'MISSED' | 'PENDING';

/**
 * Atinge assim que a condição é satisfeita; perde só quando o prazo passa sem satisfazer.
 * `MANUAL` e leitura indisponível ficam pendentes para o profissional resolver.
 */
export function evaluateMilestone(
  condition: GoalMilestone['condition'],
  reading: IndicatorReading,
  dueOn: string,
  today: string,
): MilestoneVerdict {
  if (condition.kind === 'MANUAL' || reading.current === null) return 'PENDING';
  let satisfied: boolean;
  switch (condition.kind) {
    case 'AT_LEAST':
      satisfied = reading.current >= condition.value;
      break;
    case 'AT_MOST':
      satisfied = reading.current <= condition.value;
      break;
    case 'CHANGE_BY': {
      if (reading.baseline === null) return 'PENDING';
      const change = reading.current - reading.baseline;
      satisfied = condition.delta >= 0 ? change >= condition.delta : change <= condition.delta;
      break;
    }
  }
  if (satisfied) return 'ACHIEVED';
  return today > dueOn ? 'MISSED' : 'PENDING';
}
