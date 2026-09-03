import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ThemeProvider } from '@/components/theme-provider';

import { AvatarMenu } from './avatar-menu';

function renderMenu(name: string | null = 'Ana Souza', avatarUrl: string | null = null) {
  return render(
    <ThemeProvider>
      <AvatarMenu role="ADMIN" name={name} avatarUrl={avatarUrl} />
    </ThemeProvider>,
  );
}

describe('AvatarMenu', () => {
  it('abre ao clicar na esfera de avatar e mostra papel, nome, minha conta e tema', async () => {
    const user = userEvent.setup();
    renderMenu();

    const trigger = screen.getByRole('button', { name: 'Menu da conta — Fundador' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByLabelText('Menu da conta', { exact: true });
    expect(within(panel).getByText('Fundador')).toBeInTheDocument();
    expect(within(panel).getByText('Ana Souza')).toBeInTheDocument();
    const accountLink = within(panel).getByRole('link', { name: /Minha conta/ });
    expect(accountLink).toHaveAttribute('href', '/dashboard/conta');
    // Ícone — sinaliza visualmente que o item é clicável, igual ao alternador de tema.
    expect(accountLink.querySelector('svg')).toBeInTheDocument();
    const themeButton = await screen.findByRole('button', { name: 'Ativar tema escuro' });
    expect(themeButton).toHaveTextContent('Tema: Claro');
    // Minha conta e Tema compartilham o mesmo padding — nenhum dos dois "menor" que o outro.
    expect(accountLink.className).toContain('py-2.5');
    expect(themeButton.className).toContain('py-2.5');
  });

  it('o nome exibido ao lado da esfera também abre o menu (é parte do mesmo botão)', async () => {
    const user = userEvent.setup();
    renderMenu();

    const trigger = screen.getByRole('button', { name: 'Menu da conta — Fundador' });
    const visibleName = within(trigger).getByText('Ana Souza');
    expect(trigger).toContainElement(visibleName);

    await user.click(visibleName);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('mostra as iniciais do nome quando não há foto de perfil', () => {
    renderMenu('Ana Souza');
    const trigger = screen.getByRole('button', { name: 'Menu da conta — Fundador' });
    const circle = trigger.querySelector('span[aria-hidden="true"]');
    expect(circle).toHaveTextContent('AN');
    expect(trigger.querySelector('img')).not.toBeInTheDocument();
  });

  it('mostra a foto de perfil quando avatarUrl está presente', () => {
    renderMenu('Ana Souza', 'https://api.test/avatar/abc.jpg');
    const trigger = screen.getByRole('button', { name: 'Menu da conta — Fundador' });
    const img = trigger.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://api.test/avatar/abc.jpg');
  });

  it('mostra aviso quando a conta não tem nome cadastrado', async () => {
    const user = userEvent.setup();
    renderMenu(null);

    await user.click(screen.getByRole('button', { name: 'Menu da conta — Fundador' }));
    const panel = screen.getByLabelText('Menu da conta', { exact: true });
    expect(within(panel).getByText('Sem nome cadastrado')).toBeInTheDocument();
  });

  it('fecha com Esc e devolve o foco ao gatilho', async () => {
    const user = userEvent.setup();
    renderMenu();

    const trigger = screen.getByRole('button', { name: 'Menu da conta — Fundador' });
    await user.click(trigger);
    expect(screen.getByLabelText('Menu da conta')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText('Menu da conta')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('fecha ao clicar fora do menu', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <div>
          <button type="button">Fora</button>
          <AvatarMenu role="ADMIN" name="Ana Souza" avatarUrl={null} />
        </div>
      </ThemeProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Menu da conta — Fundador' }));
    expect(screen.getByLabelText('Menu da conta')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Fora' }));
    await waitFor(() => expect(screen.queryByLabelText('Menu da conta')).not.toBeInTheDocument());
  });

  it('alterna o tema ao clicar no item do menu', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByRole('button', { name: 'Menu da conta — Fundador' }));
    const themeButton = await screen.findByRole('button', { name: 'Ativar tema escuro' });
    await user.click(themeButton);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Ativar tema claro' })).toHaveTextContent(
        'Tema: Escuro',
      ),
    );
  });
});
