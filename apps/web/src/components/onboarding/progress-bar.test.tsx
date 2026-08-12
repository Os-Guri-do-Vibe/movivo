import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProgressBar } from './progress-bar';

describe('ProgressBar', () => {
  it('não repete o rótulo numérico na primeira etapa', () => {
    render(<ProgressBar currentStep={1} />);
    expect(screen.queryByText('Etapa 1 de 3')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      'Você, passo atual 1 de 3',
    );
  });

  it('mostra a etapa e o rótulo corretos', () => {
    render(<ProgressBar currentStep={2} step2Section={2} />);
    expect(screen.getByText('Parte 3 de 5')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      'Parte 3 de 5, etapa 2 de 3',
    );
    expect(screen.getByLabelText('Etapa 1: Você. Concluída')).toBeInTheDocument();
    expect(screen.getByLabelText('Etapa 2: Sua rotina. Atual')).toHaveAttribute(
      'aria-current',
      'step',
    );
    expect(screen.getByLabelText('Etapa 3: Saúde. Próxima')).toBeInTheDocument();
  });

  it('liga os três checkpoints ao chegar à etapa 3 sem marcá-la como concluída', () => {
    render(<ProgressBar currentStep={3} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3');
    expect(screen.getByLabelText('Etapa 2: Sua rotina. Concluída')).toBeInTheDocument();
    expect(screen.getByLabelText('Etapa 3: Saúde. Atual')).toHaveTextContent('3SaúdeAtual');
  });
});
