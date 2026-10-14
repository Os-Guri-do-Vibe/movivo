import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlCenterOverviewResponse } from '@movivo/shared';

import type * as ControlCenterApi from '@/lib/control-center-api';

import { overviewResponse } from '../../../test/control-center-fixtures';

const { getOverview } = vi.hoisted(() => ({ getOverview: vi.fn() }));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getOverview,
}));

import { ControlCenterApiError } from '@/lib/control-center-api';

import { OverviewDashboard } from './overview-dashboard';

beforeEach(() => {
  getOverview.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Variante do payload com um subconjunto de pilares e ajustes de estado. */
function withPillars(
  keep: ControlCenterOverviewResponse['data']['pillars'][number]['pillar'][],
): ControlCenterOverviewResponse {
  return {
    ...overviewResponse,
    data: { pillars: overviewResponse.data.pillars.filter((p) => keep.includes(p.pillar)) },
  };
}

describe('OverviewDashboard', () => {
  it('abre pelo Financeiro em destaque e mostra o MRR com a fração recuada', async () => {
    getOverview.mockResolvedValue(overviewResponse);
    render(<OverviewDashboard />);
    expect(await screen.findByRole('heading', { name: 'Visão Geral' })).toBeVisible();

    const hero = screen.getByRole('region', { name: 'Financeiro' });
    expect(within(hero).getByLabelText(/^MRR contratado: R\$\s?1\.638,00$/)).toBeVisible();
    // Os três que ameaçam o MRR vêm dentro do destaque.
    expect(within(hero).getByText('Receita em risco (30 dias)')).toBeVisible();
    expect(within(hero).getByText('Inadimplência')).toBeVisible();
    expect(within(hero).getByText('4%')).toBeVisible();
  });

  it('cada pilar mostra a âncora e os números essenciais do seu recorte', async () => {
    getOverview.mockResolvedValue(overviewResponse);
    render(<OverviewDashboard />);
    await screen.findByRole('heading', { name: 'Visão Geral' });

    const alunos = screen.getByRole('region', { name: 'Alunos' });
    expect(
      within(alunos).getByLabelText('Treinos nos primeiros 30 dias pagos (meta ≥8): 5,5'),
    ).toBeVisible();
    expect(within(alunos).getByText('Taxa de reporte de treino')).toBeVisible();
    expect(within(alunos).getByText('Em risco de cancelamento')).toBeVisible();
    expect(within(alunos).getByText('Alertas de segurança e PAR-Q bloqueado')).toBeVisible();

    const marketing = screen.getByRole('region', { name: 'Marketing' });
    expect(within(marketing).getByLabelText('Cadastros iniciados: 120')).toBeVisible();
    expect(within(marketing).getByText('Conversão do trial')).toBeVisible();
    expect(within(marketing).getByText('CAC do canal principal (meta_ads)')).toBeVisible();

    const ia = screen.getByRole('region', { name: 'IA' });
    expect(within(ia).getByLabelText('Resposta bloqueada pela validação: 1,2%')).toBeVisible();
    expect(within(ia).getByText('9.000 ms')).toBeVisible();
    expect(within(ia).getByText('Masculina v3 · Feminina v2')).toBeVisible();
  });

  it('Sistema mostra o pior SLO, o anel de margem de erro e a conexão do WhatsApp', async () => {
    getOverview.mockResolvedValue(overviewResponse);
    render(<OverviewDashboard />);
    await screen.findByRole('heading', { name: 'Visão Geral' });

    const sistema = screen.getByRole('region', { name: 'Sistema' });
    expect(
      within(sistema).getByLabelText('Trabalhos que não viraram tarefa manual: 90%'),
    ).toBeVisible();
    expect(
      within(sistema).getByRole('img', { name: 'Margem de erro consumida: 120%' }),
    ).toBeVisible();
    expect(within(sistema).getByText('WhatsApp')).toBeVisible();
    expect(within(sistema).getByText('Conectado')).toBeVisible();
    expect(within(sistema).getByText('Crítico')).toBeVisible();
  });

  it('cada cartão leva ao pilar de destino e o estado vem em texto, não só em cor', async () => {
    getOverview.mockResolvedValue(overviewResponse);
    render(<OverviewDashboard />);
    await screen.findByRole('heading', { name: 'Visão Geral' });

    const alunos = screen.getByRole('region', { name: 'Alunos' });
    expect(within(alunos).getByRole('link', { name: 'Alunos' })).toHaveAttribute(
      'href',
      '/dashboard/alunos',
    );
    expect(within(alunos).getByText('Atenção')).toBeVisible();

    const financeiro = screen.getByRole('region', { name: 'Financeiro' });
    expect(within(financeiro).getByText('Tudo certo')).toBeVisible();
  });

  it('"Atenção agora" lista só pilares fora do OK, críticos primeiro, e leva ao mais urgente', async () => {
    getOverview.mockResolvedValue(overviewResponse);
    render(<OverviewDashboard />);
    await screen.findByRole('heading', { name: 'Visão Geral' });

    const atencao = screen.getByRole('region', { name: 'Atenção agora' });
    expect(within(atencao).getByText('2 pilares pedem ação')).toBeVisible();
    const items = within(atencao).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Sistema:');
    expect(items[1]).toHaveTextContent('Alunos: 3 aluno(s) com sinal de risco de cancelamento.');
    expect(within(atencao).getByRole('link', { name: /Ver Sistema/ })).toHaveAttribute(
      'href',
      '/dashboard/sistema',
    );
  });

  it('com todos os pilares OK diz que está tudo certo e não oferece ação', async () => {
    getOverview.mockResolvedValue({
      ...overviewResponse,
      data: {
        pillars: overviewResponse.data.pillars.map((pillar) => ({
          ...pillar,
          state: 'OK' as const,
          reason: null,
        })),
      },
    });
    render(<OverviewDashboard />);
    await screen.findByRole('heading', { name: 'Visão Geral' });

    const atencao = screen.getByRole('region', { name: 'Atenção agora' });
    expect(within(atencao).getByText(/Nenhum pilar pede ação agora/)).toBeVisible();
    expect(within(atencao).queryByRole('link')).not.toBeInTheDocument();
  });

  it('indicador indisponível aparece como traço, nunca como zero', async () => {
    const [students, ...rest] = overviewResponse.data.pillars;
    if (!students) throw new Error('fixture sem pilar de alunos');
    getOverview.mockResolvedValue({
      ...overviewResponse,
      data: {
        pillars: [
          {
            ...students,
            headline: {
              ...students.headline,
              metric: {
                value: null,
                unit: 'COUNT',
                status: 'UNAVAILABLE',
                definition: 'Sem coorte.',
              },
            },
          },
          ...rest,
        ],
      },
    });
    render(<OverviewDashboard />);
    await screen.findByRole('heading', { name: 'Visão Geral' });
    expect(
      within(screen.getByRole('region', { name: 'Alunos' })).getByLabelText(
        'Treinos nos primeiros 30 dias pagos (meta ≥8): —',
      ),
    ).toBeVisible();
  });

  it('para um papel sem Financeiro, o destaque passa ao primeiro pilar disponível', async () => {
    getOverview.mockResolvedValue(withPillars(['STUDENTS']));
    render(<OverviewDashboard />);
    await screen.findByRole('heading', { name: 'Visão Geral' });
    expect(screen.getByRole('region', { name: 'Alunos' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Financeiro' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Sistema' })).not.toBeInTheDocument();
  });

  it('para um papel só com Sistema, mostra o cartão largo sem destaque', async () => {
    getOverview.mockResolvedValue(withPillars(['SYSTEM']));
    render(<OverviewDashboard />);
    await screen.findByRole('heading', { name: 'Visão Geral' });
    expect(screen.getByRole('region', { name: 'Sistema' })).toBeVisible();
    expect(screen.getAllByRole('region', { name: 'Sistema' })).toHaveLength(1);
  });

  it('em 403 mostra o aviso de acesso sem oferecer nova tentativa', async () => {
    getOverview.mockRejectedValueOnce(
      new ControlCenterApiError(403, 'Seu papel não pode acessar este setor.'),
    );
    render(<OverviewDashboard />);
    expect(
      await screen.findByRole('heading', { name: 'Este setor não faz parte do seu acesso' }),
    ).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('recupera de falha transitória pela nova tentativa', async () => {
    getOverview
      .mockRejectedValueOnce(new ControlCenterApiError(500, 'Servidor indisponível.'))
      .mockResolvedValueOnce(overviewResponse);
    render(<OverviewDashboard />);
    await userEvent.click(await screen.findByRole('button', { name: /tentar novamente/i }));
    expect(await screen.findByRole('region', { name: 'Financeiro' })).toBeVisible();
  });

  it('mantém o último dado válido e avisa quando a atualização seguinte falha', async () => {
    getOverview
      .mockResolvedValueOnce(overviewResponse)
      .mockRejectedValueOnce(new ControlCenterApiError(500, 'Servidor indisponível.'));
    render(<OverviewDashboard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Atualizar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A última atualização falhou: Servidor indisponível.',
    );
    expect(screen.getByRole('region', { name: 'Financeiro' })).toBeVisible();
  });

  it('atualiza sozinha a cada minuto enquanto a aba está visível, e pausa quando oculta', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getOverview.mockResolvedValue(overviewResponse);
    render(<OverviewDashboard />);
    await screen.findByRole('heading', { name: 'Visão Geral' });
    expect(getOverview).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getOverview).toHaveBeenCalledTimes(2);

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getOverview).toHaveBeenCalledTimes(2);
    visibility.mockRestore();
  });
});
