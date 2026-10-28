import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  EMPTY_GOALS,
  EMPTY_MODALITIES,
  EMPTY_NUTRITION,
  EMPTY_PREFERENCES,
  EMPTY_ROUTINE,
} from './onboarding-drafts';
import { StepBody } from './step-body';
import { StepGoals } from './step-goals';
import { StepModalities } from './step-modalities';
import { StepNutrition } from './step-nutrition';
import { StepPreferences } from './step-preferences';
import { StepRoutine } from './step-routine';

const common = { onContinue: vi.fn(), onChange: vi.fn(), saving: false };

describe('aviso de respostas sigilosas ao retomar', () => {
  it.each([
    ['objetivos', <StepGoals key="g" {...common} data={EMPTY_GOALS} resumed />],
    [
      'preferências e saúde',
      <StepPreferences key="p" {...common} data={EMPTY_PREFERENCES} resumed />,
    ],
    ['alimentação', <StepNutrition key="n" {...common} data={EMPTY_NUTRITION} resumed />],
  ])('%s: mostra o aviso quando a etapa já foi respondida', (_name, element) => {
    render(element);
    expect(screen.getByText(/guardad[oa]s? em sigilo/)).toBeInTheDocument();
  });

  it('sem retomada, não mostra aviso', () => {
    render(<StepGoals {...common} data={EMPTY_GOALS} resumed={false} />);
    expect(screen.queryByText(/em sigilo/)).not.toBeInTheDocument();
  });
});

describe('Continuar só habilita com o essencial', () => {
  it('objetivos: precisa do objetivo principal e da ênfase', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <StepGoals {...common} onChange={onChange} data={EMPTY_GOALS} resumed={false} />,
    );
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'Perder gordura' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ primary: 'FAT_LOSS' }));
    rerender(
      <StepGoals
        {...common}
        data={{ ...EMPTY_GOALS, primary: 'FAT_LOSS', emphasis: 'HEALTH' }}
        resumed={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
  });

  it('modalidades: mostra campos de corrida só para quem escolheu corrida', () => {
    const data = structuredClone(EMPTY_MODALITIES);
    data.venues = ['OUTDOOR'];
    const { rerender } = render(<StepModalities {...common} data={data} />);
    expect(screen.queryByLabelText(/km você corre/i)).not.toBeInTheDocument();
    data.modalities.RUNNING = { ...data.modalities.RUNNING, selected: true };
    rerender(<StepModalities {...common} data={data} />);
    expect(screen.getByLabelText(/km você corre/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
  });

  it('rotina: sem dia marcado não continua; com dia e limite, continua', () => {
    const data = structuredClone(EMPTY_ROUTINE);
    const { rerender } = render(<StepRoutine {...common} data={data} />);
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    data.days.MON = { on: true, slot: 'EVENING', minutes: '60' };
    data.maxSessions = '3';
    rerender(<StepRoutine {...common} data={data} />);
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
    // O dia marcado ganha um cartão próprio para horário e tempo disponível.
    expect(screen.getByLabelText(/quanto tempo você tem/i)).toBeInTheDocument();
  });
});

describe('etapa de corpo', () => {
  it('é opcional: pular finaliza sem medidas; preencher habilita salvar', async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    const { rerender } = render(
      <StepBody data={{}} onChange={vi.fn()} onFinish={onFinish} saving={false} />,
    );
    expect(screen.getByRole('button', { name: 'Salvar e finalizar' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Pular esta etapa' }));
    expect(onFinish).toHaveBeenCalledWith(false);
    rerender(
      <StepBody data={{ WAIST: '90' }} onChange={vi.fn()} onFinish={onFinish} saving={false} />,
    );
    await user.click(screen.getByRole('button', { name: 'Salvar e finalizar' }));
    expect(onFinish).toHaveBeenLastCalledWith(true);
  });
});
