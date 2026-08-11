import { PARQ_DECLARATIONS, PARQ_QUESTION_IDS } from '@movivo/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Step3Parq, EMPTY_PARQ, type ParqState } from './step3-parq';

function allNo(): ParqState {
  const s = structuredClone(EMPTY_PARQ);
  for (const id of PARQ_QUESTION_IDS) s[id] = { answer: false, detail: '' };
  return s;
}

function allDeclared(): Set<string> {
  return new Set(PARQ_DECLARATIONS.map((d) => d.id));
}

describe('Step3Parq', () => {
  it('renderiza as 9 perguntas oficiais', () => {
    render(
      <Step3Parq
        answers={EMPTY_PARQ}
        onChange={vi.fn()}
        declarations={new Set()}
        onToggleDeclaration={vi.fn()}
        onSubmit={vi.fn()}
        submitting={false}
      />,
    );
    expect(
      screen.getByText(/O seu médico já disse que você tem algum problema no coração/),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Sim').length).toBe(PARQ_QUESTION_IDS.length);
  });

  it('FINALIZAR fica desabilitado até todas as perguntas e declarações estarem completas', () => {
    render(
      <Step3Parq
        answers={EMPTY_PARQ}
        onChange={vi.fn()}
        declarations={new Set()}
        onToggleDeclaration={vi.fn()}
        onSubmit={vi.fn()}
        submitting={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'FINALIZAR AVALIAÇÃO' })).toBeDisabled();
  });

  it('Q9 = Sim sem motivo mantém o botão desabilitado', () => {
    const answers = allNo();
    answers.Q9 = { answer: true, detail: '' };
    render(
      <Step3Parq
        answers={answers}
        onChange={vi.fn()}
        declarations={allDeclared()}
        onToggleDeclaration={vi.fn()}
        onSubmit={vi.fn()}
        submitting={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'FINALIZAR AVALIAÇÃO' })).toBeDisabled();
  });

  it('responder "Sim" numa pergunta revela o follow-up opcional e chama onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Step3Parq
        answers={EMPTY_PARQ}
        onChange={onChange}
        declarations={new Set()}
        onToggleDeclaration={vi.fn()}
        onSubmit={vi.fn()}
        submitting={false}
      />,
    );
    const [firstSim] = screen.getAllByText('Sim');
    await user.click(firstSim as HTMLElement);
    expect(onChange).toHaveBeenCalledWith('Q1', { answer: true, detail: '' });
  });

  it('marcar/desmarcar uma declaração chama onToggleDeclaration', async () => {
    const user = userEvent.setup();
    const onToggleDeclaration = vi.fn();
    render(
      <Step3Parq
        answers={allNo()}
        onChange={vi.fn()}
        declarations={new Set()}
        onToggleDeclaration={onToggleDeclaration}
        onSubmit={vi.fn()}
        submitting={false}
      />,
    );
    const [declaration] = PARQ_DECLARATIONS;
    if (!declaration) throw new Error('PARQ_DECLARATIONS vazio');
    await user.click(screen.getByLabelText(declaration.label));
    expect(onToggleDeclaration).toHaveBeenCalledWith(declaration.id, true);
  });

  it('tudo respondido + declarado habilita o FINALIZAR e chama onSubmit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <Step3Parq
        answers={allNo()}
        onChange={vi.fn()}
        declarations={allDeclared()}
        onToggleDeclaration={vi.fn()}
        onSubmit={onSubmit}
        submitting={false}
      />,
    );
    const button = screen.getByRole('button', { name: 'FINALIZAR AVALIAÇÃO' });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onSubmit).toHaveBeenCalled();
  });
});
