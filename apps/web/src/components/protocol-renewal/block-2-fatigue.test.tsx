import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Block2Fatigue, EMPTY_BLOCK2, type Block2State } from './block-2-fatigue';

const COMPLETE: Block2State = {
  fatigueLevel: 'BAIXO_RECUPERADO',
  sleepQuality: 'BOA',
  stressLevel: 'BAIXO',
  muscleSoreness: 'NORMAL',
};

function renderBlock2({
  data = EMPTY_BLOCK2,
  onChange = vi.fn(),
  onContinue = vi.fn(),
  onBack,
  initialScreen = 0,
  onScreenChange = vi.fn(),
  saving = false,
}: {
  data?: Block2State;
  onChange?: (data: Block2State) => void;
  onContinue?: () => void;
  onBack?: () => void;
  initialScreen?: number;
  onScreenChange?: (screen: number) => void;
  saving?: boolean;
} = {}) {
  render(
    <Block2Fatigue
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

describe('Block2Fatigue', () => {
  it('começa na pergunta 1 de 4, com Continuar desabilitado sem resposta', () => {
    renderBlock2();
    expect(screen.getByText('Pergunta 1 de 4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('selecionar uma opção chama onChange com a chave certa', async () => {
    const user = userEvent.setup();
    const { onChange } = renderBlock2();
    await user.click(screen.getByRole('radio', { name: 'Moderado, cansaço normal' }));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_BLOCK2, fatigueLevel: 'MODERADO' });
  });

  it('avança pelas 4 perguntas e só chama onContinue na última', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    renderBlock2({ data: COMPLETE, onContinue });

    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByText('Pergunta 2 de 4')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByText('Pergunta 3 de 4')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByText('Pergunta 4 de 4')).toBeInTheDocument();
    expect(onContinue).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('Voltar dentro do bloco recua uma pergunta sem chamar onBack', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    renderBlock2({ data: COMPLETE, initialScreen: 1, onBack });
    expect(screen.getByText('Pergunta 2 de 4')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.getByText('Pergunta 1 de 4')).toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('Voltar na primeira pergunta chama onBack (sai do bloco)', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    renderBlock2({ data: COMPLETE, onBack });
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('sem onBack na primeira pergunta: botão Voltar não aparece', () => {
    renderBlock2({ data: COMPLETE });
    expect(screen.queryByRole('button', { name: 'Voltar' })).not.toBeInTheDocument();
  });
});
