import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Block5Context, EMPTY_BLOCK5, type Block5State } from './block-5-context';

function renderBlock5({
  data = EMPTY_BLOCK5,
  onChange = vi.fn(),
  hasTargetEvent = false,
  onContinue = vi.fn(),
  onBack,
  initialScreen = 0,
  onScreenChange = vi.fn(),
  saving = false,
}: {
  data?: Block5State;
  onChange?: (data: Block5State) => void;
  hasTargetEvent?: boolean;
  onContinue?: () => void;
  onBack?: () => void;
  initialScreen?: number;
  onScreenChange?: (screen: number) => void;
  saving?: boolean;
} = {}) {
  render(
    <Block5Context
      data={data}
      onChange={onChange}
      hasTargetEvent={hasTargetEvent}
      onContinue={onContinue}
      onBack={onBack}
      initialScreen={initialScreen}
      onScreenChange={onScreenChange}
      saving={saving}
    />,
  );
  return { onChange, onContinue, onScreenChange };
}

describe('Block5Context — pergunta 14 (o que mudou)', () => {
  it('nada selecionado: Continuar desabilitado', () => {
    renderBlock5();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('marcar "Dias disponíveis por semana" adiciona ao array changes', async () => {
    const user = userEvent.setup();
    const { onChange } = renderBlock5();
    await user.click(screen.getByRole('button', { name: 'Dias disponíveis por semana' }));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_BLOCK5, changes: ['DAYS_PER_WEEK'] });
  });

  it('desmarcar uma mudança já selecionada remove do array', async () => {
    const user = userEvent.setup();
    const { onChange } = renderBlock5({
      data: { ...EMPTY_BLOCK5, changes: ['DAYS_PER_WEEK', 'SESSION_DURATION'] },
    });
    await user.click(screen.getByRole('button', { name: 'Dias disponíveis por semana' }));
    expect(onChange).toHaveBeenCalledWith({
      ...EMPTY_BLOCK5,
      changes: ['SESSION_DURATION'],
    });
  });

  it('marcar "Nenhuma mudança" zera as outras seleções', async () => {
    const user = userEvent.setup();
    const { onChange } = renderBlock5({
      data: { ...EMPTY_BLOCK5, changes: ['DAYS_PER_WEEK'] },
    });
    await user.click(screen.getByRole('button', { name: 'Nenhuma mudança' }));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_BLOCK5, changes: ['NONE'] });
  });

  it('desmarcar "Nenhuma mudança" volta pra array vazio', async () => {
    const user = userEvent.setup();
    const { onChange } = renderBlock5({ data: { ...EMPTY_BLOCK5, changes: ['NONE'] } });
    await user.click(screen.getByRole('button', { name: 'Nenhuma mudança' }));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_BLOCK5, changes: [] });
  });

  it('"Nenhuma mudança" já é suficiente para habilitar Continuar', () => {
    renderBlock5({ data: { ...EMPTY_BLOCK5, changes: ['NONE'] } });
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
  });

  it('DAYS_PER_WEEK revela dias/semana e dias preferidos; exige daysPerWeek pra completar', async () => {
    const user = userEvent.setup();
    const { onChange } = renderBlock5({
      data: { ...EMPTY_BLOCK5, changes: ['DAYS_PER_WEEK'] },
    });
    expect(
      screen.getByText('Quantos dias por semana você tem disponível agora?'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: '3 dias' }));
    expect(onChange).toHaveBeenCalledWith({
      ...EMPTY_BLOCK5,
      changes: ['DAYS_PER_WEEK'],
      daysPerWeek: 3,
    });

    await user.click(screen.getByRole('button', { name: 'Segunda' }));
    expect(onChange).toHaveBeenCalledWith({
      ...EMPTY_BLOCK5,
      changes: ['DAYS_PER_WEEK'],
      preferredDays: ['MON'],
    });
  });

  it('daysPerWeek preenchido habilita Continuar mesmo com preferredDays vazio (opcional)', () => {
    renderBlock5({
      data: { ...EMPTY_BLOCK5, changes: ['DAYS_PER_WEEK'], daysPerWeek: 4 },
    });
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
  });

  it('remover um dia preferido já selecionado', async () => {
    const user = userEvent.setup();
    const { onChange } = renderBlock5({
      data: {
        ...EMPTY_BLOCK5,
        changes: ['DAYS_PER_WEEK'],
        daysPerWeek: 2,
        preferredDays: ['MON', 'WED'],
      },
    });
    await user.click(screen.getByRole('button', { name: 'Segunda' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ preferredDays: ['WED'] }));
  });

  it('SESSION_DURATION revela a escolha de duração e exige resposta', () => {
    renderBlock5({ data: { ...EMPTY_BLOCK5, changes: ['SESSION_DURATION'] } });
    expect(
      screen.getByText('Quanto tempo você tem disponível por treino agora?'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('SESSION_DURATION preenchida habilita Continuar', () => {
    renderBlock5({
      data: { ...EMPTY_BLOCK5, changes: ['SESSION_DURATION'], sessionDuration: 'M45_TO_60' },
    });
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
  });

  it('TRAINING_LOCATION revela a escolha de local e exige resposta', () => {
    renderBlock5({ data: { ...EMPTY_BLOCK5, changes: ['TRAINING_LOCATION'] } });
    expect(screen.getByText('Onde você pretende treinar agora?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('as 3 mudanças combinadas só completam quando todas as 3 respostas existem', () => {
    renderBlock5({
      data: {
        ...EMPTY_BLOCK5,
        changes: ['DAYS_PER_WEEK', 'SESSION_DURATION', 'TRAINING_LOCATION'],
        daysPerWeek: 3,
        sessionDuration: 'M45_TO_60',
        location: null,
      },
    });
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('avança pra pergunta 15 ao completar a 14', async () => {
    const user = userEvent.setup();
    renderBlock5({ data: { ...EMPTY_BLOCK5, changes: ['NONE'] } });
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByText('Pergunta 2 de 4')).toBeInTheDocument();
  });
});

describe('Block5Context — pergunta 15 (exercício não gostado)', () => {
  const AT_SCREEN_1 = { ...EMPTY_BLOCK5, changes: ['NONE' as const] };

  it('"Não" completa a pergunta sem campo extra', async () => {
    const user = userEvent.setup();
    const { onChange } = renderBlock5({ data: AT_SCREEN_1, initialScreen: 1 });
    await user.click(screen.getByRole('radio', { name: 'Não' }));
    expect(onChange).toHaveBeenCalledWith({
      ...AT_SCREEN_1,
      dislikedExercise: { has: false, description: '' },
    });
  });

  it('"Sim" revela o campo de descrição e exige preenchimento', () => {
    renderBlock5({
      data: { ...AT_SCREEN_1, dislikedExercise: { has: true, description: '' } },
      initialScreen: 1,
    });
    expect(screen.getByLabelText('Qual exercício?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('"Sim" com descrição preenchida habilita Continuar', () => {
    renderBlock5({
      data: { ...AT_SCREEN_1, dislikedExercise: { has: true, description: 'burpee' } },
      initialScreen: 1,
    });
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
  });
});

describe('Block5Context — pergunta 16 (barreiras)', () => {
  const AT_SCREEN_2 = {
    ...EMPTY_BLOCK5,
    changes: ['NONE' as const],
    dislikedExercise: { has: false, description: '' },
  };

  it('vazio (nenhuma barreira) já é uma resposta válida — Continuar habilitado', () => {
    renderBlock5({ data: AT_SCREEN_2, initialScreen: 2 });
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Nenhuma, está indo bem' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('marcar uma barreira real substitui a opção "Nenhuma"', async () => {
    const user = userEvent.setup();
    const { onChange } = renderBlock5({ data: AT_SCREEN_2, initialScreen: 2 });
    await user.click(screen.getByRole('button', { name: 'Falta de tempo' }));
    expect(onChange).toHaveBeenCalledWith({ ...AT_SCREEN_2, barriers: ['LACK_OF_TIME'] });
  });

  it('desmarcar a última barreira volta ao estado vazio', async () => {
    const user = userEvent.setup();
    const { onChange } = renderBlock5({
      data: { ...AT_SCREEN_2, barriers: ['LACK_OF_TIME'] },
      initialScreen: 2,
    });
    await user.click(screen.getByRole('button', { name: 'Falta de tempo' }));
    expect(onChange).toHaveBeenCalledWith({ ...AT_SCREEN_2, barriers: [] });
  });

  it('marcar "Nenhuma" explicitamente zera qualquer seleção anterior', async () => {
    const user = userEvent.setup();
    const { onChange } = renderBlock5({
      data: { ...AT_SCREEN_2, barriers: ['LACK_OF_TIME', 'COST'] },
      initialScreen: 2,
    });
    await user.click(screen.getByRole('button', { name: 'Nenhuma, está indo bem' }));
    expect(onChange).toHaveBeenCalledWith({ ...AT_SCREEN_2, barriers: [] });
  });
});

describe('Block5Context — pergunta 17 (objetivo)', () => {
  const AT_SCREEN_3 = {
    ...EMPTY_BLOCK5,
    changes: ['NONE' as const],
    dislikedExercise: { has: false, description: '' },
  };

  it('"continua o mesmo" completa sem campo extra', async () => {
    const user = userEvent.setup();
    const { onChange } = renderBlock5({ data: AT_SCREEN_3, initialScreen: 3 });
    await user.click(screen.getByRole('radio', { name: 'Sim, continua o mesmo' }));
    expect(onChange).toHaveBeenCalledWith({
      ...AT_SCREEN_3,
      goalChange: { changed: false, newGoal: null },
    });
  });

  it('"mudou" revela a lista de objetivos e exige escolha', () => {
    renderBlock5({
      data: { ...AT_SCREEN_3, goalChange: { changed: true, newGoal: null } },
      initialScreen: 3,
    });
    expect(screen.getByText('Qual é o seu novo objetivo principal?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar formulário' })).toBeDisabled();
  });

  it('novo objetivo selecionado habilita Continuar e envia (sem hasTargetEvent)', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    renderBlock5({
      data: { ...AT_SCREEN_3, goalChange: { changed: true, newGoal: 'GAIN_MUSCLE' } },
      initialScreen: 3,
      onContinue,
      hasTargetEvent: false,
    });
    expect(screen.getByRole('button', { name: 'Enviar formulário' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Enviar formulário' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

describe('Block5Context — pergunta 18 (data-alvo, só quando hasTargetEvent)', () => {
  const AT_SCREEN_4 = {
    ...EMPTY_BLOCK5,
    changes: ['NONE' as const],
    dislikedExercise: { has: false, description: '' },
    goalChange: { changed: false, newGoal: null },
  };

  it('sem hasTargetEvent, o formulário tem só 4 perguntas (bloco 17 já envia)', () => {
    renderBlock5({ data: AT_SCREEN_4, hasTargetEvent: false, initialScreen: 3 });
    expect(screen.getByText('Pergunta 4 de 4')).toBeInTheDocument();
  });

  it('com hasTargetEvent, aparece a 5ª pergunta e "Continua de pé" já completa', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const { onChange } = renderBlock5({
      data: AT_SCREEN_4,
      hasTargetEvent: true,
      initialScreen: 4,
      onContinue,
    });
    expect(screen.getByText('Pergunta 5 de 5')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Sim, continua de pé' }));
    expect(onChange).toHaveBeenCalledWith({
      ...AT_SCREEN_4,
      targetEvent: { status: 'STILL_ON', newDate: '' },
    });
  });

  it('"Mudou a data" revela o seletor de data e mantém Continuar desabilitado sem data', () => {
    renderBlock5({
      data: { ...AT_SCREEN_4, targetEvent: { status: 'DATE_CHANGED', newDate: '' } },
      hasTargetEvent: true,
      initialScreen: 4,
    });
    expect(screen.getByLabelText('Qual é a nova data?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar formulário' })).toBeDisabled();
  });

  it('"Não tenho mais esse evento" completa sem campo de data', () => {
    renderBlock5({
      data: { ...AT_SCREEN_4, targetEvent: { status: 'NO_LONGER_APPLIES', newDate: '' } },
      hasTargetEvent: true,
      initialScreen: 4,
    });
    expect(screen.getByRole('button', { name: 'Enviar formulário' })).toBeEnabled();
  });
});

describe('Block5Context — navegação', () => {
  it('Voltar na primeira pergunta chama onBack', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    renderBlock5({ onBack });
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('Voltar dentro do bloco recua uma pergunta', async () => {
    const user = userEvent.setup();
    renderBlock5({ data: { ...EMPTY_BLOCK5, changes: ['NONE'] }, initialScreen: 1 });
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.getByText('Pergunta 1 de 4')).toBeInTheDocument();
  });
});

describe('Block5Context — rótulos do rodapé', () => {
  it('rótulo "Continuar"/"Salvando…" fora da última pergunta', () => {
    renderBlock5({ saving: true });
    expect(screen.getByRole('button', { name: 'Salvando…' })).toBeInTheDocument();
  });

  it('rótulo "Enviar formulário"/"Enviando…" na última pergunta', () => {
    renderBlock5({
      data: {
        ...EMPTY_BLOCK5,
        changes: ['NONE'],
        dislikedExercise: { has: false, description: '' },
        goalChange: { changed: false, newGoal: null },
      },
      initialScreen: 3,
      saving: true,
    });
    expect(screen.getByRole('button', { name: 'Enviando…' })).toBeInTheDocument();
  });
});
