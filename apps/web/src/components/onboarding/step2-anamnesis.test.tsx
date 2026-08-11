import * as React from 'react';

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Step2Anamnesis, EMPTY_STEP2, type Step2State } from './step2-anamnesis';

const COMPLETE: Step2State = {
  ...EMPTY_STEP2,
  primaryGoal: 'GAIN_MUSCLE',
  trainingStatus: 'REGULAR',
  experience: 'BEGINNER',
  daysPerWeek: 3,
  sessionDuration: 'M45_TO_60',
  location: 'HOME',
  preferredPeriod: 'MORNING',
};

function renderStep2({
  data = COMPLETE,
  onChange = vi.fn(),
  onContinue = vi.fn(),
  initialSection = 0,
}: {
  data?: Step2State;
  onChange?: (data: Step2State) => void;
  onContinue?: () => void;
  initialSection?: number;
} = {}) {
  render(
    <Step2Anamnesis
      data={data}
      onChange={onChange}
      onContinue={onContinue}
      initialSection={initialSection}
      saving={false}
    />,
  );
  return { onChange, onContinue };
}

function ControlledStep2({ initialSection = 0 }: { initialSection?: number }) {
  const [data, setData] = React.useState(COMPLETE);
  return (
    <Step2Anamnesis
      data={data}
      onChange={setData}
      onContinue={vi.fn()}
      initialSection={initialSection}
      saving={false}
    />
  );
}

