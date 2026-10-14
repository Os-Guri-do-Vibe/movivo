import { describe, expect, it } from 'vitest';

import { summarizeCostDistribution } from './cost-distribution';

describe('summarizeCostDistribution', () => {
  it('separa custo esperado, caso típico e cauda', () => {
    const summary = summarizeCostDistribution([0, 0, 1, 1, 8]);

    expect(summary).toMatchObject({ samples: 5, total: 10, mean: 2, median: 1, meanConfidence95: null });
    expect(summary?.p90).toBeCloseTo(5.2);
    expect(summary?.p95).toBeCloseTo(6.6);
    expect(summary?.cdf).toHaveLength(21);
    expect(summary?.cdf.at(0)).toEqual({ percentile: 0, value: 0 });
    expect(summary?.cdf.at(-1)).toEqual({ percentile: 100, value: 8 });
  });

  it('só publica intervalo bootstrap com base madura e é determinístico', () => {
    const values = Array.from({ length: 50 }, (_, index) => index % 7);
    const first = summarizeCostDistribution(values);
    const second = summarizeCostDistribution(values);

    expect(first?.meanConfidence95).not.toBeNull();
    expect(second?.meanConfidence95).toEqual(first?.meanConfidence95);
  });
});
