import * as React from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BlockFooter, QuestionHeader } from './block-shell';

describe('QuestionHeader', () => {
  it('mostra "Pergunta N de M" e o título dentro do heading', () => {
    const ref = React.createRef<HTMLHeadingElement>();
    render(
      <QuestionHeader index={2} total={4} titleId="q2" titleRef={ref}>
        Como foi sua fadiga?
      </QuestionHeader>,
    );
    expect(screen.getByText('Pergunta 2 de 4')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Como foi sua fadiga?' })).toHaveAttribute(
      'id',
      'q2',
    );
  });
});

describe('BlockFooter', () => {
  it('sem onBack: não mostra o botão Voltar', () => {
    render(<BlockFooter onContinue={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Voltar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeInTheDocument();
  });

  it('com onBack: clique dispara o callback', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<BlockFooter onBack={onBack} onContinue={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('clique em Continuar dispara o callback', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(<BlockFooter onContinue={onContinue} />);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('disabled: botão Continuar fica desabilitado', () => {
    render(<BlockFooter onContinue={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('saving: mostra o rótulo de salvando e desabilita Voltar/Continuar', () => {
    render(<BlockFooter onBack={vi.fn()} onContinue={vi.fn()} saving />);
    expect(screen.getByRole('button', { name: 'Salvando…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeDisabled();
  });

  it('rótulos customizados substituem os defaults', () => {
    render(
      <BlockFooter
        onBack={vi.fn()}
        onContinue={vi.fn()}
        backLabel="Cancelar"
        continueLabel="Enviar"
        savingLabel="Enviando…"
      />,
    );
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeInTheDocument();
  });
});
