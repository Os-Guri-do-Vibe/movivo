import * as React from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Block4Outcome, EMPTY_BLOCK4, type Block4State } from './block-4-outcome';

function ControlledBlock4() {
  const [data, setData] = React.useState(EMPTY_BLOCK4);
  return <Block4Outcome data={data} onChange={setData} onContinue={vi.fn()} saving={false} />;
}

function renderBlock4({
  data = EMPTY_BLOCK4,
  onChange = vi.fn(),
  onContinue = vi.fn(),
  onBack,
  initialScreen = 0,
  onScreenChange = vi.fn(),
  saving = false,
}: {
  data?: Block4State;
  onChange?: (data: Block4State) => void;
  onContinue?: () => void;
  onBack?: () => void;
  initialScreen?: number;
  onScreenChange?: (screen: number) => void;
  saving?: boolean;
} = {}) {
  render(
    <Block4Outcome
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

describe('Block4Outcome — pergunta 11 (peso, opcional)', () => {
  it('peso vazio é válido — Continuar já habilitado', () => {
    renderBlock4();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
  });

  it('peso fora da faixa desabilita Continuar', async () => {
    const user = userEvent.setup();
    render(<ControlledBlock4 />);
    await user.type(screen.getByLabelText('Peso atual, em kg (opcional)'), '5000');
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('peso com vírgula decimal dentro da faixa habilita Continuar e avança', async () => {
    const user = userEvent.setup();
    renderBlock4({ data: { ...EMPTY_BLOCK4, currentWeightKg: '78,5' } });
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByText('Pergunta 2 de 3')).toBeInTheDocument();
  });
});

describe('Block4Outcome — pergunta 12 (evolução do objetivo)', () => {
  it('sem seleção, Continuar fica desabilitado; selecionar chama onChange', async () => {
    const user = userEvent.setup();
    const { onChange } = renderBlock4({ initialScreen: 1 });
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'Dentro do esperado' }));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_BLOCK4, goalProgress: 'DENTRO_DO_ESPERADO' });
  });
});

describe('Block4Outcome — pergunta 13 (satisfação)', () => {
  it('sempre completa (tem default) — Continuar chama onContinue', async () => {
    const user = userEvent.setup();
    const { onContinue } = renderBlock4({
      data: { ...EMPTY_BLOCK4, goalProgress: 'DENTRO_DO_ESPERADO' },
      initialScreen: 2,
    });
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('mover o slider de satisfação chama onChange com o novo valor', () => {
    const { onChange } = renderBlock4({ initialScreen: 2 });
    fireEvent.change(screen.getByLabelText('Satisfação com os resultados'), {
      target: { value: '9' },
    });
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_BLOCK4, satisfaction: 9 });
  });
});

describe('Block4Outcome — navegação', () => {
  it('Voltar na primeira pergunta chama onBack', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    renderBlock4({ onBack });
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
