/**
 * Testes do `Button` do design system "O Pulso" (US-0.8, Mariana).
 *
 * O Button é a prova viva do pipeline de design system (US-0.5). Aqui garantimos o
 * contrato de comportamento e acessibilidade — não a aparência:
 *  - renderiza um <button> nativo por padrão (semântica e teclado corretos de graça);
 *  - `asChild` delega no elemento filho (padrão de link do shadcn/ui);
 *  - as variantes aplicam classes distintas (o mapa de Sofia §15 não regride para uma só);
 *  - `disabled` desabilita de fato.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from '@/components/ui/button';

describe('Button', () => {
  it('renderiza um <button> nativo com o texto e é acessível pelo papel', () => {
    render(<Button>Ação primária</Button>);
    const button = screen.getByRole('button', { name: 'Ação primária' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('data-slot', 'button');
  });

  it('com asChild renderiza no elemento filho (link) em vez de aninhar um button', () => {
    render(
      <Button asChild>
        <a href="/entrar">Entrar</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Entrar' });
    expect(link).toHaveAttribute('href', '/entrar');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('aplica classes diferentes por variante — o design system não colapsa numa só', () => {
    const { rerender } = render(<Button>Primária</Button>);
    const primaryClass = screen.getByRole('button').className;

    rerender(<Button variant="destructive">Alerta</Button>);
    const destructiveClass = screen.getByRole('button').className;

    expect(primaryClass).toContain('bg-primary');
    expect(destructiveClass).toContain('bg-destructive');
    expect(primaryClass).not.toBe(destructiveClass);
  });

  it('respeita o estado disabled', () => {
    render(<Button disabled>Indisponível</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
