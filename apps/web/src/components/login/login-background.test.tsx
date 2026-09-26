import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const acidSquaresProps = vi.fn();

vi.mock('./acid-squares', () => ({
  default: (props: Record<string, unknown>) => {
    acidSquaresProps(props);
    return <div data-testid="acid-squares" />;
  },
}));

import { LoginBackground } from './login-background';

describe('LoginBackground', () => {
  it('é decorativo: fixo na viewport, atrás do conteúdo, fora da leitura de tela', () => {
    const { container } = render(<LoginBackground />);
    const wrapper = container.firstElementChild;
    expect(wrapper).toHaveAttribute('aria-hidden', 'true');
    expect(wrapper).toHaveClass('fixed', 'inset-0', '-z-10');
  });

  it('configura o AcidSquares com a paleta Petróleo/Verde Pulso da marca', () => {
    render(<LoginBackground />);
    expect(acidSquaresProps).toHaveBeenCalledWith(
      expect.objectContaining({
        color1: '#06302A',
        color2: '#25E27E',
        color3: '#06302A',
        mouseInteraction: true,
        grain: true,
      }),
    );
  });
});
