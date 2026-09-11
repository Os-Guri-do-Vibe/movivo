import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProgressBar } from './progress-bar';

describe('ProgressBar', () => {
  it('marca blocos anteriores como concluídos e o bloco atual como atual', () => {
    render(<ProgressBar currentBlock={3} blockContext="Pergunta 1 de 2" />);

    expect(screen.getByLabelText('Bloco 1: Desempenho. Concluído')).toBeInTheDocument();
    expect(screen.getByLabelText('Bloco 2: Fadiga. Concluído')).toBeInTheDocument();
    expect(screen.getByLabelText('Bloco 3: Segurança. Atual')).toBeInTheDocument();
    expect(screen.getByLabelText('Bloco 4: Resultado. Próximo')).toBeInTheDocument();
    expect(screen.getByLabelText('Bloco 5: Contexto. Próximo')).toBeInTheDocument();
  });

  it('expõe o progresso via aria-valuenow/aria-valuetext', () => {
    render(<ProgressBar currentBlock={2} blockContext="Pergunta 3 de 4" />);
    const bar = screen.getByRole('progressbar', { name: 'Progresso do formulário' });
    expect(bar).toHaveAttribute('aria-valuenow', '2');
    expect(bar).toHaveAttribute('aria-valuetext', 'Pergunta 3 de 4, bloco 2 de 5');
    expect(screen.getByText('Pergunta 3 de 4')).toBeInTheDocument();
  });

  it('sem blockContext: aria-valuetext cai no formato curto e o rodapé de contexto some', () => {
    render(<ProgressBar currentBlock={1} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Bloco 1 de 5');
  });
});
