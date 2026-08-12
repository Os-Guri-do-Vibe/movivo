import * as React from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EMPTY_PAIN, PainSection } from './pain-section';

describe('PainSection', () => {
  it('"Não" encerra a seção — nenhum outro campo aparece', () => {
    render(<PainSection data={EMPTY_PAIN} onChange={vi.fn()} />);
    expect(screen.queryByText(/em qual região/i)).not.toBeInTheDocument();
  });

  it('"Sim" revela as regiões; escolher uma cria o ponto com escala 0-10', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PainSection data={EMPTY_PAIN} onChange={onChange} />);
    await user.click(screen.getByText('Sim'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ hasPain: true }));
  });

  it('mostra a escala por região quando já há um ponto selecionado', () => {
    render(
      <PainSection
        data={{
          ...EMPTY_PAIN,
          hasPain: true,
          points: [{ region: 'KNEE', intensity: 5, regionOther: '' }],
        }}
        onChange={vi.fn()}
      />,
    );
    const slider = screen.getByLabelText(/intensidade do desconforto em joelho/i);
    expect(slider).toHaveAttribute('aria-valuetext', '5 de 10');
  });

  it('mostra o campo de Outra antes da escala e usa o texto informado no título', async () => {
    const user = userEvent.setup();

    function ControlledPainSection() {
      const [data, setData] = React.useState({
        ...EMPTY_PAIN,
        hasPain: true,
      });
      return <PainSection data={data} onChange={setData} />;
    }

    render(<ControlledPainSection />);
    expect(screen.queryByLabelText('Qual é a outra região?')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Outra' }));
    const otherRegion = screen.getByLabelText('Qual é a outra região?');
    const initialSlider = screen.getByLabelText('Intensidade do desconforto em Outra');

    expect(
      otherRegion.compareDocumentPosition(initialSlider) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.type(otherRegion, 'Cotovelo esquerdo');
    expect(
      screen.getByLabelText('Intensidade do desconforto em Cotovelo esquerdo'),
    ).toBeInTheDocument();
  });

  it('posiciona os indicadores de seleção à esquerda na Parte 4', () => {
    render(
      <PainSection
        data={{
          ...EMPTY_PAIN,
          hasPain: true,
          points: [{ region: 'KNEE', intensity: 5, regionOther: '' }],
        }}
        onChange={vi.fn()}
      />,
    );

    const painAnswer = screen.getAllByRole('radio', { name: 'Sim' })[0];
    const region = screen.getByRole('button', { name: 'Joelho' });
    const trend = screen.getByRole('radio', { name: 'Estável' });

    for (const option of [painAnswer, region, trend]) {
      expect(option).toHaveClass('justify-start');
      expect(option?.firstElementChild).toHaveClass('rounded-full');
    }
  });

  it('explicação profissional revela o campo sem usar o termo proibido', () => {
    render(
      <PainSection
        data={{
          ...EMPTY_PAIN,
          hasPain: true,
          points: [{ region: 'KNEE', intensity: 5, regionOther: '' }],
          trend: 'STABLE',
          hasProfessionalExplanation: true,
        }}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByLabelText(
        'O que ele te disse? Com suas palavras, tudo bem não lembrar o nome exato.',
      ),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/diagnóstico/i);
  });

  it('recomendação de evitar "Sim" revela o campo de texto', () => {
    render(
      <PainSection
        data={{
          ...EMPTY_PAIN,
          hasPain: true,
          points: [{ region: 'KNEE', intensity: 5, regionOther: '' }],
          trend: 'STABLE',
          hasAvoidanceRecommendation: true,
        }}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByLabelText('Quais movimentos ou exercícios devem ser evitados?'),
    ).toBeInTheDocument();
  });

  it('arrastar o slider de intensidade chama onChange com o novo valor', () => {
    const onChange = vi.fn();
    render(
      <PainSection
        data={{
          ...EMPTY_PAIN,
          hasPain: true,
          points: [{ region: 'KNEE', intensity: 5, regionOther: '' }],
        }}
        onChange={onChange}
      />,
    );
    const slider = screen.getByLabelText(/intensidade do desconforto em joelho/i);
    Object.defineProperty(slider, 'value', { value: '8', writable: true });
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onChange).toHaveBeenCalled();
  });

  it('preencher tendência e o campo "o que provoca" chama onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PainSection
        data={{
          ...EMPTY_PAIN,
          hasPain: true,
          points: [{ region: 'KNEE', intensity: 5, regionOther: '' }],
        }}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByText('Piorando'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ trend: 'WORSENING' }));

    await user.type(
      screen.getByLabelText('Quais movimentos ou situações provocam o desconforto?'),
      'a',
    );
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ trigger: 'a' }));
  });

  it('acompanhamento médico "Sim" chama onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PainSection
        data={{
          ...EMPTY_PAIN,
          hasPain: true,
          points: [{ region: 'KNEE', intensity: 5, regionOther: '' }],
        }}
        onChange={onChange}
      />,
    );
    const [, followUpSim] = screen.getAllByText('Sim');
    await user.click(followUpSim as HTMLElement);
    expect(onChange).toHaveBeenCalled();
  });

  it('remover a única região marcada some com o cartão de intensidade', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PainSection
        data={{
          ...EMPTY_PAIN,
          hasPain: true,
          points: [{ region: 'KNEE', intensity: 5, regionOther: '' }],
        }}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByText('Joelho'));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ points: [] }));
  });
});
