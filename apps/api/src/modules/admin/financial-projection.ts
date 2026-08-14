import type { FinancialProjection } from '@movivo/shared';

interface CostMonth {
  month: string;
  amountBrl: number;
}

interface RevenueMonth {
  month: string;
  grossBrl: number;
}

const SCENARIOS = [
  { scenario: 'CONSERVATIVE', revenueFactor: 0.9, costFactor: 1.1 },
  { scenario: 'BASE', revenueFactor: 1, costFactor: 1 },
  { scenario: 'OPTIMISTIC', revenueFactor: 1.1, costFactor: 0.95 },
] as const;

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function nextMonths(currentMonth: string): [string, string, string] {
  const [year = 0, month = 1] = currentMonth.split('-').map(Number);
  return [1, 2, 3].map((offset) => {
    const date = new Date(Date.UTC(year, month - 1 + offset, 1));
    return date.toISOString().slice(0, 7);
  }) as [string, string, string];
}

/**
 * ponytail: media de tres meses e o modelo explicavel que o volume atual sustenta; quando
 * houver ao menos 12 meses, evoluir por decisao do CFO para sazonalidade/tendencia versionada.
 */
export function buildFinancialProjection(
  costByMonth: readonly CostMonth[],
  revenueByMonth: readonly RevenueMonth[],
  currentMonth: string,
): FinancialProjection {
  const costs = new Map(costByMonth.map((row) => [row.month, row.amountBrl]));
  const revenues = new Map(revenueByMonth.map((row) => [row.month, row.grossBrl]));
  const basisMonths = [...costs.keys()]
    .filter((month) => month < currentMonth && revenues.has(month))
    .sort()
    .slice(-3);
  const method =
    'Media mensal de ate 3 meses fechados com custo e receita recebida. Conservador: receita -10% e custo +10%; base: media; otimista: receita +10% e custo -5%.';
  if (basisMonths.length === 0) {
    return {
      status: 'UNAVAILABLE',
      basisMonths,
      horizonMonths: 3,
      method,
      reason: 'Nao ha mes fechado com custo e receita recebida para formar a base.',
      scenarios: [],
    };
  }
  const baseRevenue =
    basisMonths.reduce((sum, month) => sum + (revenues.get(month) ?? 0), 0) / basisMonths.length;
  const baseCost =
    basisMonths.reduce((sum, month) => sum + (costs.get(month) ?? 0), 0) / basisMonths.length;
  const horizon = nextMonths(currentMonth);
  const scenarios = SCENARIOS.map((scenario) => {
    const months = horizon.map((month) => {
      const projectedRevenueBrl = money(baseRevenue * scenario.revenueFactor);
      const projectedCostBrl = money(baseCost * scenario.costFactor);
      return {
        month,
        projectedRevenueBrl,
        projectedCostBrl,
        projectedResultBrl: money(projectedRevenueBrl - projectedCostBrl),
      };
    });
    return {
      ...scenario,
      months,
      totalRevenueBrl: money(months.reduce((sum, month) => sum + month.projectedRevenueBrl, 0)),
      totalCostBrl: money(months.reduce((sum, month) => sum + month.projectedCostBrl, 0)),
      totalResultBrl: money(months.reduce((sum, month) => sum + month.projectedResultBrl, 0)),
    };
  });
  return {
    status: 'AVAILABLE',
    basisMonths,
    horizonMonths: 3,
    method,
    reason: null,
    scenarios,
  };
}
