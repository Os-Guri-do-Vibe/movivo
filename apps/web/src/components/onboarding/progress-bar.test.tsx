import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProgressBar } from './progress-bar';

describe('ProgressBar', () => {
  it('mostra a etapa atual de 8 e o nome dela', () => {
    render(<ProgressBar currentStep={3} completedSteps={[1, 2]} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      'Etapa 3 de 8: Modalidades',
    );
    expect(screen.getByText('Etapa 3 de 8 · Modalidades')).toBeInTheDocument();
  });

  it('marca concluídas as etapas salvas e a atual como atual', () => {
    render(<ProgressBar currentStep={4} completedSteps={[1, 2, 3]} />);
    expect(screen.getByLabelText('Etapa 2: Objetivo, concluída')).toBeInTheDocument();
    expect(screen.getByLabelText('Etapa 4: Rotina, atual')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByLabelText('Etapa 6: Saúde')).toBeInTheDocument();
  });

  it('etapa salva mas revisitada aparece como atual, não como concluída', () => {
    render(<ProgressBar currentStep={2} completedSteps={[1, 2, 3]} />);
    expect(screen.getByLabelText('Etapa 2: Objetivo, atual')).toBeInTheDocument();
  });

  it('na anamnese complementar o cadastro não conta: são 7 etapas', () => {
    render(<ProgressBar currentStep={2} completedSteps={[]} firstStep={2} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      'Etapa 1 de 7: Objetivo',
    );
    expect(screen.queryByLabelText(/^Etapa 1:/)).not.toBeInTheDocument();
  });

  it('mostra o contexto da etapa quando há', () => {
    render(<ProgressBar currentStep={6} completedSteps={[]} context="Pergunta 2 de 9" />);
    expect(screen.getByText('Pergunta 2 de 9')).toBeInTheDocument();
  });
});
