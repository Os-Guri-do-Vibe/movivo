import * as React from 'react';

import { PARQ_DECLARATIONS, PARQ_QUESTION_IDS, PARQ_QUESTION_TEXT } from '@movivo/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Step3Parq, EMPTY_PARQ, type ParqState } from './step3-parq';

function allNo(): ParqState {
  const state = structuredClone(EMPTY_PARQ);
  for (const id of PARQ_QUESTION_IDS) state[id] = { answer: false, detail: '' };
  return state;
}

function allDeclared(): Set<string> {
  return new Set(PARQ_DECLARATIONS.map((declaration) => declaration.id));
}

function renderStep3(overrides: Partial<Parameters<typeof Step3Parq>[0]> = {}) {
  const props: Parameters<typeof Step3Parq>[0] = {
    answers: EMPTY_PARQ,
    onChange: vi.fn(),
    declarations: new Set(),
    onToggleDeclaration: vi.fn(),
    onSubmit: vi.fn(),
    submitting: false,
    ...overrides,
  };
  render(<Step3Parq {...props} />);
  return props;
}

function ControlledStep3() {
  const [answers, setAnswers] = React.useState(EMPTY_PARQ);
  return (
    <Step3Parq
      answers={answers}
      onChange={(id, value) => setAnswers((current) => ({ ...current, [id]: value }))}
      declarations={new Set()}
      onToggleDeclaration={vi.fn()}
      onSubmit={vi.fn()}
      initialScreen={0}
      submitting={false}
    />
  );
}

describe('Step3Parq', () => {
  it('abre com a explicação de segurança antes das perguntas', () => {
    renderStep3();
    const heading = screen.getByRole('heading', { name: 'Última parte: sua segurança' });
    const warning = screen.getByText(/Se alguma resposta for “sim”/i);

    expect(heading).toHaveClass('text-h1', 'font-bold', 'text-petroleo');
    expect(heading.parentElement?.parentElement).toHaveClass('gap-6');
    expect(warning).toHaveClass('border-coral', 'bg-coral/10');
    expect(warning).not.toHaveClass('bg-secondary');
    expect(screen.queryByText(PARQ_QUESTION_TEXT.Q1)).not.toBeInTheDocument();
  });

  it('padroniza o título da pergunta e posiciona os círculos à esquerda', () => {
    renderStep3({ initialScreen: 0 });

    const question = screen.getByRole('heading', { name: PARQ_QUESTION_TEXT.Q1 });
    const noOption = screen.getByRole('radio', { name: 'Não' });
    const yesOption = screen.getByRole('radio', { name: 'Sim' });

    expect(question).toHaveClass('text-body', 'font-semibold', 'text-foreground');
    for (const option of [noOption, yesOption]) {
      expect(option).toHaveClass('justify-start');
      expect(option.firstElementChild).toHaveClass('rounded-full');
    }
  });

  it('Começar mostra somente a primeira pergunta oficial e move o foco', async () => {
    const user = userEvent.setup();
    renderStep3();
    await user.click(screen.getByRole('button', { name: 'Começar' }));
    const title = screen.getByRole('heading', { name: PARQ_QUESTION_TEXT.Q1 });
    expect(title).toHaveFocus();
    expect(screen.queryByText(PARQ_QUESTION_TEXT.Q2)).not.toBeInTheDocument();
  });

  it('responder Sim mantém o texto oficial e mostra a confirmação humana', () => {
    const answers = structuredClone(EMPTY_PARQ);
    answers.Q1 = { answer: true, detail: '' };
    renderStep3({ answers, initialScreen: 0 });
    expect(screen.getByText(PARQ_QUESTION_TEXT.Q1)).toBeInTheDocument();
    expect(screen.getByText('Anotado. Obrigado por contar.')).toBeInTheDocument();
  });

  it('Voltar não perde a resposta já marcada', async () => {
    const user = userEvent.setup();
    render(<ControlledStep3 />);
    await user.click(screen.getByRole('radio', { name: 'Não' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByText(PARQ_QUESTION_TEXT.Q2)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.getByRole('radio', { name: 'Não' })).toHaveAttribute('aria-checked', 'true');
  });

  it('Q9 = Sim sem motivo mantém Continuar desabilitado', () => {
    const answers = allNo();
    answers.Q9 = { answer: true, detail: '' };
    renderStep3({ answers, initialScreen: 8 });
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('confirmações preservam o texto compartilhado verbatim', () => {
    renderStep3({ answers: allNo(), initialScreen: 9 });
    for (const declaration of PARQ_DECLARATIONS) {
      expect(screen.getByLabelText(declaration.label)).toBeInTheDocument();
    }
  });

  it('tudo declarado habilita Finalizar avaliação e chama onSubmit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderStep3({
      answers: allNo(),
      declarations: allDeclared(),
      initialScreen: 9,
      onSubmit,
    });
    const button = screen.getByRole('button', { name: 'Finalizar avaliação' });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
