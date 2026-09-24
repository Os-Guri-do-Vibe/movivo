/** Slots de mídia: sem asset, fallback visual sem nenhum texto de "placeholder". */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MediaSlot } from './media-slot';

describe('MediaSlot', () => {
  it('sem asset renderiza o fallback decorativo, nunca um aviso de pendência', () => {
    const { container } = render(<MediaSlot asset={null} aspectRatio="4 / 3" />);
    const frame = container.firstElementChild as HTMLElement;
    expect(frame).toHaveAttribute('data-media-state', 'fallback');
    expect(frame.style.aspectRatio).toBe('4 / 3');
    expect(container.textContent).not.toMatch(/placeholder|coming soon|missing/i);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('o retrato pendente mostra só o monograma editorial', () => {
    const { container } = render(
      <MediaSlot asset={null} fallbackVariant="portrait" monogram="L" />,
    );
    expect(container.textContent).toBe('L');
  });

  it('aceita uma composição própria da seção', () => {
    render(<MediaSlot asset={null} fallbackVariant="custom" fallback={<span>composição</span>} />);
    expect(screen.getByText('composição')).toBeInTheDocument();
  });

  it('com asset, entra a imagem com texto alternativo', () => {
    render(<MediaSlot asset="/assets/movivo/people/leonardo.webp" alt="Leonardo" />);
    expect(screen.getByRole('img', { name: 'Leonardo' })).toBeInTheDocument();
  });

  it('imagem decorativa fica fora da árvore de acessibilidade', () => {
    const { container } = render(<MediaSlot asset="/x.webp" alt="ignorado" decorative />);
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
  });
});
