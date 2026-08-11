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

  it('as duas variantes têm o mesmo botão ABRIR WHATSAPP', () => {
    const { rerender } = render(<SuccessScreen outcome="READY" name="Ana" />);
    expect(screen.getByRole('link', { name: 'ABRIR WHATSAPP' })).toBeInTheDocument();
    rerender(<SuccessScreen outcome="PENDING_REVIEW" name="Ana" />);
    expect(screen.getByRole('link', { name: 'ABRIR WHATSAPP' })).toBeInTheDocument();
  });
});
