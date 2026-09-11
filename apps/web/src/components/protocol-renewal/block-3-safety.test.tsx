import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Block3Safety, EMPTY_BLOCK3, type Block3State } from './block-3-safety';

function renderBlock3({
  data = EMPTY_BLOCK3,
  onChange = vi.fn(),
  onContinue = vi.fn(),
  onBack,
  initialScreen = 0,
  onScreenChange = vi.fn(),
  saving = false,
}: {
  data?: Block3State;
  onChange?: (data: Block3State) => void;
  onContinue?: () => void;
  onBack?: () => void;
  initialScreen?: number;
  onScreenChange?: (screen: number) => void;
  saving?: boolean;
} = {}) {
  render(
    <Block3Safety
      data={data}
      onChange={onChange}
      onContinue={onContinue}
      onBack={onBack}
      initialScreen={initialScreen}
      onScreenChange={onScreenChange}
      saving={saving}
    />,
  );
  return { onChange, onContinue, onScreenChange };
}

function hasNewPainGroup() {
  return within(screen.getByRole('group', { name: 'Selecione uma resposta' }));
}

describe('Block3Safety — pergunta 9 (dor nova)', () => {
  it('sem resposta: Continuar desabilitado e nenhum campo extra aparece', () => {
    renderBlock3();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    expect(screen.queryByText('Em qual região?')).not.toBeInTheDocument();
  });

  it('"Não" para dor nova já deixa a pergunta completa, sem campos extras', async () => {
    const user = userEvent.setup();
    const { onChange } = renderBlock3();
    await user.click(hasNewPainGroup().getByRole('radio', { name: 'Não' }));
    expect(onChange).toHaveBeenCalledWith({
      ...EMPTY_BLOCK3,
      newPain: { ...EMPTY_BLOCK3.newPain, hasNewPain: false },
    });
  });

  it('"Sim" revela região, intensidade, tendência e busca de cuidado; some ao voltar pra "Não"', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <Block3Safety data={EMPTY_BLOCK3} onChange={onChange} onContinue={vi.fn()} saving={false} />,
    );
    await user.click(hasNewPainGroup().getByRole('radio', { name: 'Sim' }));
    const withPain: Block3State = {
      ...EMPTY_BLOCK3,
      newPain: { ...EMPTY_BLOCK3.newPain, hasNewPain: true },
    };
    rerender(
      <Block3Safety data={withPain} onChange={onChange} onContinue={vi.fn()} saving={false} />,
    );
    expect(screen.getByText('Em qual região?')).toBeInTheDocument();
    expect(screen.getByLabelText('Intensidade (0-10)')).toBeInTheDocument();
    expect(screen.getByText('Está:')).toBeInTheDocument();
    expect(
      screen.getByRole('group', {
        name: 'Já procurou avaliação médica ou fisioterapêutica por causa disso?',
      }),
    ).toBeInTheDocument();
  });

  it('região OTHER sem detalhe: mostra o campo de texto e mantém Continuar desabilitado', () => {
    const filled: Block3State = {
      ...EMPTY_BLOCK3,
      newPain: {
        hasNewPain: true,
        region: 'OTHER',
        regionOther: '',
        intensity: 5,
        trend: 'STABLE',
        soughtCare: true,
      },
    };
    renderBlock3({ data: filled });
    expect(screen.getByLabelText('Qual é a outra região?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('região OTHER com detalhe preenchido: Continuar habilita e avança', async () => {
    const user = userEvent.setup();
    const withText: Block3State = {
      ...EMPTY_BLOCK3,
      newPain: {
        hasNewPain: true,
        region: 'OTHER',
        regionOther: 'cotovelo',
        intensity: 5,
        trend: 'STABLE',
        soughtCare: true,
      },
    };
    renderBlock3({ data: withText });
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByText('Pergunta 2 de 2')).toBeInTheDocument();
  });

  it('região diferente de OTHER, com tendência e busca de cuidado: Continuar habilita e avança pro bloco 2', async () => {
    const user = userEvent.setup();
    const complete: Block3State = {
      ...EMPTY_BLOCK3,
      newPain: {
        hasNewPain: true,
        region: 'KNEE',
        regionOther: '',
        intensity: 7,
        trend: 'WORSENING',
        soughtCare: false,
      },
    };
    renderBlock3({ data: complete });
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByText('Pergunta 2 de 2')).toBeInTheDocument();
  });

  it('mover o slider de intensidade chama onChange com o novo valor numérico', () => {
    const withPain: Block3State = {
      ...EMPTY_BLOCK3,
      newPain: {
        hasNewPain: true,
        region: 'KNEE',
        regionOther: '',
        intensity: 5,
        trend: null,
        soughtCare: undefined,
      },
    };
    const { onChange } = renderBlock3({ data: withPain });
    const slider = screen.getByLabelText('Intensidade (0-10)');
    fireEvent.change(slider, { target: { value: '8' } });
    expect(onChange).toHaveBeenCalledWith({
      ...withPain,
      newPain: { ...withPain.newPain, intensity: 8 },
    });
  });
});

describe('Block3Safety — pergunta 10 (repescagem PAR-Q)', () => {
  it('"Não" deixa a pergunta completa sem campo de detalhe', async () => {
    const user = userEvent.setup();
    const dataOnScreen1: Block3State = {
      ...EMPTY_BLOCK3,
      newPain: { ...EMPTY_BLOCK3.newPain, hasNewPain: false },
    };
    const { onChange } = renderBlock3({ data: dataOnScreen1, initialScreen: 1 });
    expect(screen.getByText('Pergunta 2 de 2')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Não' }));
    expect(onChange).toHaveBeenCalledWith({
      ...dataOnScreen1,
      parqRecheck: { changedToYes: false, detail: '' },
    });
  });

  it('"Sim" sem detalhe: mostra o campo e mantém Continuar desabilitado', () => {
    const base: Block3State = {
      ...EMPTY_BLOCK3,
      newPain: { ...EMPTY_BLOCK3.newPain, hasNewPain: false },
      parqRecheck: { changedToYes: true, detail: '' },
    };
    renderBlock3({ data: base, initialScreen: 1 });
    expect(screen.getByLabelText('Conte o que mudou')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('"Sim" com detalhe preenchido: Continuar habilita e chama onContinue', async () => {
    const user = userEvent.setup();
    const withDetail: Block3State = {
      ...EMPTY_BLOCK3,
      newPain: { ...EMPTY_BLOCK3.newPain, hasNewPain: false },
      parqRecheck: { changedToYes: true, detail: 'nova medicação para pressão' },
    };
    const { onContinue } = renderBlock3({ data: withDetail, initialScreen: 1 });
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('Voltar do bloco 2 recua pra pergunta 9, e Voltar de lá chama onBack', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const complete: Block3State = {
      ...EMPTY_BLOCK3,
      newPain: { ...EMPTY_BLOCK3.newPain, hasNewPain: false },
      parqRecheck: { changedToYes: false, detail: '' },
    };
    renderBlock3({ data: complete, initialScreen: 1, onBack });
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.getByText('Pergunta 1 de 2')).toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
