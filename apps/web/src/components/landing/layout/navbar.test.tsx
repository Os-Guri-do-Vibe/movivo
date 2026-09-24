/** Navbar: navegação principal, estado após rolagem e menu mobile acessível. */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { MobileStickyCta } from './mobile-sticky-cta';
import { Navbar } from './navbar';

describe('Navbar', () => {
  it('expõe os quatro destinos e o CTA de início', () => {
    render(<Navbar />);
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['#como-funciona', '#tecnologia', '#club', '#planos']);
    expect(screen.getByRole('link', { name: 'Começar grátis' })).toHaveAttribute('href', '#planos');
  });

  it('ganha fundo depois de 80px de rolagem', async () => {
    const { container } = render(<Navbar />);
    const header = container.querySelector('header');
    expect(header).toHaveAttribute('data-scrolled', 'false');
    act(() => {
      Object.defineProperty(window, 'scrollY', { value: 200, configurable: true });
      window.dispatchEvent(new Event('scroll'));
    });
    await waitFor(() => expect(header).toHaveAttribute('data-scrolled', 'true'));
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });

  it('menu mobile abre em tela cheia e fecha com ESC', async () => {
    const user = userEvent.setup();
    render(<Navbar />);
    await user.click(screen.getByRole('button', { name: 'Abrir menu' }));
    const menu = screen.getByRole('navigation', { name: 'Navegação mobile' });
    expect(menu).toBeVisible();
    expect(screen.getByRole('link', { name: 'Começar 7 dias grátis' })).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('navigation', { name: 'Navegação mobile' })).toBeNull();
  });

  it('link do menu fecha o diálogo antes de navegar', async () => {
    const user = userEvent.setup();
    render(<Navbar />);
    await user.click(screen.getByRole('button', { name: 'Abrir menu' }));
    const menu = screen.getByRole('navigation', { name: 'Navegação mobile' });
    await user.click(menu.querySelector('a[href="#planos"]') as HTMLElement);
    expect(screen.queryByRole('navigation', { name: 'Navegação mobile' })).toBeNull();
  });
});

describe('MobileStickyCta', () => {
  it('fica oculto no hero e aparece depois de ~120% da altura da tela', async () => {
    const { container } = render(<MobileStickyCta />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar).toHaveAttribute('data-visible', 'false');
    act(() => {
      Object.defineProperty(window, 'scrollY', {
        value: window.innerHeight * 2,
        configurable: true,
      });
      window.dispatchEvent(new Event('scroll'));
    });
    await waitFor(() => expect(bar).toHaveAttribute('data-visible', 'true'));
    expect(screen.getByRole('link', { name: /Começar 7 dias grátis/ })).toHaveAttribute(
      'href',
      '#planos',
    );
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });
});
