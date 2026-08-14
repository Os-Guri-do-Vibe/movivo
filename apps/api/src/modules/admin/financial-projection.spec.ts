import { describe, expect, it } from 'vitest';

import { buildFinancialProjection } from './financial-projection';

describe('buildFinancialProjection', () => {
  it('usa tres meses fechados e confere os tres cenarios sem tolerancia', () => {
    const result = buildFinancialProjection(
      [
        { month: '2026-04', amountBrl: 800 },
        { month: '2026-05', amountBrl: 1000 },
        { month: '2026-06', amountBrl: 1200 },
        { month: '2026-07', amountBrl: 9999 },
      ],
      [
        { month: '2026-04', grossBrl: 1800 },
        { month: '2026-05', grossBrl: 2000 },
        { month: '2026-06', grossBrl: 2200 },
        { month: '2026-07', grossBrl: 9999 },
      ],
      '2026-07',
    );
    expect(result.basisMonths).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(result.scenarios).toEqual([
      {
        scenario: 'CONSERVATIVE',
        revenueFactor: 0.9,
        costFactor: 1.1,
        months: ['2026-08', '2026-09', '2026-10'].map((month) => ({
          month,
          projectedRevenueBrl: 1800,
          projectedCostBrl: 1100,
          projectedResultBrl: 700,
        })),
        totalRevenueBrl: 5400,
        totalCostBrl: 3300,
        totalResultBrl: 2100,
      },
      {
        scenario: 'BASE',
        revenueFactor: 1,
        costFactor: 1,
        months: ['2026-08', '2026-09', '2026-10'].map((month) => ({
          month,
          projectedRevenueBrl: 2000,
          projectedCostBrl: 1000,
          projectedResultBrl: 1000,
        })),
        totalRevenueBrl: 6000,
        totalCostBrl: 3000,
        totalResultBrl: 3000,
      },
      {
        scenario: 'OPTIMISTIC',
        revenueFactor: 1.1,
        costFactor: 0.95,
        months: ['2026-08', '2026-09', '2026-10'].map((month) => ({
          month,
          projectedRevenueBrl: 2200,
          projectedCostBrl: 950,
          projectedResultBrl: 1250,
        })),
        totalRevenueBrl: 6600,
        totalCostBrl: 2850,
        totalResultBrl: 3750,
      },
    ]);
  });

  it('fica indisponivel sem mes fechado presente nas duas series', () => {
    const result = buildFinancialProjection(
      [{ month: '2026-06', amountBrl: 100 }],
      [{ month: '2026-07', grossBrl: 200 }],
      '2026-07',
    );
    expect(result).toMatchObject({ status: 'UNAVAILABLE', scenarios: [] });
  });
});