describe('Step2Anamnesis', () => {
  it('mostra somente uma das cinco seções por vez', () => {
    renderStep2();
    expect(screen.getByRole('heading', { name: 'Seus objetivos' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Seu histórico' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sua rotina' })).not.toBeInTheDocument();
  });

  it('mantém a rotina com a mesma tipografia e o mesmo ritmo da etapa Você', () => {
    renderStep2({ initialSection: 2 });
    const heading = screen.getByRole('heading', { name: 'Sua rotina' });
    const description = screen.getByText('O que cabe na sua semana de verdade.');
    const firstQuestion = screen.getByText('Quantos dias por semana você consegue treinar?');

    expect(heading).toHaveClass('text-h1', 'font-bold', 'text-petroleo');
    expect(heading).not.toHaveClass('mt-1');
    expect(description).toHaveClass('mt-2', 'text-body', 'text-muted-foreground');
    expect(firstQuestion).toHaveClass('text-body', 'font-semibold', 'text-foreground');
    expect(firstQuestion.nextElementSibling).toHaveClass('mt-2');
    expect(screen.queryByText('Rotina · 3 de 5')).not.toBeInTheDocument();
  });

  it('mostra os objetivos atuais em lista com o círculo à esquerda', () => {
    renderStep2();
    const expectedLabels = [
      'Hipertrofia',
      'Força',
      'Emagrecimento',
      'Condicionamento físico',
      'Saúde e bem estar',
      'Competir em fisiculturismo',
      'Outro',
    ];
    const goalGroup = screen.getByRole('group', { name: 'Qual é o seu principal objetivo?' });
    const goals = within(goalGroup);

    expect(goals.getAllByRole('radio')).toHaveLength(expectedLabels.length);
    for (const label of expectedLabels) {
      const option = goals.getByRole('radio', { name: label });
      expect(option.parentElement).toHaveClass('grid-cols-1');
      expect(option).toHaveClass('justify-start');
      expect(option.firstElementChild).toHaveClass('rounded-full');
    }
    expect(screen.queryByText('Criar uma rotina de treino')).not.toBeInTheDocument();
    expect(screen.queryByText('Voltar a treinar')).not.toBeInTheDocument();
  });

  it('navega pelas cinco seções e só chama onContinue na última', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    renderStep2({ onContinue });

    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByRole('heading', { name: 'Seu histórico' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByRole('heading', { name: 'Sua rotina' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByRole('heading', { name: 'Dores e limitações' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByRole('heading', { name: 'Suas preferências' })).toBeInTheDocument();
    expect(onContinue).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Continuar para saúde' }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('Voltar preserva as respostas já preenchidas', async () => {
    const user = userEvent.setup();
    render(<ControlledStep2 />);
    expect(screen.getByRole('radio', { name: 'Hipertrofia' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.getByRole('radio', { name: 'Hipertrofia' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('move o foco para o título ao navegar', async () => {
    const user = userEvent.setup();
    renderStep2();
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByRole('heading', { name: 'Seu histórico' })).toHaveFocus();
  });

  it('objetivo Outro revela o texto livre', () => {
    renderStep2({ data: { ...COMPLETE, primaryGoal: 'OTHER' } });
    expect(screen.getByLabelText(/Conta em poucas palavras/i)).toBeInTheDocument();
  });

  it('usa o mesmo calendário da data de nascimento na data do evento', async () => {
    const user = userEvent.setup();
    renderStep2({
      data: { ...COMPLETE, hasImportantEvent: true, importantEventDate: '' },
    });
    const input = screen.getByLabelText('Qual é a data?');

    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('placeholder', 'dd/mm/aaaa');
    await user.click(input);

    expect(screen.getByRole('dialog', { name: 'Escolha uma data' })).toHaveClass(
      'inset-x-0',
      'w-full',
      'rounded-2xl',
    );
  });

  it('só permite avançar com uma data de evento maior que a data atual', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 11, 12));

    try {
      const { rerender } = render(
        <Step2Anamnesis
          data={{ ...COMPLETE, hasImportantEvent: true, importantEventDate: '2026-08-11' }}
          onChange={vi.fn()}
          onContinue={vi.fn()}
          saving={false}
        />,
      );
      expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();

      rerender(
        <Step2Anamnesis
          data={{ ...COMPLETE, hasImportantEvent: true, importantEventDate: '2026-08-12' }}
          onChange={vi.fn()}
          onContinue={vi.fn()}
          saving={false}
        />,
      );
      expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Estou parado revela a pergunta de tempo sem treinar', () => {
    renderStep2({ data: { ...COMPLETE, trainingStatus: 'STOPPED' }, initialSection: 1 });
    expect(screen.getByText('Há quanto tempo você não treina?')).toBeInTheDocument();
  });

  it('padroniza o histórico com listas à esquerda e experiência em combobox', async () => {
    const user = userEvent.setup();
    render(<ControlledStep2 initialSection={1} />);

    const statusGroup = within(screen.getByRole('group', { name: 'Você treina atualmente?' }));
    for (const option of statusGroup.getAllByRole('radio')) {
      expect(option.parentElement).toHaveClass('grid-cols-1');
      expect(option).toHaveClass('justify-start');
      expect(option.firstElementChild).toHaveClass('rounded-full');
    }

    const experience = screen.getByRole('combobox', {
      name: 'Qual é a sua experiência com musculação?',
    });
    expect(experience).toHaveClass('h-[52px]', 'rounded-xl', 'bg-white');
    await user.click(experience);
    await user.click(screen.getByRole('option', { name: /^Avançado:/ }));
    expect(experience).toHaveTextContent('Avançado:');

    const activities = within(
      screen.getByRole('group', { name: 'Quais atividades você pratica ou já praticou?' }),
    );
    expect(activities.getAllByRole('button')[0]).toHaveTextContent('Nenhuma');
    for (const option of activities.getAllByRole('button')) {
      expect(option.parentElement).toHaveClass('grid-cols-1');
      expect(option).toHaveClass('justify-start');
      expect(option.firstElementChild).toHaveClass('rounded-full');
    }
    await user.click(activities.getByRole('button', { name: 'Musculação' }));
    await user.click(activities.getByRole('button', { name: 'Corrida' }));
    expect(activities.getByRole('button', { name: 'Musculação' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(activities.getByRole('button', { name: 'Corrida' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const barriers = within(
      screen.getByRole('group', {
        name: 'O que mais dificultou sua consistência nos treinos anteriormente?',
      }),
    );
    for (const option of barriers.getAllByRole('button')) {
      expect(option.parentElement).toHaveClass('grid-cols-1');
      expect(option).toHaveClass('justify-start');
      expect(option.firstElementChild).toHaveClass('rounded-full');
    }
    await user.click(barriers.getByRole('button', { name: 'Falta de tempo' }));
    await user.click(barriers.getByRole('button', { name: 'Falta de motivação' }));
    expect(barriers.getByRole('button', { name: 'Falta de tempo' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(barriers.getByRole('button', { name: 'Falta de motivação' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('torna Nenhuma exclusiva nas atividades', async () => {
    const user = userEvent.setup();
    render(<ControlledStep2 initialSection={1} />);
    const activities = within(
      screen.getByRole('group', { name: 'Quais atividades você pratica ou já praticou?' }),
    );
    const none = activities.getByRole('button', { name: 'Nenhuma' });
    const weightTraining = activities.getByRole('button', { name: 'Musculação' });

    await user.click(none);
    expect(none).toHaveAttribute('aria-pressed', 'true');
    expect(weightTraining).toHaveAttribute('aria-disabled', 'true');

    await user.click(weightTraining);
    expect(weightTraining).toHaveAttribute('aria-pressed', 'false');
    expect(none).toHaveAttribute('aria-pressed', 'true');

    await user.click(none);
    expect(weightTraining).not.toHaveAttribute('aria-disabled');
    await user.click(weightTraining);
    expect(weightTraining).toHaveAttribute('aria-pressed', 'true');
  });

  it('padroniza a rotina com dropdown e listas com indicador à esquerda', async () => {
    const user = userEvent.setup();
    render(<ControlledStep2 initialSection={2} />);

    const days = screen.getByRole('combobox', {
      name: 'Quantos dias por semana você consegue treinar?',
    });
    expect(days).toHaveClass('h-[52px]', 'rounded-xl', 'bg-white');
    await user.click(days);
    await user.click(screen.getByRole('option', { name: '5 dias' }));
    expect(days).toHaveTextContent('5 dias');

    const weekdays = within(
      screen.getByRole('group', { name: 'Quais dias da semana você consegue treinar?' }),
    );
    for (const option of weekdays.getAllByRole('button')) {
      expect(option.parentElement).toHaveClass('grid-cols-1');
      expect(option).toHaveClass('justify-start');
      expect(option.firstElementChild).toHaveClass('rounded-full');
    }
    await user.click(weekdays.getByRole('button', { name: 'Segunda' }));
    await user.click(weekdays.getByRole('button', { name: 'Terça' }));
    expect(weekdays.getByRole('button', { name: 'Segunda' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(weekdays.getByRole('button', { name: 'Terça' })).toHaveAttribute('aria-pressed', 'true');

    const duration = within(
      screen.getByRole('group', { name: 'Quanto tempo você tem disponível por treino?' }),
    );
    for (const option of duration.getAllByRole('radio')) {
      expect(option.parentElement).toHaveClass('grid-cols-1');
      expect(option).toHaveClass('justify-start');
      expect(option.firstElementChild).toHaveClass('rounded-full');
    }

    const location = within(screen.getByRole('group', { name: 'Onde você pretende treinar?' }));
    for (const option of location.getAllByRole('radio')) {
      expect(option).toHaveClass('justify-start');
      expect(option.firstElementChild).toHaveClass('rounded-full');
    }

    const period = within(
      screen.getByRole('group', { name: 'Em qual período você prefere treinar?' }),
    );
    for (const option of period.getAllByRole('radio')) {
      expect(option).toHaveClass('justify-start');
      expect(option.firstElementChild).toHaveClass('rounded-full');
    }

    expect(
      screen.queryByText('Você pratica atualmente outro esporte ou atividade física?'),
    ).not.toBeInTheDocument();
  });

  it('mostra as nove regiões visíveis em cards quadrados de três colunas', () => {
    renderStep2({ data: { ...COMPLETE, emphasis: ['FULL_BODY'] } });
    const group = screen.getByRole('group', {
      name: 'Em quais regiões você gostaria de dar mais ênfase? (opcional)',
    });
    const options = within(group).getAllByRole('button');

    expect(options).toHaveLength(9);
    expect(within(group).queryByText('Corpo todo, sem preferência')).not.toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Braço' })).toBeInTheDocument();
    expect(within(group).queryByRole('button', { name: 'Bíceps' })).not.toBeInTheDocument();
    expect(within(group).queryByRole('button', { name: 'Tríceps' })).not.toBeInTheDocument();
    expect(options[0]?.parentElement).toHaveClass('w-full', 'grid-cols-3');
    for (const option of options) {
      expect(option).toHaveClass('aspect-square', 'rounded-2xl', 'items-center', 'text-center');
      const icon = option.querySelector('[data-icons8-icon]');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(icon).toHaveClass('bg-contain', 'bg-center', 'bg-no-repeat');
      expect(icon).toHaveStyle({
        backgroundImage: expect.stringContaining('img.icons8.com/color/100/'),
      });
      expect(option).not.toHaveAttribute('aria-disabled');
    }
    expect(within(group).getByRole('button', { name: 'Abdômen e core' })).toContainElement(
      within(group)
        .getByRole('button', { name: 'Abdômen e core' })
        .querySelector('[data-icons8-icon="ABS_CORE"]'),
    );
    expect(
      within(group)
        .getByRole('button', { name: 'Abdômen e core' })
        .querySelector('[data-icons8-icon="ABS_CORE"]'),
    ).toHaveStyle({
      backgroundImage: expect.stringContaining('img.icons8.com/color/100/torso.png'),
    });
    expect(within(group).getByText('0 de 2')).toBeInTheDocument();
    expect(within(group).queryByRole('link')).not.toBeInTheDocument();
  });

  it('substitui o valor histórico de corpo todo ao escolher uma região visível', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderStep2({ data: { ...COMPLETE, emphasis: ['FULL_BODY'] }, onChange });

    await user.click(screen.getByRole('button', { name: 'Peitoral' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ emphasis: ['CHEST'] }));
  });

  it('unifica sessões históricas de bíceps ou tríceps no card Braço', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderStep2({ data: { ...COMPLETE, emphasis: ['TRICEPS'] }, onChange });
    const arm = screen.getByRole('button', { name: 'Braço', pressed: true });

    await user.click(arm);

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ emphasis: [] }));
  });

  it('salva Braço no valor canônico que prioriza os dois músculos', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderStep2({ data: { ...COMPLETE, emphasis: [] }, onChange });

    await user.click(screen.getByRole('button', { name: 'Braço' }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ emphasis: ['BICEPS'] }));
  });

  it('expõe a seleção de região por estado ARIA e por um check visível', () => {
    renderStep2({ data: { ...COMPLETE, emphasis: ['CHEST'] } });
    const selected = screen.getByRole('button', { name: 'Peitoral', pressed: true });

    expect(selected).toHaveClass('ring-1', 'ring-inset');
    expect(within(selected).getByText('✓')).toBeInTheDocument();
    expect(selected).toHaveClass('focus-visible:ring-2');
  });

  it('mantém opções excedentes focáveis e anuncia quando o limite é atingido', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderStep2({ data: { ...COMPLETE, emphasis: ['CHEST', 'BACK'] }, onChange });
    const shoulders = screen.getByRole('button', { name: 'Ombros' });

    expect(screen.getByText('· Limite de 2 regiões atingido.')).toBeInTheDocument();
    expect(shoulders).toHaveAttribute('aria-disabled', 'true');
    shoulders.focus();
    expect(shoulders).toHaveFocus();
    await user.click(shoulders);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('dor exige região e tendência para avançar', () => {
    renderStep2({
      data: { ...COMPLETE, pain: { ...COMPLETE.pain, hasPain: true } },
      initialSection: 3,
    });
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('dor em Outra exige a região informada antes de avançar', () => {
    renderStep2({
      data: {
        ...COMPLETE,
        pain: {
          ...COMPLETE.pain,
          hasPain: true,
          trend: 'STABLE',
          points: [{ region: 'OTHER', intensity: 5, regionOther: '' }],
        },
      },
      initialSection: 3,
    });

    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('condicional de preferências continua disponível na tela correspondente', () => {
    renderStep2({ data: { ...COMPLETE, hasAvoidedExercise: true }, initialSection: 4 });
    expect(screen.getByLabelText('Qual exercício você prefere evitar?')).toBeInTheDocument();
  });

  it('padroniza as preferências e posiciona o círculo de seleção à esquerda', () => {
    renderStep2({ initialSection: 4 });

    const heading = screen.getByRole('heading', { name: 'Suas preferências' });
    const description = screen.getByText('O que você prefere não fazer.');
    const question = screen.getByText(
      'Existe algum exercício que você não gosta ou não deseja realizar?',
    );
    const noOption = screen.getByRole('radio', { name: 'Não' });
    const yesOption = screen.getByRole('radio', { name: 'Sim' });

    expect(heading).toHaveClass('text-h1', 'font-bold', 'text-petroleo');
    expect(description).toHaveClass('mt-2', 'text-body', 'text-muted-foreground');
    expect(question).toHaveClass('text-body', 'font-semibold', 'text-foreground');
    expect(question.nextElementSibling).toHaveClass('mt-2');

    for (const option of [noOption, yesOption]) {
      expect(option).toHaveClass('justify-start');
      expect(option.firstElementChild).toHaveClass('rounded-full');
    }
  });
});
