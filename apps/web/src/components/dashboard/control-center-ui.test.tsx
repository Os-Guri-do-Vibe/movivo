import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  controlCenterMeta,
  metric,
  unavailableMetric,
} from '../../../test/control-center-fixtures';
import { ControlCenterApiError } from '@/lib/control-center-api';

import {
  DataQuality,
  EmptyState,
  MetricCard,
  MetricGrid,
  ResourceState,
  SectorHeader,
  useControlCenterResource,
} from './control-center-ui';

function Probe({ load }: { load: (signal?: AbortSignal) => Promise<string> }) {
  const state = useControlCenterResource(load);
  return (
    <div>
      <p data-testid="loading">{String(state.loading)}</p>
      <p data-testid="forbidden">{String(state.forbidden)}</p>
      <p data-testid="error">{state.error}</p>
      <p data-testid="data">{state.data ?? 'sem dado'}</p>
      <button onClick={() => void state.refresh()}>recarregar</button>
    </div>
  );
}

describe('MetricCard', () => {
  it('formata cada unidade no padrão pt-BR', () => {
    render(
      <MetricGrid
        metrics={[
          { label: 'MRR', metric: metric({ value: 1638.5, unit: 'BRL' }) },
          { label: 'Conversão', metric: metric({ value: 24.35, unit: 'PERCENT' }) },
          { label: 'Banco', metric: metric({ value: 18.7, unit: 'MILLISECONDS' }) },
          { label: 'IA', metric: metric({ value: 4.52, unit: 'MINUTES' }) },
          { label: 'Assinaturas', metric: metric({ value: 42, unit: 'COUNT' }) },
        ]}
      />,
    );
    expect(screen.getByLabelText(/^MRR: R\$\s?1\.638,50$/)).toBeVisible();
    expect(screen.getByLabelText('Conversão: 24,4%')).toBeVisible();
    expect(screen.getByLabelText('Banco: 19 ms')).toBeVisible();
    expect(screen.getByLabelText('IA: 4,5 min')).toBeVisible();
    expect(screen.getByLabelText('Assinaturas: 42')).toBeVisible();
  });

  it('mostra travessão e rótulo "Indisponível" em vez de zero inventado', () => {
    render(<MetricCard label="North Star" metric={unavailableMetric} />);
    expect(screen.getByLabelText('North Star: —')).toBeVisible();
    expect(screen.getByText('Indisponível')).toBeVisible();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('marca métrica aproximada como estimativa, não como valor apurado', () => {
    render(<MetricCard label="Custo de IA" metric={metric({ value: 40.9, status: 'PROXY' })} />);
    expect(screen.getByText('Estimativa')).toBeVisible();
    expect(screen.getByLabelText('Custo de IA: 40,9')).toBeVisible();
  });

  it('trata valor nulo mesmo com status disponível como sem amostra', () => {
    render(<MetricCard label="Trials" metric={metric({ value: null })} />);
    expect(screen.getByLabelText('Trials: —')).toBeVisible();
    expect(screen.getByText('Disponível')).toBeVisible();
  });
});

describe('SectorHeader', () => {
  it('exibe o horário da geração no fuso de São Paulo', () => {
    render(
      <SectorHeader
        title="Visão geral"
        description="Sinais da operação."
        meta={controlCenterMeta}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Visão geral' })).toBeVisible();
    expect(screen.getByText('11/08/2026, 12:00')).toHaveAttribute(
      'dateTime',
      controlCenterMeta.generatedAt,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('desabilita o botão enquanto a atualização está em andamento', async () => {
    const onRefresh = vi.fn();
    const { rerender } = render(
      <SectorHeader title="Financeiro" description="Receita." onRefresh={onRefresh} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    expect(onRefresh).toHaveBeenCalledOnce();
    rerender(
      <SectorHeader title="Financeiro" description="Receita." onRefresh={onRefresh} refreshing />,
    );
    expect(screen.getByRole('button', { name: /Atualizando/ })).toBeDisabled();
  });
});

describe('ResourceState', () => {
  it('anuncia o carregamento com status acessível', () => {
    render(<ResourceState loading error="" forbidden={false} onRetry={vi.fn()} />);
    expect(screen.getByRole('status', { name: 'Carregando setor' })).toBeVisible();
  });

  it('não renderiza nada quando não há carregamento nem erro', () => {
    const { container } = render(
      <ResourceState loading={false} error="" forbidden={false} onRetry={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('oferece nova tentativa em falha recuperável', async () => {
    const onRetry = vi.fn();
    render(
      <ResourceState
        loading={false}
        error="Servidor fora do ar."
        forbidden={false}
        onRetry={onRetry}
      />,
    );
    expect(
      screen.getByRole('heading', { name: 'Não foi possível carregar o setor' }),
    ).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('em 403 explica a falta de acesso e não oferece retry', () => {
    render(
      <ResourceState
        loading={false}
        error="Seu papel não pode acessar este setor."
        forbidden
        onRetry={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('heading', { name: 'Este setor não faz parte do seu acesso' }),
    ).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('DataQuality e EmptyState', () => {
  it('lista as ressalvas de qualidade do dado', () => {
    render(<DataQuality notes={['Custo de IA é estimativa.', 'Histórico ainda não coletado.']} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('some quando não há ressalva a declarar', () => {
    const { container } = render(<DataQuality notes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('descreve o vazio com título e orientação', () => {
    render(<EmptyState title="Sem segmentos" description="Grupos pequenos são ocultados." />);
    expect(screen.getByRole('heading', { name: 'Sem segmentos' })).toBeVisible();
    expect(screen.getByText('Grupos pequenos são ocultados.')).toBeVisible();
  });
});

describe('useControlCenterResource', () => {
  it('carrega, expõe o dado e limpa o erro anterior ao recarregar', async () => {
    const load = vi
      .fn<(signal?: AbortSignal) => Promise<string>>()
      .mockRejectedValueOnce(new ControlCenterApiError(500, 'Falhou'))
      .mockResolvedValueOnce('setor');
    render(<Probe load={load} />);
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('Falhou'));
    expect(screen.getByTestId('forbidden')).toHaveTextContent('false');

    await userEvent.click(screen.getByRole('button', { name: 'recarregar' }));
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('setor'));
    expect(screen.getByTestId('error')).toBeEmptyDOMElement();
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('marca forbidden apenas no 403', async () => {
    render(
      <Probe load={vi.fn().mockRejectedValue(new ControlCenterApiError(403, 'Sem acesso'))} />,
    );
    await waitFor(() => expect(screen.getByTestId('forbidden')).toHaveTextContent('true'));
    expect(screen.getByTestId('error')).toHaveTextContent('Sem acesso');
  });

  it('usa mensagem padrão quando a falha não é um Error', async () => {
    render(<Probe load={vi.fn().mockRejectedValue('quebrou')} />);
    await waitFor(() =>
      expect(screen.getByTestId('error')).toHaveTextContent('Não foi possível carregar o setor.'),
    );
  });

  it('ignora aborto: não vira erro visível para o operador', async () => {
    const load = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    render(<Probe load={load} />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('error')).toBeEmptyDOMElement());
    expect(screen.getByTestId('data')).toHaveTextContent('sem dado');
  });

  it('aborta a requisição em andamento ao desmontar', async () => {
    const load = vi.fn((signal?: AbortSignal) => new Promise<string>(() => void signal));
    const { unmount } = render(<Probe load={load} />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    const signal = load.mock.calls[0]![0];
    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
