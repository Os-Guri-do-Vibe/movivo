/**
 * Gasto energético e limites de meta nutricional (determinísticos).
 *
 * O agente de nutrição escolhe DENTRO destes limites; o validador recusa o que sair deles. Os
 * números vêm dos parâmetros publicados pelo nutricionista (`NUTRITION`); a única constante
 * daqui é o fator de atividade não treinada, uma estimativa conservadora do dia sem treino.
 */
import type { DailyTargets, EnergyStrategy, PlanSession } from '@movivo/shared';

import type { NutritionRules, ProteinGoalKey, Range } from './params';

/** Fator sobre a TMB para o dia SEM treino (rotina sedentária a leve). */
const NON_TRAINING_ACTIVITY = 1.3;
/** 1 kg de massa corporal ≈ 7.700 kcal (aproximação usual de planejamento). */
const KCAL_PER_KG = 7_700;

export interface BodyInputs {
  sex: 'MALE' | 'FEMALE';
  ageYears: number;
  heightCm: number;
  weightKg: number;
  bodyFatPercent?: number | null;
}

/** Taxa metabólica basal (kcal/dia). Katch-McArdle só com % de gordura informado. */
export function basalMetabolicRate(
  body: BodyInputs,
  method: NutritionRules['estimationMethod'],
): number {
  if (method === 'KATCH_MCARDLE' && body.bodyFatPercent != null) {
    const leanMass = body.weightKg * (1 - body.bodyFatPercent / 100);
    return Math.round(370 + 21.6 * leanMass);
  }
  const base = 10 * body.weightKg + 6.25 * body.heightCm - 5 * body.ageYears;
  return Math.round(base + (body.sex === 'MALE' ? 5 : -161));
}

/** MET aproximado pela PSE (CR-10): sessão leve ≈ 4, moderada ≈ 7, máxima ≈ 11. */
export function metOfRpe(rpe: number): number {
  return 3 + 0.8 * rpe;
}

/** Gasto médio de UMA sessão de treino (kcal), ponderando pelas frequências do plano. */
export function averageSessionKcal(sessions: readonly PlanSession[], weightKg: number): number {
  const total = sessions.reduce((sum, s) => sum + s.weeklyFrequency, 0);
  if (total === 0) return 0;
  const kcal = sessions.reduce(
    (sum, s) =>
      sum + s.weeklyFrequency * ((metOfRpe(s.estimatedRpe) * weightKg * s.estimatedMinutes) / 60),
    0,
  );
  return Math.round(kcal / total);
}

export interface EnergyEstimate {
  bmr: number;
  restDayKcal: number;
  trainingDayKcal: number;
}

export function estimateExpenditure(
  body: BodyInputs,
  sessions: readonly PlanSession[],
  rules: NutritionRules,
): EnergyEstimate {
  const bmr = basalMetabolicRate(body, rules.estimationMethod);
  const restDayKcal = Math.round(bmr * NON_TRAINING_ACTIVITY);
  return {
    bmr,
    restDayKcal,
    trainingDayKcal: restDayKcal + averageSessionKcal(sessions, body.weightKg),
  };
}

/** Faixa de energia da estratégia sobre um gasto de referência, respeitando o piso. */
export function energyRangeFor(
  strategy: EnergyStrategy,
  expenditureKcal: number,
  rules: NutritionRules,
  sex: 'MALE' | 'FEMALE',
): Range {
  const scale = (pct: Range | null, sign: -1 | 1, fallback: Range): Range => {
    const r = pct ?? fallback;
    // A faixa percentual vai do ajuste menor ao maior: (1 ± min) … (1 ± max), ordenada.
    const a = expenditureKcal * (1 + (sign * r.min) / 100);
    const b = expenditureKcal * (1 + (sign * r.max) / 100);
    return { min: Math.round(Math.min(a, b)), max: Math.round(Math.max(a, b)) };
  };
  let range: Range;
  switch (strategy) {
    case 'DEFICIT':
      range = scale(rules.deficitPct, -1, { min: 10, max: 20 });
      break;
    case 'SURPLUS':
      range = scale(rules.surplusPct, 1, { min: 5, max: 10 });
      break;
    case 'RECOMPOSITION':
      range = scale(rules.recompositionPct, -1, { min: 0, max: 10 });
      break;
    case 'PERFORMANCE_FUELING':
      range = {
        min: Math.round(expenditureKcal * 0.97),
        max: Math.round(expenditureKcal * 1.1),
      };
      break;
    case 'MAINTENANCE':
      range = { min: Math.round(expenditureKcal * 0.95), max: Math.round(expenditureKcal * 1.05) };
      break;
  }
  const floor = rules.energyFloorKcal[sex];
  return floor === null
    ? range
    : { min: Math.max(range.min, floor), max: Math.max(range.max, floor) };
}

/** Qual linha da tabela de proteína vale para a estratégia (e o foco do aluno). */
export function proteinGoalKey(strategy: EnergyStrategy, enduranceFocus: boolean): ProteinGoalKey {
  if (strategy === 'RECOMPOSITION') return 'RECOMPOSITION';
  if (strategy === 'DEFICIT') return 'FAT_LOSS';
  if (strategy === 'SURPLUS') return 'HYPERTROPHY';
  return enduranceFocus ? 'ENDURANCE' : 'HEALTH';
}

export interface DayBounds {
  energyKcal: Range;
  proteinG: Range;
  fatMinG: number | null;
  fiberMinG: number | null;
  waterMinMl: number | null;
}

/** Limites de UM tipo de dia (treino ou descanso) para a estratégia escolhida. */
export function dayBounds(
  strategy: EnergyStrategy,
  expenditureKcal: number,
  body: BodyInputs,
  rules: NutritionRules,
  enduranceFocus: boolean,
): DayBounds {
  const energyKcal = energyRangeFor(strategy, expenditureKcal, rules, body.sex);
  const protein = rules.proteinGPerKg[proteinGoalKey(strategy, enduranceFocus)];
  return {
    energyKcal,
    proteinG: protein
      ? {
          min: Math.round(protein.min * body.weightKg),
          max: Math.round(protein.max * body.weightKg),
        }
      : { min: 0, max: Number.POSITIVE_INFINITY },
    fatMinG: rules.fatMinGPerKg === null ? null : Math.round(rules.fatMinGPerKg * body.weightKg),
    fiberMinG:
      rules.fiberGPer1000Kcal === null
        ? null
        : Math.round((rules.fiberGPer1000Kcal * energyKcal.min) / 1000),
    waterMinMl: rules.waterMlPerKg === null ? null : Math.round(rules.waterMlPerKg * body.weightKg),
  };
}

/** Perda semanal implícita (% do peso) de um consumo abaixo do gasto. */
export function weeklyLossPct(expenditureKcal: number, intakeKcal: number, weightKg: number) {
  const deficit = Math.max(0, expenditureKcal - intakeKcal);
  return ((deficit * 7) / KCAL_PER_KG / weightKg) * 100;
}

/** Calorias dos macros de uma meta (4/4/9). */
export function macroKcal(targets: Pick<DailyTargets, 'proteinG' | 'carbsG' | 'fatG'>): number {
  return targets.proteinG * 4 + targets.carbsG * 4 + targets.fatG * 9;
}
