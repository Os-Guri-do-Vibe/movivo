import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

const { getCampaigns } = vi.hoisted(() => ({ getCampaigns: vi.fn() }));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getCampaigns,
}));

import { CampaignsDashboard } from './campaigns-dashboard';

const metric = (value: number, unit: 'BRL' | 'RATIO' | 'MONTHS') => ({
  value,
  unit,
  status: 'AVAILABLE' as const,
  definition: 'formula conferida',
});

beforeEach(() => {
  getCampaigns.mockReset().mockResolvedValue({
    data: {
      campaigns: [
        {
          campaign: 'lancamento_agosto',
          channel: 'meta_ads',
          students: 12,
          converted: 3,
          investmentBrl: 1200,
          investmentStatus: 'INVESTED',
          cac: metric(400, 'BRL'),
          receivedRevenue: metric(2400, 'BRL'),
          roas: metric(2, 'RATIO'),
          ltv: metric(800, 'BRL'),
          ltvToCac: metric(2, 'RATIO'),
          paybackMonths: metric(1, 'MONTHS'),
          signal: 'ATTENTION',
        },
      ],
      suppressedCampaigns: 1,
      minimumSegmentSize: 10,
      attributionWindowDays: 60,
      matureCohorts: 1,
      mediaInvestmentBrl: 1290,
    },
    meta: {
      generatedAt: '2026-08-14T12:00:00.000Z',
      timezone: 'America/Sao_Paulo',
      dataQuality: [],
    },
  });
});

describe('CampaignsDashboard', () => {
  it('exibe a economia e torna a supressao e a baixa confianca visiveis', async () => {
    render(<CampaignsDashboard />);
    expect(await screen.findByText('lancamento_agosto')).toBeVisible();
    expect(screen.getByText(/1 campanha\(s\) suprimida\(s\)/)).toBeVisible();
    expect(screen.getByText(/Baixa confianca/)).toBeVisible();
    expect(screen.getByText('R$ 400,00')).toBeVisible();
  });
});
