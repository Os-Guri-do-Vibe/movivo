import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Checkbox, ChoiceGroup, TextInput, YesNo } from './fields';

describe('ChoiceGroup', () => {
  it('single-select: escolher um item chama onToggle com o valor', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <ChoiceGroup
        legend="Objetivo"
        items={[
          { value: 'A', label: 'Alfa' },
          { value: 'B', label: 'Beta' },
        ]}
        selected={[]}
        onToggle={onToggle}
      />,
    );
    await user.click(screen.getByText('Beta'));
    expect(onToggle).toHaveBeenCalledWith('B');
  });

  it('multi-select: itens em disabledValues ficam aria-disabled mas continuam clicáveis', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <ChoiceGroup
        items={[
          { value: 'A', label: 'Alfa' },
          { value: 'B', label: 'Beta' },
        ]}
        selected={['A']}
        onToggle={onToggle}
        multi
        disabledValues={['B']}
      />,
    );
    const beta = screen.getByText('Beta');
    expect(beta).toHaveAttribute('aria-disabled', 'true');
    await user.click(beta);
    expect(onToggle).toHaveBeenCalledWith('B');
  });

  it('marca o item selecionado com aria-pressed (multi) ou aria-checked (single)', () => {
    render(
      <ChoiceGroup
        items={[{ value: 'A', label: 'Alfa' }]}
        selected={['A']}
        onToggle={vi.fn()}
        multi
      />,
    );
    expect(screen.getByText('Alfa')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('YesNo', () => {
  it('Sim chama onChange(true) e Não chama onChange(false)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<YesNo legend="Pergunta?" value={undefined} onChange={onChange} />);
    await user.click(screen.getByText('Sim'));
    expect(onChange).toHaveBeenCalledWith(true);
    await user.click(screen.getByText('Não'));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe('Checkbox', () => {
  it('alterna o estado ao clicar no label', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Checkbox id="c1" checked={false} onChange={onChange}>
        Aceito os termos
      </Checkbox>,
    );
    await user.click(screen.getByLabelText('Aceito os termos'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('TextInput', () => {
  it('dispara onChange com o valor digitado', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TextInput id="name" value="" onChange={onChange} />);
    await user.type(screen.getByRole('textbox'), 'a');
    expect(onChange).toHaveBeenCalledWith('a');
  });
});
