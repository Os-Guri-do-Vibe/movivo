import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PhoneInput } from './phone-input';

function renderPhoneInput(overrides: Partial<ComponentProps<typeof PhoneInput>> = {}) {
  const props: ComponentProps<typeof PhoneInput> = {
    id: 'phone',
    countryIso: 'BR',
    value: '',
    onChange: vi.fn(),
    onCountryChange: vi.fn(),
    ...overrides,
  };
  render(<PhoneInput {...props} />);
  return props;
}

describe('PhoneInput', () => {
  it('começa com nome e DDI do Brasil, sem emoji de bandeira', () => {
    renderPhoneInput();
    const countryTrigger = screen.getByRole('button', { name: /Brasil, \+55/i });
    expect(countryTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(countryTrigger).toHaveClass('w-[150px]', 'sm:w-[170px]');
    expect(screen.getByText('Brasil +55')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\p{Regional_Indicator}/u);
    expect(screen.getByTestId('phone-field')).toHaveClass(
      'overflow-hidden',
      'rounded-xl',
      'border',
    );
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', '(11) 96123-4567');
  });

  it('abre o listbox arredondado, rolável e lista todos os países', async () => {
    const user = userEvent.setup();
    renderPhoneInput();
    await user.click(screen.getByRole('button', { name: /Brasil, \+55/i }));

    const listbox = screen.getByRole('listbox', { name: /Países e DDIs/i });
    const menu = listbox.parentElement;
    const search = screen.getByRole('searchbox', { name: /Buscar país ou DDI/i });
    expect(menu).toHaveClass('w-full');
    expect(menu).not.toHaveClass('w-80');
    expect(listbox).toHaveClass('overflow-y-auto');
    expect(search).toHaveClass('h-[52px]', 'px-4', 'mb-2', 'text-body');
    expect(screen.getAllByRole('option').length).toBeGreaterThan(200);
    expect(screen.getByRole('option', { name: /Portugal, DDI \+351/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Japão, DDI \+81/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Nigéria, DDI \+234/i })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\p{Regional_Indicator}/u);
  });

  it('busca por nome sem acento, ISO ou DDI', async () => {
    const user = userEvent.setup();
    renderPhoneInput();
    await user.click(screen.getByRole('button', { name: /Brasil, \+55/i }));
    const search = screen.getByRole('searchbox', { name: /Buscar país ou DDI/i });

    await user.type(search, 'japao');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: /Japão, DDI \+81/i })).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, '+234');
    expect(screen.getByRole('option', { name: /Nigéria, DDI \+234/i })).toBeInTheDocument();
  });

  it('troca o país e remascara somente os dígitos nacionais', async () => {
    const user = userEvent.setup();
    const props = renderPhoneInput({ value: '(11) 99999-9999' });
    await user.click(screen.getByRole('button', { name: /Brasil, \+55/i }));
    await user.click(screen.getByRole('option', { name: /Portugal, DDI \+351/i }));

    expect(props.onCountryChange).toHaveBeenCalledWith('PT', '119999999');
  });

  it('formata a digitação de acordo com o país selecionado', () => {
    const props = renderPhoneInput({ countryIso: 'US' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '2025550123' } });
    expect(props.onChange).toHaveBeenLastCalledWith('(202) 555-0123');
  });

  it('permite navegar com setas, selecionar com Enter e fechar com Escape', async () => {
    const user = userEvent.setup();
    const props = renderPhoneInput();
    const trigger = screen.getByRole('button', { name: /Brasil, \+55/i });

    await user.click(trigger);
    await user.type(screen.getByRole('searchbox'), 'Portugal');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(props.onCountryChange).toHaveBeenCalledWith('PT', '');
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('fecha ao clicar fora', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <PhoneInput
          id="phone"
          countryIso="BR"
          value=""
          onChange={vi.fn()}
          onCountryChange={vi.fn()}
        />
        <button type="button">Fora</button>
      </div>,
    );
    await user.click(screen.getByRole('button', { name: /Brasil, \+55/i }));
    await user.click(screen.getByRole('button', { name: 'Fora' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
