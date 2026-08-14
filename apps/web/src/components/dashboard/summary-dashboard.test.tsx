import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

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
  ...(await importOriginal<typeof ControlCenterApi>()),
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
  it('na visão geral mostra uma linha-resumo por pilar, sem métrica própria da tela', async () => {
    getOverview.mockResolvedValue(overviewResponse);
    render(<SummaryDashboard resource="overview" />);
    expect(await screen.findByRole('heading', { name: 'Visão geral' })).toBeVisible();
    const rows = screen.getByRole('list', { name: 'Resumo por pilar' });
    expect(within(rows).getByRole('link', { name: /^Alunos/ })).toBeVisible();
    expect(within(rows).getByLabelText('Alunos cadastrados: 25')).toBeVisible();
    expect(within(rows).getByLabelText(/^MRR contratado: R\$\s?1\.638,00$/)).toBeVisible();
    expect(getSystemSummary).not.toHaveBeenCalled();
  });

  it('cada linha leva ao pilar de destino e sinaliza o estado com semáforo', async () => {
    getOverview.mockResolvedValue(overviewResponse);
    render(<SummaryDashboard resource="overview" />);
    const rows = await screen.findByRole('list', { name: 'Resumo por pilar' });

    const alunos = within(rows).getByRole('link', { name: /^Alunos/ });
    expect(alunos).toHaveAttribute('href', '/dashboard/alunos');
    expect(within(alunos).getByText('Atenção')).toBeVisible();
    expect(
      within(alunos).getByText('3 aluno(s) com sinal de risco de cancelamento.'),
    ).toBeVisible();

    const sistema = within(rows).getByRole('link', { name: /^Sistema/ });
    expect(sistema).toHaveAttribute('href', '/dashboard/sistema');
    expect(within(sistema).getByText('Crítico')).toBeVisible();

    const financeiro = within(rows).getByRole('link', { name: /^Financeiro/ });
    expect(within(financeiro).getByText('Tudo certo')).toBeVisible();
  });

  it('não leva os gráficos da visão geral para os outros setores', async () => {
    getSystemSummary.mockResolvedValue(systemResponse);
    render(<SummaryDashboard resource="system" />);
    expect(
      await screen.findByRole('region', { name: 'Indicadores de infraestrutura' }),
    ).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Novos alunos por dia' })).not.toBeInTheDocument();
  });

  it('consulta o setor de sistema e abre pelo SLO board com orçamento de erro', async () => {
    getSystemSummary.mockResolvedValue(systemResponse);
    render(<SummaryDashboard resource="system" />);
    expect(await screen.findByRole('heading', { name: 'Saúde do sistema' })).toBeVisible();
    expect(screen.getByLabelText('Latência do banco: 18 ms')).toBeVisible();

    const board = screen.getByRole('region', { name: 'Objetivos de serviço' });
    // Entre 3 e 5 semáforos, cada um com meta e margem de erro consumida.
    expect(within(board).getAllByRole('article')).toHaveLength(4);
    expect(
      within(board).getByLabelText(
        'Protocolo entregue em até 2 horas: 97 por cento, objetivo 95 por cento, Dentro do objetivo',
      ),
    ).toBeVisible();
    expect(within(board).getByLabelText('Margem de erro consumida: 60 por cento')).toBeVisible();
    expect(within(board).getByText('Fora do objetivo')).toBeVisible();
    // Sem amostra o semáforo não vira verde nem zero.
    expect(within(board).getByText('Sem dados no período')).toBeVisible();
    expect(getOverview).not.toHaveBeenCalled();
  });

  it('publica p50/p95/p99 medidos e separa tempo de modelo de tempo sentido pelo aluno', async () => {
    getSystemSummary.mockResolvedValue(systemResponse);
    render(<SummaryDashboard resource="system" />);
    expect(
      await screen.findByRole('heading', { name: 'Tempo que o aluno espera no WhatsApp' }),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Tempo do modelo de IA' })).toBeVisible();
    expect(screen.getAllByLabelText(/Tempo ruim \(95 de cada 100\)/)).toHaveLength(2);
    expect(screen.getByText('gpt-4.1')).toBeVisible();
    // TASK-7.5.1: o rótulo incorreto de OpenTelemetry saiu deste indicador.
    expect(screen.getByText(/não depende de OpenTelemetry/)).toBeVisible();
  });

  it('uso do RAG e dependências nomeadas em vez de zero', async () => {
    getSystemSummary.mockResolvedValue(systemResponse);
    render(<SummaryDashboard resource="system" />);
    expect(await screen.findByLabelText('Consultas em 30 dias: 340')).toBeVisible();
    expect(screen.getByLabelText('Consultas que acharam material: 62,5%')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Ainda não medimos' })).toBeVisible();
    expect(screen.getByText('Sprint 9')).toBeVisible();
    expect(screen.getByText('Fase 6 — Infraestrutura')).toBeVisible();
  });

  it('consulta o setor financeiro em moeda brasileira', async () => {
    getFinanceSummary.mockResolvedValue(financeResponse);
    render(<SummaryDashboard resource="finance" />);
    expect(await screen.findByRole('heading', { name: 'Financeiro' })).toBeVisible();
    expect(screen.getByLabelText(/^Custo de IA \(30 dias\): R\$\s?40,90$/)).toBeVisible();
    expect(screen.getByLabelText('Receita recebida: —')).toBeVisible();
  });

  it('detalha renovação, risco, churn por motivo, MRR por plano e custo de IA', async () => {
    getFinanceSummary.mockResolvedValue(financeResponse);
    render(<SummaryDashboard resource="finance" />);
    const calendario = await screen.findByRole('region', {
      name: 'Calendário de renovação (90 dias)',
    });
    expect(within(calendario).getByText('08/2026 · Mensal')).toBeVisible();
    expect(within(calendario).getByText(/^R\$\s?468,00$/)).toBeVisible();

    expect(screen.getByText('Sem mensagem recebida há 14 dias')).toBeVisible();
    expect(screen.getByText('PRECO')).toBeVisible();

    const planos = screen.getByRole('region', { name: 'MRR e ARR por plano' });
    expect(within(planos).getByText(/^R\$\s?14\.040,00$/)).toBeVisible();
    expect(screen.getByText('claude-sonnet-4-5')).toBeVisible();
  });

  it('nunca exibe indicador ausente como zero — lucro e CAC vêm rotulados', async () => {
    getFinanceSummary.mockResolvedValue(financeResponse);
    render(<SummaryDashboard resource="finance" />);
    expect(await screen.findByLabelText('Lucro: —')).toBeVisible();
    expect(screen.getByLabelText('CAC: —')).toBeVisible();
    expect(screen.getByLabelText('Distribuição por sócio: —')).toBeVisible();
    expect(
      screen.getByText(/Nenhuma despesa lançada ainda/),
    ).toBeVisible();
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
    expect(await screen.findByLabelText('Alunos cadastrados: 25')).toBeVisible();
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
    expect(screen.getByLabelText('Alunos cadastrados: 25')).toBeVisible();
  });
});
