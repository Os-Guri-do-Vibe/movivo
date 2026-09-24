/**
 * Fold Text: uma peça por caractere para o efeito dobrar, sem quebrar palavra no meio
 * e com a frase inteira disponível para leitor de tela.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FoldText } from './fold-text';

describe('FoldText', () => {
  it('a frase inteira fica acessível; as peças são decorativas', () => {
    const { container } = render(
      <p>
        <FoldText parts={['Precisa ', { text: 'continuar.', underline: true }]} />
      </p>,
    );
    expect(screen.getByText('Precisa continuar.')).toHaveClass('sr-only');
    const visual = container.querySelector('[aria-hidden="true"]');
    expect(visual?.querySelectorAll('[data-fold-piece]')).toHaveLength('Precisacontinuar.'.length);
    expect(visual?.querySelectorAll('[data-fold-underline]')).toHaveLength(1);
  });

  it('agrupa por palavra, atravessando trechos, e respeita o espaço não separável', () => {
    const { container } = render(
      <FoldText
        parts={[
          'Mais ',
          { text: 'não\u00A0muda', className: 'tom' },
          ' ',
          { text: 'ser', className: 'tom' },
          '.',
        ]}
      />,
    );
    const words = [...(container.querySelector('[aria-hidden="true"]')?.children ?? [])];
    expect(words.map((word) => word.textContent)).toEqual(['Mais', 'não\u00A0muda', 'ser.']);
    // Tom aplicado só ao trecho marcado, inclusive dentro da mesma palavra.
    expect(words[2]?.querySelectorAll('.tom')).toHaveLength(1);
    expect(words[2]?.querySelector('.tom')?.textContent).toBe('ser');
  });
});
