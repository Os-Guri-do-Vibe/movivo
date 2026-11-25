import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pencil } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IconAction } from './icon-action';

afterEach(() => vi.useRealTimers());

const tooltip = () => screen.getByRole('tooltip', { hidden: true });

describe('IconAction', () => {
  it('tem nome acessível e a dica extra vira descrição', () => {
    render(<IconAction label="Editar" hint="Abre a revisão do protocolo." icon={Pencil} />);
    const button = screen.getByRole('button', { name: 'Editar' });
    expect(button).toHaveAccessibleDescription('Abre a revisão do protocolo.');
  });

  it('mostra a dica no foco por teclado e esconde com Esc', async () => {
    render(<IconAction label="Editar" icon={Pencil} />);
    await userEvent.tab();
    expect(tooltip()).toHaveClass('opacity-100');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Editar' }), { key: 'Escape' });
    expect(tooltip()).toHaveClass('invisible');
  });

  it('no toque longo mostra a dica sem disparar a ação; no toque curto, age', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    render(<IconAction label="Regerar" icon={Pencil} onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Regerar' });

    fireEvent.pointerDown(button, { pointerType: 'touch' });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.pointerUp(button, { pointerType: 'touch' });
    fireEvent.click(button);
    expect(tooltip()).toHaveClass('opacity-100');
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.pointerDown(button, { pointerType: 'touch' });
    fireEvent.pointerUp(button, { pointerType: 'touch' });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('vira link quando recebe href', () => {
    render(<IconAction label="Editar" icon={Pencil} href="/dashboard/fila/1" />);
    expect(screen.getByRole('link', { name: 'Editar' })).toHaveAttribute(
      'href',
      '/dashboard/fila/1',
    );
  });
});
