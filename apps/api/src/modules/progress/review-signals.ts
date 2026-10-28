/**
 * Sinais da revisão semanal: fatos derivados dos números, sem modelo. Funções puras — o mesmo
 * histórico dá sempre os mesmos sinais, e é daqui que vêm as únicas evidências que o modelo
 * pode citar e as únicas ações que ele pode propor.
 */
import type {
  CoachingActionType,
  ReviewSignal,
  ReviewSignalKind,
  WeekMetrics,
} from '@movivo/shared';

export type GoalDirection = 'LOSE' | 'GAIN' | 'MAINTAIN' | 'NONE';

export interface ReviewContext {
  goal: GoalDirection;
  /** Há plano alimentar ativo (sem plano, falta de registro não é sinal). */
  hasNutritionPlan: boolean;
}

const ADHERENCE_FLOOR = 0.6;
const KEY_FLOOR = 0.5;
const EFFORT_CEILING = 8.5;
const LOAD_SPIKE_RATIO = 1.5;
const PLATEAU_KG_PER_WEEK = 0.1;
const WRONG_WAY_KG_PER_WEEK = 0.15;
const RAPID_KG_PER_WEEK = 1;
const MIN_WEIGHT_POINTS = 4;

const rate = (done: number, planned: number): number | null =>
  planned > 0 ? done / planned : null;

/** Inclinação (kg/semana) por mínimos quadrados sobre as semanas com peso. */
export function weightSlope(weeks: readonly WeekMetrics[]): number | null {
  const points = weeks.flatMap((week, index) =>
    week.weightKg === null ? [] : [{ x: index, y: week.weightKg }],
  );
  if (points.length < MIN_WEIGHT_POINTS) return null;
  const n = points.length;
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / n;
  const denominator = points.reduce((sum, p) => sum + (p.x - meanX) ** 2, 0);
  if (denominator === 0) return null;
  return points.reduce((sum, p) => sum + (p.x - meanX) * (p.y - meanY), 0) / denominator;
}

const signal = (kind: ReviewSignalKind, detail: string): ReviewSignal => ({
  key: kind.toLowerCase(),
  kind,
  detail,
});

