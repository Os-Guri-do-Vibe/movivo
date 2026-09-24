/**
 * Landing inteira em jsdom: estrutura semântica e guardrails de linguagem.
 *
 * WebGL, GSAP e observers ficam inertes no jsdom — é exatamente o cenário "sem JS de
 * motion": todo o conteúdo precisa estar presente e legível mesmo assim.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./fonts', () => ({ landingFontVariables: '' }));
vi.mock('./sections/muscle-map-figures', () => ({ default: () => null }));

import { Landing } from './landing';

describe('Landing', () => {
  it('tem um único H1 e as seções na ordem narrativa', () => {
    const { container } = render(<Landing />);
    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]).toHaveTextContent(/Move your potential\./i);

    const ids = [...container.querySelectorAll('main > section')].map((section) => section.id);
    expect(ids).toEqual([
      'topo',
      'manifesto',
      'sistema',
      'whatsapp',
      'como-funciona',
      'tecnologia',
      'mapa-muscular',
      'treino-adaptativo',
      'um-dia',
      'club',
      'planos',
      'comecar',
    ]);
  });

  it('respaldo CREF visível e nenhuma credencial inventada', () => {
    const { container } = render(<Landing />);
    const text = container.textContent ?? '';
    expect(text).toMatch(/Regulamentado pelo CREF/);
    expect(text).toMatch(/registro no CREF/i);
    expect(text).not.toMatch(/\bm[ée]dico\b|nutricionista/i);
  });

  it('respeita os guardrails de linguagem e não inventa prova social', () => {
    const { container } = render(<Landing />);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/diagn[óo]stico|tratamento|\bcura\b|resultado garantido/i);
    expect(text).not.toMatch(/mais vendido|mais popular|depoimento|avalia[çc][õo]es/i);
    expect(text).not.toMatch(/first 100|founding/i);
  });

  it('CTA principal leva à escolha de plano e os planos levam à anamnese', () => {
    render(<Landing />);
    const hero = screen.getByRole('region', { name: /Move your potential/i });
    expect(hero.querySelector('[data-analytics-event="hero_start_trial"]')).toHaveAttribute(
      'href',
      '#planos',
    );
    const planLinks = [...document.querySelectorAll('a[href^="/anamnese?plano="]')].map((link) =>
      link.getAttribute('href'),
    );
    expect(new Set(planLinks)).toEqual(
      new Set([
        '/anamnese?plano=MONTHLY',
        '/anamnese?plano=QUARTERLY',
        '/anamnese?plano=SEMIANNUAL',
        '/anamnese?plano=ANNUAL',
      ]),
    );
  });

  it('conteúdo essencial fora de canvas e imagens decorativas sem texto alternativo', () => {
    const { container } = render(<Landing />);
    expect(container.querySelectorAll('canvas')).toHaveLength(0);
    expect(screen.getByText('Físico')).toBeInTheDocument();
    expect(screen.getByText('Performance')).toBeInTheDocument();
    for (const image of container.querySelectorAll('img')) {
      expect(image.hasAttribute('alt')).toBe(true);
    }
  });
});
