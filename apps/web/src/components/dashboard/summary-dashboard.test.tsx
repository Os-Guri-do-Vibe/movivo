import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

import { financeResponse, systemResponse } from '../../../test/control-center-fixtures';

const { getSystemSummary, getFinanceSummary } = vi.hoisted(() => ({
  getSystemSummary: vi.fn(),
  getFinanceSummary: vi.fn(),
}));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getSystemSummary,
  getFinanceSummary,
}));

import { SummaryDashboard } from './summary-dashboard';

beforeEach(() => {
  getSystemSummary.mockReset();
  getFinanceSummary.mockReset();
});

describe('SummaryDashboard', () => {
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
    expect(await screen.findByRole('heading', { name: 'Saúde & Disponibilidade' })).toBeVisible();
    expect(screen.getByLabelText('Latência do banco: 18 ms')).toBeVisible();

    const board = screen.getByRole('region', { name: 'Objetivos de serviço' });
    // Entre 3 e 5 semáforos, cada um com meta e margem de erro consumida.
    expect(within(board).getAllByRole('article')).toHaveLength(4);
    expect(
      within(board).getByLabelText(
        'Plano entregue em até 2 horas: 97 por cento, objetivo 95 por cento, Dentro do objetivo',
      ),
    ).toBeVisible();
    expect(within(board).getByLabelText('Margem de erro consumida: 60 por cento')).toBeVisible();
    expect(within(board).getByText('Fora do objetivo')).toBeVisible();
    // Sem amostra o semáforo não vira verde nem zero.
    expect(within(board).getByText('Sem dados no período')).toBeVisible();
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

  it('dependências ainda não medidas aparecem nomeadas em vez de zero', async () => {
    getSystemSummary.mockResolvedValue(systemResponse);
    render(<SummaryDashboard resource="system" />);
    expect(await screen.findByRole('heading', { name: 'Ainda não medimos' })).toBeVisible();
    expect(screen.getByText('Sprint 9')).toBeVisible();
    expect(screen.getByText('Fase 6 — Infraestrutura')).toBeVisible();
  });

  it('consulta o setor financeiro em moeda brasileira', async () => {
    getFinanceSummary.mockResolvedValue(financeResponse);
    render(<SummaryDashboard resource="finance" />);
    expect(await screen.findByRole('heading', { name: 'Receita & Assinaturas' })).toBeVisible();
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

  it('explica média, percentis e a limitação de preço nas métricas de custo por usuário', async () => {
    getFinanceSummary.mockResolvedValue(financeResponse);
    render(<SummaryDashboard resource="finance" />);

    const costs = await screen.findByRole('region', { name: 'Inteligência de custos por usuário' });
    expect(within(costs).getByText('Custo de IA por usuário-dia')).toBeVisible();
    expect(within(costs).getByText('Custo de IA por usuário ativo')).toBeVisible();
    expect(within(costs).getAllByText('Mediana (P50)')).toHaveLength(2);
    expect(within(costs).getByText('Curva acumulada de custo')).toBeVisible();
    fireEvent.click(
      within(costs).getByLabelText('Como interpretar Unidades WhatsApp por usuário ativo'),
    );
    expect(within(costs).getByText(/Evolution não gera cobrança/)).toBeVisible();
    expect(within(costs).getAllByText(/50 titulares/)).toHaveLength(3);
  });

  it('nunca exibe indicador ausente como zero — CAC e distribuição vêm rotulados', async () => {
    getFinanceSummary.mockResolvedValue(financeResponse);
    render(<SummaryDashboard resource="finance" />);
    expect(await screen.findByLabelText('CAC: —')).toBeVisible();
    expect(screen.getByLabelText('Distribuição por sócio: —')).toBeVisible();
  });
});
