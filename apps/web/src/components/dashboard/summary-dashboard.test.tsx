import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  financeResponse,
  overviewResponse,
  systemResponse,
} from '../../../test/control-center-fixtures';

const { getOverview, getSystemSummary, getFinanceSummary } = vi.hoisted(() => ({
  getOverview: vi.fn(),
  getSystemSummary: vi.fn(),
  getFinanceSummary: vi.fn(),
}));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/control-center-api')>()),
  getOverview,
  getSystemSummary,
  getFinanceSummary,
}));

import { ControlCenterApiError } from '@/lib/control-center-api';

import { SummaryDashboard } from './summary-dashboard';

beforeEach(() => {
  getOverview.mockReset();
  getSystemSummary.mockReset();
  getFinanceSummary.mockReset();
});

describe('SummaryDashboard', () => {
  it('na visão geral mostra métricas apuradas e o North Star sem amostra como travessão', async () => {
    getOverview.mockResolvedValue(overviewResponse);
    render(<SummaryDashboard resource="overview" />);
    expect(await screen.findByRole('heading', { name: 'Visão geral' })).toBeVisible();
    expect(screen.getByLabelText('Assinaturas ativas: 42')).toBeVisible();
    expect(screen.getByLabelText(/^MRR contratado: R\$\s?1\.638,00$/)).toBeVisible();
    expect(screen.getByLabelText('North Star: —')).toBeVisible();
    expect(screen.getByText(/Custo de IA ainda é estimativa/)).toBeVisible();
    expect(getSystemSummary).not.toHaveBeenCalled();
  });

  it('consulta o setor de sistema e diferencia estimativa de valor indisponível', async () => {
    getSystemSummary.mockResolvedValue(systemResponse);
    render(<SummaryDashboard resource="system" />);
    expect(await screen.findByRole('heading', { name: 'Saúde do sistema' })).toBeVisible();
    expect(screen.getByLabelText('Latência do banco: 18 ms')).toBeVisible();
    expect(screen.getByLabelText('Latência média da IA: 4,5 min')).toBeVisible();
    expect(screen.getByLabelText('Custo de infraestrutura: —')).toBeVisible();
    expect(screen.getAllByText('Estimativa')).toHaveLength(2);
    expect(getOverview).not.toHaveBeenCalled();
  });

  it('consulta o setor financeiro em moeda brasileira', async () => {
    getFinanceSummary.mockResolvedValue(financeResponse);
    render(<SummaryDashboard resource="finance" />);
    expect(await screen.findByRole('heading', { name: 'Financeiro' })).toBeVisible();
    expect(screen.getByLabelText(/^Custo de IA: R\$\s?40,90$/)).toBeVisible();
    expect(screen.getByLabelText('Receita recebida: —')).toBeVisible();
  });

  it('em 403 mostra o aviso de acesso sem oferecer nova tentativa', async () => {
    getOverview.mockRejectedValueOnce(
      new ControlCenterApiError(403, 'Seu papel não pode acessar este setor.'),
    );
    render(<SummaryDashboard resource="overview" />);
    expect(
      await screen.findByRole('heading', { name: 'Este setor não faz parte do seu acesso' }),
    ).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('recupera de falha transitória pela nova tentativa', async () => {
    getOverview
      .mockRejectedValueOnce(new ControlCenterApiError(500, 'Servidor indisponível.'))
      .mockResolvedValueOnce(overviewResponse);
    render(<SummaryDashboard resource="overview" />);
    await userEvent.click(await screen.findByRole('button', { name: /tentar novamente/i }));
    expect(await screen.findByLabelText('Assinaturas ativas: 42')).toBeVisible();
  });

  it('mantém o último dado válido e avisa quando a atualização seguinte falha', async () => {
    getOverview
      .mockResolvedValueOnce(overviewResponse)
      .mockRejectedValueOnce(new ControlCenterApiError(500, 'Servidor indisponível.'));
    render(<SummaryDashboard resource="overview" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Atualizar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A última atualização falhou: Servidor indisponível.',
    );
    expect(screen.getByLabelText('Assinaturas ativas: 42')).toBeVisible();
  });
});
