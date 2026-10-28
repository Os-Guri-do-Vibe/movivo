/**
 * Indicadores corporais derivados das medidas do aluno (determinísticos).
 *
 * O Motor de Objetivos NÃO "olha a foto e decide": a adiposidade usada na estratégia sai daqui,
 * a partir de % de gordura informado ou, na falta, da relação cintura/altura, com os limiares
 * publicados pelo nutricionista. Sem dado suficiente o resultado é `UNKNOWN` — e o agente deve
 * dizer o que falta saber em vez de supor.
 */
import type { NutritionRules } from './params';

export type Adiposity = 'LOW' | 'MODERATE' | 'HIGH' | 'UNKNOWN';

export interface BodyIndicators {
  weightKg: number | null;
  heightCm: number | null;
  bmi: number | null;
  waistToHeight: number | null;
  bodyFatPercent: number | null;
  adiposity: Adiposity;
}

interface MeasurementEntry {
  latest: number;
}
type BodySlice = Partial<Record<string, MeasurementEntry>>;

export function bodyIndicators(
  body: BodySlice,
  heightCm: number | null,
  sex: 'MALE' | 'FEMALE' | null,
  rules: NutritionRules,
): BodyIndicators {
  const weightKg = body['WEIGHT']?.latest ?? null;
  const waist = body['WAIST']?.latest ?? null;
  const bodyFatPercent = body['BODY_FAT_PERCENT']?.latest ?? null;
  const bmi =
    weightKg !== null && heightCm ? Math.round((weightKg / (heightCm / 100) ** 2) * 10) / 10 : null;
  const waistToHeight =
    waist !== null && heightCm ? Math.round((waist / heightCm) * 100) / 100 : null;

  let adiposity: Adiposity = 'UNKNOWN';
  const fatThreshold = sex ? rules.bodyFatThresholdPct[sex] : null;
  if (bodyFatPercent !== null && fatThreshold !== null) {
    adiposity =
      bodyFatPercent >= fatThreshold
        ? 'HIGH'
        : bodyFatPercent >= fatThreshold - 8
          ? 'MODERATE'
          : 'LOW';
  } else if (waistToHeight !== null && rules.waistToHeightThreshold !== null) {
    adiposity =
      waistToHeight >= rules.waistToHeightThreshold
        ? 'HIGH'
        : waistToHeight >= rules.waistToHeightThreshold - 0.05
          ? 'MODERATE'
          : 'LOW';
  }
  return { weightKg, heightCm, bmi, waistToHeight, bodyFatPercent, adiposity };
}