/** `weeks` em ordem cronológica; a última é a semana recém-fechada. */
export function computeSignals(
  weeks: readonly WeekMetrics[],
  context: ReviewContext,
): ReviewSignal[] {
  const found: ReviewSignal[] = [];
  const recent = weeks.slice(-2);
  const last = weeks.at(-1);
  if (!last) return found;

  if (
    recent.length === 2 &&
    recent.every((w) => w.planned >= 2 && (rate(w.done, w.planned) ?? 1) < ADHERENCE_FLOOR)
  ) {
    found.push(
      signal(
        'ADHERENCE_LOW',
        `Concluiu ${recent.map((w) => `${w.done}/${w.planned}`).join(' e ')} das sessões nas duas últimas semanas.`,
      ),
    );
  }

  const keyPlanned = recent.reduce((sum, w) => sum + w.keyPlanned, 0);
  const keyDone = recent.reduce((sum, w) => sum + w.keyDone, 0);
  if (keyPlanned >= 2 && keyDone / keyPlanned < KEY_FLOOR) {
    found.push(
      signal(
        'KEY_SESSIONS_SKIPPED',
        `Fez ${keyDone} de ${keyPlanned} sessões-chave nas duas últimas semanas.`,
      ),
    );
  }

  if (recent.length === 2 && recent.every((w) => (w.avgRpe ?? 0) >= EFFORT_CEILING)) {
    found.push(
      signal(
        'EFFORT_HIGH',
        'A percepção de esforço média ficou em 8,5 ou mais nas duas últimas semanas.',
      ),
    );
  }

  // Só semanas com atividade formam a base: um aluno novo não tem "média das anteriores".
  const prior = weeks.slice(-4, -1).filter((w) => w.planned > 0 || w.load > 0);
  if (prior.length === 3) {
    const baseline = prior.reduce((sum, w) => sum + w.load, 0) / prior.length;
    if (baseline > 0 && last.load > baseline * LOAD_SPIKE_RATIO) {
      found.push(
        signal(
          'LOAD_SPIKE',
          `A carga da última semana (${Math.round(last.load)}) passou de 1,5 vez a média das três anteriores (${Math.round(baseline)}).`,
        ),
      );
    }
  }

  const slope = context.goal === 'NONE' ? null : weightSlope(weeks.slice(-6));
  if (slope !== null) {
    const perWeek = `${slope >= 0 ? '+' : ''}${slope.toFixed(2).replace('.', ',')} kg/semana`;
    if (Math.abs(slope) >= RAPID_KG_PER_WEEK) {
      found.push(signal('WEIGHT_RAPID_CHANGE', `O peso variou ${perWeek} nas últimas semanas.`));
    } else if (
      (context.goal === 'LOSE' && slope > WRONG_WAY_KG_PER_WEEK) ||
      (context.goal === 'GAIN' && slope < -WRONG_WAY_KG_PER_WEEK)
    ) {
      found.push(
        signal('WEIGHT_WRONG_DIRECTION', `O peso foi na direção oposta ao objetivo (${perWeek}).`),
      );
    } else if (
      (context.goal === 'LOSE' || context.goal === 'GAIN') &&
      Math.abs(slope) < PLATEAU_KG_PER_WEEK
    ) {
      found.push(
        signal('WEIGHT_PLATEAU', `O peso quase não mudou nas últimas semanas (${perWeek}).`),
      );
    }
  }

  if (context.hasNutritionPlan && recent.length === 2 && recent.every((w) => w.foodLogDays <= 2)) {
    found.push(
      signal(
        'NUTRITION_UNDERLOGGED',
        'A alimentação foi registrada em 2 dias ou menos por semana, nas duas últimas semanas.',
      ),
    );
  }

  if (recent.reduce((sum, w) => sum + w.painReports, 0) >= 2) {
    found.push(
      signal('PAIN_REPORTED', 'Relatou dor em mais de um treino nas duas últimas semanas.'),
    );
  }
  return found;
}

/** Ações que a revisão pode propor, dado o conjunto de sinais. Vazio = nada a fazer. */
export function allowedActions(signals: readonly ReviewSignal[]): CoachingActionType[] {
  if (signals.length === 0) return [];
  const kinds = new Set(signals.map((s) => s.kind));
  const allowed = new Set<CoachingActionType>(['ASK_STUDENT']);
  // Sinal de segurança ou de mudança rápida: só perguntar (o profissional entra pela sentinela).
  if (kinds.has('PAIN_REPORTED') || kinds.has('WEIGHT_RAPID_CHANGE')) return ['ASK_STUDENT'];
  if (
    kinds.has('ADHERENCE_LOW') ||
    kinds.has('KEY_SESSIONS_SKIPPED') ||
    kinds.has('NUTRITION_UNDERLOGGED')
  ) {
    allowed.add('SEND_MESSAGE');
  }
  if (kinds.has('ADHERENCE_LOW') || kinds.has('EFFORT_HIGH') || kinds.has('LOAD_SPIKE')) {
    allowed.add('ADJUST_WEEKLY_VOLUME');
  }
  // Mexer na energia exige peso confiável: sem adesão ao registro e ao treino, só perguntar.
  const weightSignal = kinds.has('WEIGHT_PLATEAU') || kinds.has('WEIGHT_WRONG_DIRECTION');
  if (weightSignal && !kinds.has('NUTRITION_UNDERLOGGED') && !kinds.has('ADHERENCE_LOW')) {
    allowed.add('ADJUST_ENERGY_TARGET');
  }
  return [...allowed];
}

/** Faixa permitida para o ajuste de energia (kcal/dia), na direção do objetivo. */
export function energyDeltaBounds(goal: GoalDirection): { min: number; max: number } | null {
  if (goal === 'LOSE') return { min: -150, max: 0 };
  if (goal === 'GAIN') return { min: 0, max: 150 };
  return null;
}

/** Menor redução que vale a pena propor (%); o teto vem do limite da política publicada. */
export const MIN_VOLUME_STEP = -5;
