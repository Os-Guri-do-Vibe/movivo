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

  it('diagnóstico "Sim" revela o campo de texto', () => {
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
    expect(screen.getByLabelText('Qual é o diagnóstico?')).toBeInTheDocument();
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
