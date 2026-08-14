import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { financeResponse } from '../../../test/control-center-fixtures';
import type * as ControlCenterApi from '@/lib/control-center-api';

const { getFinanceSummary } = vi.hoisted(() => ({ getFinanceSummary: vi.fn() }));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getFinanceSummary,
}));

import { FinancialProjectionDashboard } from './financial-projection-dashboard';

beforeEach(() => getFinanceSummary.mockReset().mockResolvedValue(financeResponse));

describe('FinancialProjectionDashboard', () => {
  it('separa realizado, base e os tres cenarios projetados', async () => {
    render(<FinancialProjectionDashboard />);
    expect(await screen.findByText('Realizado · mês corrente')).toBeVisible();
    expect(screen.getByText('Base de cálculo')).toBeVisible();
    expect(screen.getByText('Conservador')).toBeVisible();
    expect(screen.getByText('Base')).toBeVisible();
    expect(screen.getByText('Otimista')).toBeVisible();
    expect(screen.getAllByText('R$ 3.750,00')).toHaveLength(3);
  });
});
