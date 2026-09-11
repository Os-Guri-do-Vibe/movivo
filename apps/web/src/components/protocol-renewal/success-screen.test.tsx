import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RenewalSuccessScreen } from './success-screen';

describe('RenewalSuccessScreen', () => {
  it('cumprimenta pelo nome e menciona a revisão do profissional CREF', () => {
    render(<RenewalSuccessScreen name="Maria" />);
    expect(screen.getByRole('heading', { name: /Recebemos suas respostas, Maria!/ })).toBeVisible();
    expect(screen.getByText(/registrado no CREF revisa o protocolo/)).toBeVisible();
  });
});
