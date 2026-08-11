import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DatePicker } from './date-picker';

describe('DatePicker', () => {
  it('abre um calendário com a mesma largura do campo', async () => {
    const user = userEvent.setup();
    render(<DatePicker id="birthDate" value="1990-01-01" onChange={vi.fn()} />);

    await user.click(screen.getByRole('textbox'));

    expect(screen.getByRole('dialog', { name: 'Escolha uma data' })).toHaveClass(
      'inset-x-0',
      'w-full',
    );
  });

  it('mantém o payload ISO ao selecionar uma data', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePicker id="birthDate" value="1990-01-01" onChange={onChange} />);

    await user.click(screen.getByRole('textbox'));
    await user.click(screen.getByRole('button', { name: '15 de Janeiro de 1990' }));

    expect(onChange).toHaveBeenCalledWith('1990-01-15');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('abre seletores arredondados com respiro na seta', async () => {
    const user = userEvent.setup();
    render(<DatePicker id="birthDate" value="1990-01-01" onChange={vi.fn()} />);

    await user.click(screen.getByRole('textbox'));
    const monthTrigger = screen.getByRole('button', { name: 'Mês' });
    const controls = monthTrigger.parentElement?.parentElement;

    expect(controls).toHaveClass('grid-cols-[44px_minmax(0,1fr)_104px_44px]');
    expect(monthTrigger).toHaveClass('pr-3');
    expect(screen.getByTestId('birthDate-month-chevron')).toHaveClass('mr-1');

    await user.click(monthTrigger);

    expect(screen.getByRole('listbox', { name: 'Opções de Mês' })).toHaveClass(
      'rounded-2xl',
      'bg-nevoa',
    );

    const yearTrigger = screen.getByRole('button', { name: 'Ano' });
    expect(yearTrigger).toHaveClass('pr-3');
    expect(screen.getByTestId('birthDate-year-chevron')).toHaveClass('mr-1');

    await user.click(yearTrigger);

    expect(screen.queryByRole('listbox', { name: 'Opções de Mês' })).not.toBeInTheDocument();
    expect(screen.getByRole('listbox', { name: 'Opções de Ano' })).toHaveClass(
      'rounded-2xl',
      'bg-nevoa',
    );
  });

  it('seleciona mês e ano nos menus customizados mantendo o calendário aberto', async () => {
    const user = userEvent.setup();
    render(<DatePicker id="birthDate" value="1990-01-01" onChange={vi.fn()} />);

    await user.click(screen.getByRole('textbox'));
    const monthTrigger = screen.getByRole('button', { name: 'Mês' });
    const yearTrigger = screen.getByRole('button', { name: 'Ano' });

    await user.click(monthTrigger);
    await user.click(screen.getByRole('option', { name: 'Março' }));

    expect(monthTrigger).toHaveTextContent('Março');
    expect(screen.getByRole('dialog', { name: 'Escolha uma data' })).toBeInTheDocument();

    await user.click(yearTrigger);
    await user.click(screen.getByRole('option', { name: '1991' }));

    expect(yearTrigger).toHaveTextContent('1991');
    expect(screen.getByRole('button', { name: '15 de Março de 1991' })).toBeInTheDocument();
  });

  it('percorre e seleciona opções pelo teclado', async () => {
    const user = userEvent.setup();
    render(<DatePicker id="birthDate" value="1990-01-01" onChange={vi.fn()} />);

    await user.click(screen.getByRole('textbox'));
    const monthTrigger = screen.getByRole('button', { name: 'Mês' });
    monthTrigger.focus();

    await user.keyboard('{Enter}{ArrowDown}{Enter}');

    expect(monthTrigger).toHaveTextContent('Fevereiro');
    expect(monthTrigger).toHaveFocus();
    expect(screen.queryByRole('listbox', { name: 'Opções de Mês' })).not.toBeInTheDocument();
  });

  it('fecha com Escape e devolve o foco ao campo', async () => {
    const user = userEvent.setup();
    render(<DatePicker id="birthDate" value="1990-01-01" onChange={vi.fn()} />);
    const trigger = screen.getByRole('textbox');

    await user.click(trigger);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('permite digitar e colar a data mantendo o valor ISO no formulário', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePicker id="birthDate" value="" onChange={onChange} />);
    const input = screen.getByRole('textbox');

    await user.type(input, '18072001');

    expect(input).toHaveValue('18/07/2001');
    expect(onChange).toHaveBeenLastCalledWith('2001-07-18');

    await user.clear(input);
    await user.click(input);
    await user.paste('25121995');

    expect(input).toHaveValue('25/12/1995');
    expect(onChange).toHaveBeenLastCalledWith('1995-12-25');
  });

  it('não envia uma data manual incompleta ou inexistente', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePicker id="birthDate" value="" onChange={onChange} />);
    const input = screen.getByRole('textbox');

    await user.type(input, '31022001');

    expect(input).toHaveValue('31/02/2001');
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('permite informar uma data futura quando não há limite superior', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const futureYear = new Date().getFullYear() + 1;
    render(<DatePicker id="eventDate" value="" onChange={onChange} maxDate={null} />);
    const input = screen.getByRole('textbox');

    await user.type(input, `1506${futureYear}`);

    expect(input).toHaveValue(`15/06/${futureYear}`);
    expect(onChange).toHaveBeenLastCalledWith(`${futureYear}-06-15`);
  });

  it('bloqueia datas anteriores ao limite mínimo no calendário e na digitação', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const minDate = new Date(2030, 4, 11);
    render(
      <DatePicker id="eventDate" value="" onChange={onChange} minDate={minDate} maxDate={null} />,
    );
    const input = screen.getByRole('textbox');

    await user.click(input);
    expect(screen.getByRole('button', { name: '10 de Maio de 2030' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '11 de Maio de 2030' })).toBeEnabled();

    await user.type(input, '10052030');
    expect(onChange).toHaveBeenLastCalledWith('');
    await user.clear(input);
    await user.type(input, '11052030');
    expect(onChange).toHaveBeenLastCalledWith('2030-05-11');
  });
});
