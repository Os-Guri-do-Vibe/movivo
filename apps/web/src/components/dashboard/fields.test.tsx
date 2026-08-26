import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChipGroupField, ComboboxField, NumberField, TextAreaField, TextField } from './fields';

const ITEMS = [
  { value: 'A', label: 'Alfa' },
  { value: 'B', label: 'Beta' },
  { value: 'C', label: 'Gama' },
] as const;

describe('TextField', () => {
  it('propaga o novo valor ao digitar', async () => {
    const onChange = vi.fn();
    render(<TextField value="" onChange={onChange} />);

    await userEvent.type(screen.getByRole('textbox'), 'a');

    expect(onChange).toHaveBeenCalledWith('a');
  });
});

describe('TextAreaField', () => {
  it('propaga o novo valor ao digitar', async () => {
    const onChange = vi.fn();
    render(<TextAreaField value="" onChange={onChange} />);

    await userEvent.type(screen.getByRole('textbox'), 'a');

    expect(onChange).toHaveBeenCalledWith('a');
  });
});

describe('NumberField', () => {
  it('incrementa e decrementa pelo step ao clicar nas setas', async () => {
    const onChange = vi.fn();
    render(<NumberField value={5} onChange={onChange} step={2} />);
    const [up, down] = screen.getAllByRole('button', { hidden: true });

    await userEvent.click(up as HTMLElement);
    expect(onChange).toHaveBeenCalledWith('7');

    await userEvent.click(down as HTMLElement);
    expect(onChange).toHaveBeenCalledWith('3');
  });

  it('trava no mínimo: seta de baixo desabilitada e não desce mais', async () => {
    const onChange = vi.fn();
    render(<NumberField value={0} onChange={onChange} min={0} max={10} />);
    const [, down] = screen.getAllByRole('button', { hidden: true });

    expect(down).toBeDisabled();
  });

  it('trava no máximo: seta de cima desabilitada', () => {
    const onChange = vi.fn();
    render(<NumberField value={10} onChange={onChange} min={0} max={10} />);
    const [up] = screen.getAllByRole('button', { hidden: true });

    expect(up).toBeDisabled();
  });

  it('valor não numérico: incrementa a partir do mínimo (ou zero, sem mínimo)', async () => {
    const onChange = vi.fn();
    render(<NumberField value="" onChange={onChange} step={1} />);
    const [up] = screen.getAllByRole('button', { hidden: true });

    await userEvent.click(up as HTMLElement);

    expect(onChange).toHaveBeenCalledWith('1');
  });
});

describe('ChipGroupField', () => {
  it('seleciona o item clicado', async () => {
    const onChange = vi.fn();
    render(<ChipGroupField label="Frequência" items={ITEMS} value="A" onChange={onChange} />);

    await userEvent.click(screen.getByRole('radio', { name: 'Beta' }));

    expect(onChange).toHaveBeenCalledWith('B');
  });
});

describe('ComboboxField', () => {
  it('abre ao clicar, mostra as opções e fecha ao selecionar uma', async () => {
    const onChange = vi.fn();
    render(
      <ComboboxField id="combo" label="Objetivo" items={ITEMS} value="A" onChange={onChange} />,
    );

    await userEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('option', { name: 'Beta' }));

    expect(onChange).toHaveBeenCalledWith('B');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('mostra o placeholder quando o valor não bate com nenhum item', () => {
    render(
      <ComboboxField
        id="combo"
        label="Objetivo"
        items={ITEMS}
        value={'Z' as (typeof ITEMS)[number]['value']}
        onChange={vi.fn()}
        placeholder="Selecione"
      />,
    );

    expect(screen.getByText('Selecione')).toBeInTheDocument();
  });

  it('ArrowDown no trigger fechado abre o menu', async () => {
    render(
      <ComboboxField id="combo" label="Objetivo" items={ITEMS} value="A" onChange={vi.fn()} />,
    );

    screen.getByRole('combobox').focus();
    await userEvent.keyboard('{ArrowDown}');

    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('Escape fecha o menu e devolve o foco ao trigger', async () => {
    render(
      <ComboboxField id="combo" label="Objetivo" items={ITEMS} value="A" onChange={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('combobox'));

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveFocus();
  });

  it('Tab fecha o menu sem mudar o valor', async () => {
    const onChange = vi.fn();
    render(
      <ComboboxField id="combo" label="Objetivo" items={ITEMS} value="A" onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole('combobox'));

    await userEvent.keyboard('{Tab}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Enter na opção focada seleciona o valor', async () => {
    const onChange = vi.fn();
    render(
      <ComboboxField id="combo" label="Objetivo" items={ITEMS} value="A" onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole('combobox'));

    await userEvent.keyboard('{ArrowDown}{Enter}');

    expect(onChange).toHaveBeenCalledWith('B');
  });

  it('End vai para a última opção e Home volta para a primeira', async () => {
    render(
      <ComboboxField id="combo" label="Objetivo" items={ITEMS} value="A" onChange={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('combobox'));

    await userEvent.keyboard('{End}');
    expect(screen.getByRole('option', { name: 'Gama' })).toHaveFocus();

    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('option', { name: 'Alfa' })).toHaveFocus();
  });

  it('clicar fora fecha o menu', async () => {
    render(
      <div>
        <ComboboxField id="combo" label="Objetivo" items={ITEMS} value="A" onChange={vi.fn()} />
        <button type="button">fora</button>
      </div>,
    );
    await userEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'fora' }));

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
