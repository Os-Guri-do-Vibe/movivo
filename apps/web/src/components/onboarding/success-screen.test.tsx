import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SuccessScreen } from './success-screen';

describe('SuccessScreen', () => {
  it('V1 (READY): "Tudo pronto" e nenhuma menção a análise', () => {
    render(<SuccessScreen outcome="READY" name="Ana" />);
    expect(screen.getByText('Tudo pronto, Ana!')).toBeInTheDocument();
    expect(screen.queryByText(/análise/i)).not.toBeInTheDocument();
  });

  it('V2 (PENDING_REVIEW): acolhe, não julga, e nunca revela respostas do usuário', () => {
    render(<SuccessScreen outcome="PENDING_REVIEW" name="Ana" />);
    expect(screen.getByText('Recebemos suas informações, Ana!')).toBeInTheDocument();
    expect(screen.getByText(/isso não significa necessariamente/i)).toBeInTheDocument();
    expect(screen.queryByText(/diagnóstico|tratamento|cura/i)).not.toBeInTheDocument();
  });

  it('as duas variantes têm o mesmo botão ENTRAR NO MOVIVO CLUB, com o link da comunidade', () => {
    const { rerender } = render(<SuccessScreen outcome="READY" name="Ana" />);
    expect(screen.getByRole('link', { name: 'ENTRAR NO MOVIVO CLUB' })).toHaveAttribute(
      'href',
      'https://chat.whatsapp.com/J3xNcNWE0UcH4qd9I2uMgR',
    );
    rerender(<SuccessScreen outcome="PENDING_REVIEW" name="Ana" />);
    expect(screen.getByRole('link', { name: 'ENTRAR NO MOVIVO CLUB' })).toHaveAttribute(
      'href',
      'https://chat.whatsapp.com/J3xNcNWE0UcH4qd9I2uMgR',
    );
  });
});
