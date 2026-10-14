/**
 * Estatísticas de custos/uso por titular.
 *
 * Custos individuais são assimétricos: a média estima o total esperado, enquanto P50/P90/P95
 * descrevem o caso típico e a cauda. O intervalo da média usa bootstrap percentual e só é
 * publicado com uma base minimamente madura; antes disso, esconder a incerteza seria pior que
 * não exibir uma previsão.
 */
export interface CostDistribution {
  samples: number;
  total: number;
  mean: number;
  median: number;
  p90: number;
  p95: number;
  /** Curva acumulada em marcos de 5 p.p.; não expõe nenhum titular individual. */
  cdf: Array<{ percentile: number; value: number }>;
  meanConfidence95: { lower: number; upper: number } | null;
}

const BOOTSTRAP_RESAMPLES = 1_000;
const MINIMUM_SAMPLES_FOR_CONFIDENCE_INTERVAL = 50;
const CDF_PERCENTILES = Array.from({ length: 21 }, (_, index) => index / 20);

const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/** Percentil por interpolação linear, inclusive para amostras pequenas. */
function percentile(sorted: readonly number[], ratio: number): number {
  const index = (sorted.length - 1) * ratio;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  const lowValue = sorted[low];
  const highValue = sorted[high];
  if (lowValue === undefined || highValue === undefined) throw new Error('Percentil sem amostra.');
  return lowValue + (highValue - lowValue) * (index - low);
}

/** Gerador determinístico: o painel não pode mudar o IC sem os dados mudarem. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

function bootstrapMeanConfidence95(
  values: readonly number[],
): { lower: number; upper: number } | null {
  if (values.length < MINIMUM_SAMPLES_FOR_CONFIDENCE_INTERVAL) return null;
  const seed = values.reduce(
    (value, item, index) => value + Math.round(item * 100) * (index + 1),
    values.length,
  );
  const random = seededRandom(seed);
  const means = Array.from({ length: BOOTSTRAP_RESAMPLES }, () => {
    let sum = 0;
    for (let index = 0; index < values.length; index += 1) {
      const sampled = values[Math.floor(random() * values.length)];
      if (sampled === undefined) throw new Error('Bootstrap sem amostra.');
      sum += sampled;
    }
    return sum / values.length;
  }).sort((a, b) => a - b);
  return { lower: percentile(means, 0.025), upper: percentile(means, 0.975) };
}

export function summarizeCostDistribution(values: readonly number[]): CostDistribution | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: values.length,
    total: values.reduce((sum, value) => sum + value, 0),
    mean: mean(values),
    median: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    cdf: CDF_PERCENTILES.map((ratio) => ({
      percentile: ratio * 100,
      value: percentile(sorted, ratio),
    })),
    meanConfidence95: bootstrapMeanConfidence95(values),
  };
}
