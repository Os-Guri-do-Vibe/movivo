/**
 * Testes do `ThemeToggle` (US-0.8, Mariana).
 *
 * Recado de Felipe (US-0.5): o botão nasce `disabled` e neutro até montar, para evitar
 * divergência de hidratação — então a asserção real precisa acontecer **depois** do
 * `mounted`. Aqui esperamos o botão ficar habilitado (pós-`useEffect`) antes de checar
 * nome acessível e alternância de tema.
 *
 * O que se prova:
 *  - antes/depois da montagem o botão sempre tem nome acessível (nunca um ícone mudo);
 *  - após montar, alternar o tema troca o rótulo da AÇÃO e o estado `aria-pressed`.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ThemeProvider } from '@/components/theme-provider';
import { ThemeToggle } from '@/components/theme-toggle';

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe('ThemeToggle', () => {
  it('após montar fica habilitado e expõe o rótulo da ação de ativar o tema escuro', async () => {
    renderToggle();
    // matchMedia mock = sistema claro → o próximo passo é "Ativar tema escuro".
    const button = await screen.findByRole('button', { name: 'Ativar tema escuro' });
    await waitFor(() => expect(button).toBeEnabled());
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('alterna para o tema escuro ao ser clicado e atualiza rótulo e aria-pressed', async () => {
    const user = userEvent.setup();
    renderToggle();

    const button = await screen.findByRole('button', { name: 'Ativar tema escuro' });
    await waitFor(() => expect(button).toBeEnabled());

    await user.click(button);

    await waitFor(() =>
      expect(screen.getByRole('button')).toHaveAccessibleName('Ativar tema claro'),
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });
});
