/**
 * Testes de Sócios & Distribuição (US-8.7).
 *
 * O comportamento que importa: o número nunca aparece sozinho (as ressalvas vêm do
 * payload), e quando não há lucro apurado a tela mostra "—" em vez de fabricar R$ 0,00.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

import { partnerDistributionResponse } from '../../../test/control-center-fixtures';

const { getPartnerDistribution } = vi.hoisted(() => ({ getPartnerDistribution: vi.fn() }));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getPartnerDistribution,
}));

import { ControlCenterApiError } from '@/lib/control-center-api';

import { PartnersDashboard } from './partners-dashboard';

beforeEach(() => getPartnerDistribution.mockReset());

describe('PartnersDashboard', () => {
  it('mostra lucro, participação em pontos-base e o total do cap table', async () => {
    getPartnerDistribution.mockResolvedValue(partnerDistributionResponse);
    render(<PartnersDashboard />);

    expect(await screen.findByRole('heading', { name: 'Sócios & Distribuição' })).toBeVisible();
    expect(screen.getByText('Lucro apurado · 2026-08')).toBeVisible();
    expect(screen.getAllByText('R$ 5.000,00').length).toBeGreaterThan(0);

    const rows = within(screen.getByRole('table')).getAllByRole('row');
    const first = rows[1];
    if (!first) throw new Error('tabela sem linha de sócio');
    expect(within(first).getByText('Rodrigo')).toBeVisible();
    expect(within(first).getByText('60,00%')).toBeVisible();
    expect(within(first).getByText('R$ 3.000,00')).toBeVisible();
    expect(screen.getByText('100,00%')).toBeVisible();
  });

  it('nunca exibe o número sem as ressalvas de governança que vieram do payload', async () => {
    getPartnerDistribution.mockResolvedValue(partnerDistributionResponse);
    render(<PartnersDashboard />);
    const caveats = within(
      await screen.findByRole('complementary', { name: 'O que este número não é' }),
    ).getAllByRole('listitem');
    expect(caveats).toHaveLength(partnerDistributionResponse.data.caveats.length);
    expect(caveats[0]).toHaveTextContent('Não considera vesting');
  });

  it('sem lucro apurado mostra travessão em vez de R$ 0,00', async () => {
    getPartnerDistribution.mockResolvedValue({
      ...partnerDistributionResponse,
      data: { ...partnerDistributionResponse.data, profitAvailable: false, profitCents: 0 },
    });
    render(<PartnersDashboard />);
    await screen.findByRole('table');
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText('R$ 0,00')).not.toBeInTheDocument();
  });

  it('em 403 não oferece nova tentativa', async () => {
    getPartnerDistribution.mockRejectedValueOnce(
      new ControlCenterApiError(403, 'Sem acesso ao cap table.'),
    );
    render(<PartnersDashboard />);
    expect(
      await screen.findByRole('heading', { name: 'Este setor não faz parte do seu acesso' }),
    ).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('avisa falha de atualização preservando a distribuição já carregada', async () => {
    getPartnerDistribution
      .mockResolvedValueOnce(partnerDistributionResponse)
      .mockRejectedValueOnce(new ControlCenterApiError(500, 'Servidor indisponível.'));
    render(<PartnersDashboard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Atualizar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Servidor indisponível.');
    expect(screen.getByRole('table')).toBeVisible();
  });
});
