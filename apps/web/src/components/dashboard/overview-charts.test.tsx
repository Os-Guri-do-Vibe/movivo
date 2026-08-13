import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ControlCenterHeatmapCell, ControlCenterTimeSeriesPoint } from '@movivo/shared';

import { ActivityHeatmap, DailySeriesChart, ProtocolStatusBreakdown } from './overview-charts';

const START = new Date('2026-07-13T00:00:00Z');
const newStudentsDaily: ControlCenterTimeSeriesPoint[] = Array.from({ length: 30 }, (_, i) => {
  const date = new Date(START.getTime() + i * 86_400_000).toISOString().slice(0, 10);
  return { date, value: i === 29 ? 6 : 0 };
});
const messageActivityHeatmap: ControlCenterHeatmapCell[] = Array.from(
  { length: 7 * 24 },
  (_, i) => ({
    dayOfWeek: Math.floor(i / 24),
    hour: i % 24,
    value: Math.floor(i / 24) === 1 && i % 24 === 8 ? 40 : 0,
  }),
);
const protocolsByApprovalStatus = [
  { status: 'PENDING_REVIEW', count: 6 },
  { status: 'AUTO_APPROVED', count: 14 },
];

describe('DailySeriesChart', () => {
  it('soma o período, desenha a linha e expõe o valor exato de cada dia fora da cor', () => {
    render(
      <DailySeriesChart
        title="Novos alunos por dia"
        description="Titulares que concluíram o cadastro."
        points={newStudentsDaily}
        unit="novos alunos"
      />,
    );
    const total = newStudentsDaily.reduce((sum, point) => sum + point.value, 0);
    expect(screen.getByText(`${total} em 30 dias`)).toBeVisible();
    // Um título por dia: o desenho nunca é a única via para o número.
    expect(screen.getAllByTitle(/novos alunos$/)).toHaveLength(30);
    expect(screen.getByTitle('13/07: 0 novos alunos')).toBeInTheDocument();
    // A linha do shadcn/Recharts existe e usa a cor da série do design system.
    const line = document.querySelector('.recharts-line-curve');
    expect(line).toHaveAttribute('stroke', 'var(--color-value)');
  });

  it('mantém o card rolável e nomeado em telas estreitas', () => {
    render(
      <DailySeriesChart
        title="Mensagens enviadas por dia"
        description="Mensagens enviadas."
        points={newStudentsDaily}
        unit="mensagens"
      />,
    );
    expect(
      screen.getByRole('region', { name: 'Mensagens enviadas por dia, área rolável' }),
    ).toHaveClass('overflow-x-auto');
  });

  it('não desenha nada quando a série vem vazia', () => {
    const { container } = render(
      <DailySeriesChart title="Vazio" description="Sem série." points={[]} unit="mensagens" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ActivityHeatmap', () => {
  it('desenha a grade 7x24 com o valor exato em cada célula', () => {
    render(<ActivityHeatmap cells={messageActivityHeatmap} />);
    expect(screen.getAllByRole('row')).toHaveLength(8);
    expect(screen.getByRole('rowheader', { name: 'seg' })).toBeVisible();
    expect(screen.getByTitle('seg, 08h: 40 mensagens')).toBeInTheDocument();
    expect(screen.getByTitle('dom, 00h: 0 mensagens')).toBeInTheDocument();
    expect(screen.getAllByTitle(/mensagens$/).length).toBeGreaterThanOrEqual(168);
  });

  it('escala a intensidade pelo pico e trata zero como ausência, não como intensidade', () => {
    render(<ActivityHeatmap cells={messageActivityHeatmap} />);
    expect(screen.getByTitle('seg, 08h: 40 mensagens')).toHaveClass('bg-[#0a7d52]');
    expect(screen.getByTitle('dom, 00h: 0 mensagens')).toHaveClass('bg-secondary');
    expect(screen.getByText('40 mensagens por hora')).toBeVisible();
  });

  it('não desenha nada sem células', () => {
    const { container } = render(<ActivityHeatmap cells={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ProtocolStatusBreakdown', () => {
  it('traduz o estado técnico e mostra a contagem de cada faixa', () => {
    render(<ProtocolStatusBreakdown slices={protocolsByApprovalStatus} />);
    const list = screen.getByRole('list');
    expect(within(list).getByText('Aguardando revisão do CREF')).toBeVisible();
    expect(within(list).getByText('Liberado automaticamente')).toBeVisible();
    expect(within(list).getByText('6')).toBeVisible();
    expect(screen.getByText('20 protocolos')).toBeVisible();
  });

  it('mostra o código cru quando o backend introduz um estado ainda sem tradução', () => {
    render(<ProtocolStatusBreakdown slices={[{ status: 'FUTURE_STATE', count: 3 }]} />);
    expect(screen.getByText('FUTURE_STATE')).toBeVisible();
  });

  it('não desenha nada sem faixas', () => {
    const { container } = render(<ProtocolStatusBreakdown slices={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
