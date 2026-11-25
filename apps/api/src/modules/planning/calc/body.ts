/**
 * Indicadores corporais derivados das medidas do aluno (determinísticos).
 *
 * A adiposidade usada na estratégia sai daqui, com os limiares publicados pelo nutricionista,
 * pela ordem de confiabilidade: % de gordura medido; faixa estimada pela avaliação visual das
 * fotos (ponto médio da faixa); relação cintura/altura. A foto sozinha é estimativa e não
 * "decide": ela entra como a melhor leitura disponível quando não há medida direta, e a
 * `adiposityBasis` informa de onde veio. Sem dado suficiente o resultado é `UNKNOWN` — e o
 * agente deve dizer o que falta saber em vez de supor.
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
  adiposityBasis: 'MEASURED_BODY_FAT' | 'PHOTO_ESTIMATE' | 'WAIST_TO_HEIGHT' | null;
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
  visualBodyFatRange: { min: number; max: number } | null = null,
): BodyIndicators {
  const weightKg = body['WEIGHT']?.latest ?? null;
  const waist = body['WAIST']?.latest ?? null;
  const bodyFatPercent = body['BODY_FAT_PERCENT']?.latest ?? null;
  const bmi =
    weightKg !== null && heightCm ? Math.round((weightKg / (heightCm / 100) ** 2) * 10) / 10 : null;
  const waistToHeight =
    waist !== null && heightCm ? Math.round((waist / heightCm) * 100) / 100 : null;

  let adiposity: Adiposity = 'UNKNOWN';
  let adiposityBasis: BodyIndicators['adiposityBasis'] = null;
  const fatThreshold = sex ? rules.bodyFatThresholdPct[sex] : null;
  const classify = (percent: number, threshold: number): Adiposity =>
    percent >= threshold ? 'HIGH' : percent >= threshold - 8 ? 'MODERATE' : 'LOW';
  if (bodyFatPercent !== null && fatThreshold !== null) {
    adiposity = classify(bodyFatPercent, fatThreshold);
    adiposityBasis = 'MEASURED_BODY_FAT';
  } else if (visualBodyFatRange !== null && fatThreshold !== null) {
    adiposity = classify((visualBodyFatRange.min + visualBodyFatRange.max) / 2, fatThreshold);
    adiposityBasis = 'PHOTO_ESTIMATE';
  } else if (waistToHeight !== null && rules.waistToHeightThreshold !== null) {
    adiposity =
      waistToHeight >= rules.waistToHeightThreshold
        ? 'HIGH'
        : waistToHeight >= rules.waistToHeightThreshold - 0.05
          ? 'MODERATE'
          : 'LOW';
    adiposityBasis = 'WAIST_TO_HEIGHT';
  }
  return { weightKg, heightCm, bmi, waistToHeight, bodyFatPercent, adiposity, adiposityBasis };
}
