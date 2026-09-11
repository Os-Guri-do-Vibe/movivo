import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Block1Performance, EMPTY_BLOCK1, type Block1State } from './block-1-performance';

const COMPLETE: Block1State = {
  completionRate: 'SEMPRE',
  actualFrequency: 'TODOS_OS_DIAS_PLANEJADOS',
  loadProgression: 'EVOLUI_NA_MAIORIA',
  perceivedEffort: 'SOBRAVA_BASTANTE',
};

function renderBlock1({
  data = EMPTY_BLOCK1,
  onChange = vi.fn(),
  onContinue = vi.fn(),
  onBack,
  initialScreen = 0,
  onScreenChange = vi.fn(),
  saving = false,
}: {
  data?: Block1State;
  onChange?: (data: Block1State) => void;
  onContinue?: () => void;
  onBack?: () => void;
  initialScreen?: number;
  onScreenChange?: (screen: number) => void;
  saving?: boolean;
} = {}) {
  render(
    <Block1Performance
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

describe('Block1Performance', () => {
  it('começa na pergunta 1 de 4, com Continuar desabilitado sem resposta', () => {
    renderBlock1();
    expect(screen.getByText('Pergunta 1 de 4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('selecionar uma opção chama onChange com a chave certa', async () => {
    const user = userEvent.setup();
    const { onChange } = renderBlock1();
    await user.click(screen.getByRole('radio', { name: 'Sempre' }));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_BLOCK1, completionRate: 'SEMPRE' });
  });

  it('avança pelas 4 perguntas e só chama onContinue na última', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    renderBlock1({ data: COMPLETE, onContinue });

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
    renderBlock1({ data: COMPLETE, initialScreen: 1, onBack });
    expect(screen.getByText('Pergunta 2 de 4')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.getByText('Pergunta 1 de 4')).toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('Voltar na primeira pergunta chama onBack (sai do bloco)', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    renderBlock1({ data: COMPLETE, onBack });
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('sem onBack na primeira pergunta: botão Voltar não aparece', () => {
    renderBlock1({ data: COMPLETE });
    expect(screen.queryByRole('button', { name: 'Voltar' })).not.toBeInTheDocument();
  });

  it('initialScreen fora do intervalo é limitado a [0, 3]', () => {
    renderBlock1({ data: COMPLETE, initialScreen: 99 });
    expect(screen.getByText('Pergunta 4 de 4')).toBeInTheDocument();
  });
});
