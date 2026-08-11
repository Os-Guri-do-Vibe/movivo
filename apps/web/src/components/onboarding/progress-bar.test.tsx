import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProgressBar } from './progress-bar';

describe('ProgressBar', () => {
  it('mostra a etapa e o rótulo corretos', () => {
    render(<ProgressBar currentStep={2} />);
    expect(screen.getByText('Etapa 2 de 3 — Sua rotina de treino')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
  });

  it('nunca chega a 100% (etapa 3 ainda tem segmento parcial)', () => {
    render(<ProgressBar currentStep={3} />);
    expect(screen.getByText('Etapa 3 de 3 — Saúde')).toBeInTheDocument();
  });
});
