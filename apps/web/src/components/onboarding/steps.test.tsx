import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  EMPTY_GOALS,
  EMPTY_MODALITIES,
  EMPTY_NUTRITION,
  EMPTY_PAIN,
  EMPTY_PREFERENCES,
  EMPTY_ROUTINE,
} from './onboarding-drafts';
import { StepBody } from './step-body';
import { StepGoals } from './step-goals';
import { StepModalities } from './step-modalities';
import { StepNutrition } from './step-nutrition';
import { StepPain } from './step-pain';
import { StepPreferences } from './step-preferences';
import { StepRoutine } from './step-routine';

const common = { onContinue: vi.fn(), onChange: vi.fn(), saving: false };

describe('aviso de respostas sigilosas ao retomar', () => {
  it.each([
    ['objetivos', <StepGoals key="g" {...common} data={EMPTY_GOALS} resumed />],
    [
      'preferências e saúde',
      <StepPreferences key="p" {...common} data={EMPTY_PREFERENCES} resumed strengthSelected />,
    ],
    ['dores', <StepPain key="d" {...common} data={EMPTY_PAIN} resumed />],
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
  it('objetivos: precisa do objetivo, da prioridade e de dizer se há uma data importante', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <StepGoals {...common} onChange={onChange} data={EMPTY_GOALS} resumed={false} />,
    );
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    await user.click(screen.getByRole('combobox', { name: 'Qual seu objetivo?' }));
    await user.click(screen.getByRole('option', { name: 'Emagrecimento' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ primary: 'FAT_LOSS' }));
    rerender(
      <StepGoals
        {...common}
        data={{ ...EMPTY_GOALS, primary: 'FAT_LOSS', emphasis: 'HEALTH', hasEvent: false }}
        resumed={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
  });

  it('objetivos: as duas perguntas de objetivo são combos, a segunda com até 3 e sem repetir o principal', async () => {
    const user = userEvent.setup();
    render(
      <StepGoals
        {...common}
        data={{ ...EMPTY_GOALS, primary: 'HYPERTROPHY', secondary: ['STRENGTH'] }}
        resumed={false}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Qual seu objetivo?' })).toHaveTextContent(
      'Hipertrofia',
    );
    expect(screen.queryByText('Mais algum objetivo?')).not.toBeInTheDocument();
    const more = screen.getByRole('combobox', { name: 'Você tem mais algum objetivo?' });
    expect(more).toHaveTextContent('Força');
    expect(screen.getByText('Opcional · Escolha até 3 · 1 de 3')).toBeInTheDocument();
    await user.click(more);
    expect(screen.queryByRole('option', { name: 'Hipertrofia' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Emagrecimento' })).toBeInTheDocument();
  });

  it('títulos das etapas ficam centralizados', () => {
    render(<StepGoals {...common} data={EMPTY_GOALS} resumed={false} />);
    expect(screen.getByRole('heading', { name: 'Seus objetivos' }).parentElement).toHaveClass(
      'text-center',
    );
  });

  it('objetivos: com data importante pergunta a modalidade e usa o calendário padrão', () => {
    render(
      <StepGoals
        {...common}
        data={{ ...EMPTY_GOALS, hasEvent: true, eventKind: 'RUNNING_RACE' }}
        resumed={false}
      />,
    );
    expect(screen.getByText('Qual a modalidade?')).toBeInTheDocument();
    expect(screen.queryByText('Que tipo de data?')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('dd/mm/aaaa')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir calendário' })).toBeInTheDocument();
    expect(screen.getByLabelText('Qual a distância da prova?')).toBeInTheDocument();
  });

  it('modalidades: mostra campos de corrida só para quem escolheu corrida', () => {
    const data = structuredClone(EMPTY_MODALITIES);
    data.practicesOtherSport = false;
    const { rerender } = render(<StepModalities {...common} data={data} />);
    expect(screen.queryByLabelText(/km você corre/i)).not.toBeInTheDocument();
    data.modalities.RUNNING = {
      ...data.modalities.RUNNING,
      selected: true,
      practicing: true,
      level: 'BEGINNER',
      sessions: '2',
      weeklyKm: '10',
      venue: 'OUTDOOR',
    };
    rerender(<StepModalities {...common} data={data} />);
    expect(
      screen.getByLabelText('Em média, quantos km você corre por semana?'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Qual seu tempo atual nos 5 km?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
  });

  it('modalidades: cada nível vem com uma descrição para a autoavaliação', async () => {
    const user = userEvent.setup();
    const data = structuredClone(EMPTY_MODALITIES);
    data.modalities.RUNNING = { ...data.modalities.RUNNING, selected: true, practicing: true };
    render(<StepModalities {...common} data={data} />);
    await user.click(screen.getByRole('combobox', { name: 'Qual seu nível atual?' }));
    expect(screen.getByRole('option', { name: /Avançado/ })).toHaveTextContent(
      'Sigo planilha, controlo ritmo e distância e corro provas com frequência.',
    );
    expect(screen.getByRole('option', { name: /Iniciante/ })).toHaveTextContent(
      'ainda alterno corrida e caminhada',
    );
  });

  it('modalidades: as três modalidades são botões em três colunas, com imagem e nome', () => {
    render(<StepModalities {...common} data={structuredClone(EMPTY_MODALITIES)} />);
    const cards = ['Musculação', 'Corrida', 'HYROX'].map((name) =>
      screen.getByRole('button', { name }),
    );
    expect(cards[0]?.parentElement).toHaveClass('grid-cols-3');
    for (const card of cards) {
      expect(card.querySelector('[data-modality-image]')).not.toBeNull();
    }
  });

  it('modalidades: o local é escolhido por modalidade, com as opções de cada uma', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const data = structuredClone(EMPTY_MODALITIES);
    data.modalities.STRENGTH = { ...data.modalities.STRENGTH, selected: true, practicing: true };
    data.modalities.RUNNING = { ...data.modalities.RUNNING, selected: true, practicing: false };
    render(<StepModalities {...common} onChange={onChange} data={data} />);
    expect(screen.queryByText('Onde você treina?')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /academia básica/i })).not.toBeInTheDocument();

    const running = screen.getByRole('group', {
      name: 'Onde você vai fazer a maior parte dos treinos de corrida?',
    });
    expect(
      within(running)
        .getAllByRole('radio')
        .map((radio) => radio.textContent?.replace('✓', '')),
    ).toEqual([
      'Na rua, parque ou trilha',
      'Na pista de atletismo',
      'Na esteira da academia',
      'Na esteira do condomínio',
    ]);
    expect(within(running).queryByRole('radio', { name: 'Em casa' })).not.toBeInTheDocument();

    const strength = screen.getByRole('group', {
      name: 'Onde você vai fazer a maior parte dos treinos de musculação?',
    });
    expect(within(strength).getByRole('radio', { name: 'Em casa' })).toBeInTheDocument();
    expect(
      within(strength).queryByRole('radio', { name: /pista de atletismo/ }),
    ).not.toBeInTheDocument();

    await user.click(within(running).getByRole('radio', { name: 'Na pista de atletismo' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        modalities: expect.objectContaining({
          RUNNING: expect.objectContaining({ venue: 'TRACK' }),
        }),
      }),
    );
  });

  it('modalidades: HYROX só pergunta o melhor tempo a quem já fez prova', () => {
    const data = structuredClone(EMPTY_MODALITIES);
    data.modalities.HYROX = {
      ...data.modalities.HYROX,
      selected: true,
      practicing: true,
      hyroxRaces: '0',
    };
    const { rerender } = render(<StepModalities {...common} data={data} />);
    expect(screen.getByLabelText('Quantas provas de HYROX você já fez?')).toBeInTheDocument();
    expect(screen.queryByLabelText('Qual seu melhor no HYROX completo?')).not.toBeInTheDocument();
    data.modalities.HYROX.hyroxRaces = '2';
    rerender(<StepModalities {...common} data={data} />);
    expect(screen.getByLabelText('Qual seu melhor no HYROX completo?')).toBeInTheDocument();
  });

  it('modalidades: outro esporte usa combos (esporte e dias fixos), sem a pergunta de nome da prática', async () => {
    const user = userEvent.setup();
    const data = structuredClone(EMPTY_MODALITIES);
    data.practicesOtherSport = true;
    data.externalSports = [{ sport: null, sessions: '', duration: '', rpe: null, fixedDays: [] }];
    render(<StepModalities {...common} data={data} />);
    expect(screen.queryByText('Como você chama essa prática?')).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Qual esporte?' }));
    expect(screen.getByRole('option', { name: 'Natação' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    const fixed = screen.getByRole('combobox', {
      name: 'Em quais dias você pratica esse esporte?',
    });
    expect(fixed).toHaveTextContent('Nenhum dia fixo');
    await user.click(fixed);
    expect(screen.getByRole('option', { name: 'Segunda-feira' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Domingo' })).toBeInTheDocument();
    expect(screen.getByLabelText('Qual a duração média das sessões de treino?')).toHaveAttribute(
      'placeholder',
      '45:00',
    );
    expect(
      screen.getByRole('combobox', { name: 'Qual a intensidade média dessa prática?' }),
    ).toBeInTheDocument();
  });

  it('modalidades: pergunta os dias de hoje como ponto de partida, sem dias fixos', () => {
    const data = structuredClone(EMPTY_MODALITIES);
    data.modalities.STRENGTH = { ...data.modalities.STRENGTH, selected: true, practicing: true };
    render(<StepModalities {...common} data={data} />);
    const sessions = screen.getByRole('combobox', {
      name: 'Hoje, quantos dias por semana você pratica musculação?',
    });
    expect(sessions).toHaveAccessibleDescription(
      'É o seu ponto de partida. Quantos treinos você vai fazer com a MOVIVO, você escolhe na próxima etapa.',
    );
    expect(screen.queryByText(/dias fixos/)).not.toBeInTheDocument();
  });

  const routineProps = {
    ...common,
    modalities: ['STRENGTH', 'RUNNING'] as const,
    externalSports: [] as const,
  };

  it('rotina: sem dia marcado não continua; completa, continua', () => {
    const data = structuredClone(EMPTY_ROUTINE);
    const { rerender } = render(<StepRoutine {...routineProps} data={data} />);
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    rerender(
      <StepRoutine
        {...routineProps}
        data={{
          ...data,
          days: ['MON', 'WED', 'FRI'],
          slot: 'EVENING',
          availableMinutes: '60',
          variesWeekly: false,
          daysWanted: '3',
        }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
  });

  it('rotina: o texto cita as modalidades e os dias vêm antes dos treinos, que esperam os dias', async () => {
    const user = userEvent.setup();
    render(<StepRoutine {...routineProps} data={EMPTY_ROUTINE} />);
    expect(
      screen.getByText(
        'Conte quando você pode treinar. A MOVIVO distribui musculação e corrida nesses dias e reorganiza quando a sua semana mudar.',
      ),
    ).toBeInTheDocument();
    const days = screen.getByRole('combobox', { name: 'Em quais dias você pode treinar?' });
    const sessions = screen.getByRole('combobox', {
      name: 'Quantos treinos da MOVIVO por semana você quer fazer?',
    });
    expect(days.compareDocumentPosition(sessions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sessions).toBeDisabled();
    expect(sessions).toHaveTextContent('Marque os dias primeiro');
    await user.click(days);
    for (const day of [
      'Segunda-feira',
      'Terça-feira',
      'Quarta-feira',
      'Quinta-feira',
      'Sexta-feira',
      'Sábado',
      'Domingo',
    ]) {
      expect(screen.getByRole('option', { name: day })).toBeInTheDocument();
    }
  });

  it('rotina: os treinos vão de 1 até os dias marcados e o esporte externo fica de fora', async () => {
    const user = userEvent.setup();
    render(
      <StepRoutine
        {...routineProps}
        externalSports={['MARTIAL_ARTS', 'SWIMMING']}
        data={{ ...EMPTY_ROUTINE, days: ['MON', 'WED', 'FRI'] }}
      />,
    );
    const sessions = screen.getByRole('combobox', {
      name: 'Quantos treinos da MOVIVO por semana você quer fazer?',
    });
    expect(sessions).toHaveAccessibleDescription(
      'Sem contar luta / artes marciais e natação: eles já estão na sua semana e a MOVIVO organiza os treinos em volta deles.',
    );
    await user.click(sessions);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      '1 treino',
      '2 treinos',
      '3 treinos',
    ]);
  });

  it('rotina: desmarcar dias abaixo dos treinos escolhidos avisa e trava o Continuar', () => {
    render(
      <StepRoutine
        {...routineProps}
        data={{
          ...EMPTY_ROUTINE,
          days: ['MON', 'THU'],
          slot: 'MORNING',
          availableMinutes: '45',
          variesWeekly: false,
          daysWanted: '4',
        }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Você escolheu 4 treinos, mas marcou só 2 dias. Ajuste um dos dois.',
    );
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  });

  it('rotina: com 2+ dias, "dia diferente" abre período e tempo por dia, pré-preenchidos', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const base = {
      ...EMPTY_ROUTINE,
      days: ['MON', 'SAT'] as ('MON' | 'SAT')[],
      slot: 'EVENING' as const,
      availableMinutes: '45',
    };
    const { rerender } = render(
      <StepRoutine {...routineProps} onChange={onChange} data={{ ...base, days: ['MON'] }} />,
    );
    expect(
      screen.queryByText('Algum desses dias tem período ou tempo diferente?'),
    ).not.toBeInTheDocument();

    rerender(<StepRoutine {...routineProps} onChange={onChange} data={base} />);
    const question = screen.getByRole('group', {
      name: 'Algum desses dias tem período ou tempo diferente?',
    });
    expect(screen.queryByRole('combobox', { name: 'Período na segunda-feira' })).toBeNull();
    await user.click(within(question).getByRole('radio', { name: 'Sim' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ hasDayOverrides: true }));

    rerender(
      <StepRoutine
        {...routineProps}
        onChange={onChange}
        data={{ ...base, hasDayOverrides: true }}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Período na segunda-feira' })).toHaveTextContent(
      'Noite',
    );
    const saturday = screen.getByRole('combobox', { name: 'Tempo no sábado' });
    expect(saturday).toHaveTextContent('Aproximadamente 45 minutos');
    await user.click(saturday);
    await user.click(screen.getByRole('option', { name: 'Mais de 60 minutos' }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ overrides: { SAT: { slot: 'EVENING', minutes: '90' } } }),
    );

    await user.click(
      within(
        screen.getByRole('group', { name: 'Algum desses dias tem período ou tempo diferente?' }),
      ).getByRole('radio', { name: 'Não' }),
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ hasDayOverrides: false, overrides: {} }),
    );
  });

  it('rotina: período e tempo valem para a maioria dos dias, sem perguntas de trabalho', () => {
    render(
      <StepRoutine
        {...routineProps}
        data={{ ...EMPTY_ROUTINE, days: ['MON', 'WED'], slot: null }}
      />,
    );
    expect(screen.getByText('Em qual período, na maioria desses dias?')).toBeInTheDocument();
    expect(
      screen.getByText('Quanto tempo você tem por treino, na maioria desses dias?'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Sua rotina muda de uma semana para outra?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'Qual o seu nível de estresse no cotidiano?' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Quantas horas você costuma dormir?')).toHaveAttribute(
      'placeholder',
      'hh:mm',
    );
    expect(screen.queryByText('Como é o seu trabalho?')).not.toBeInTheDocument();
    expect(screen.queryByText('Você sabe cozinhar?')).not.toBeInTheDocument();
    expect(screen.queryByText('Quando?')).not.toBeInTheDocument();
  });

  it('preferências: sem divisão de treino nem esforço, com texto livre de preferências', () => {
    render(
      <StepPreferences
        {...common}
        data={EMPTY_PREFERENCES}
        resumed={false}
        strengthSelected={false}
      />,
    );
    expect(screen.queryByText('Como você prefere dividir os treinos?')).not.toBeInTheDocument();
    expect(screen.queryByText('E o esforço?')).not.toBeInTheDocument();
    // Perguntas de sim ou não: o campo de texto só aparece com "sim".
    for (const question of [
      'Você tem alguma preferência para os seus protocolos de treino?',
      'Existe algo ou algum exercício ou movimento que você não gosta e prefere evitar?',
      'Algum profissional de saúde te orientou sobre treino ou alimentação?',
    ]) {
      expect(screen.getByRole('group', { name: question })).toBeInTheDocument();
    }
    expect(
      screen.queryByLabelText('Conte quais são as suas preferências.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText('O que você prefere evitar?')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('O que ele orientou?')).not.toBeInTheDocument();
    expect(screen.queryByText('Quanto tempo por sessão é o ideal?')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Em quais regiões você gostaria de dar mais ênfase?'),
    ).not.toBeInTheDocument();
  });

  it('preferências: responder "sim" abre o campo de texto de cada pergunta', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <StepPreferences
        {...common}
        onChange={onChange}
        data={EMPTY_PREFERENCES}
        resumed={false}
        strengthSelected={false}
      />,
    );
    const group = screen.getByRole('group', {
      name: 'Você tem alguma preferência para os seus protocolos de treino?',
    });
    await user.click(within(group).getByRole('radio', { name: 'Sim' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ hasTrainingPreferences: true }),
    );
    rerender(
      <StepPreferences
        {...common}
        data={{
          ...EMPTY_PREFERENCES,
          hasTrainingPreferences: true,
          hasDislikedExercises: true,
          hasProfessionalGuidance: true,
        }}
        resumed={false}
        strengthSelected={false}
      />,
    );
    expect(screen.getByLabelText('Conte quais são as suas preferências.')).toBeInTheDocument();
    expect(screen.getByLabelText('O que você prefere evitar?')).toBeInTheDocument();
    expect(screen.getByLabelText('O que ele orientou?')).toBeInTheDocument();
  });

  it('preferências: musculação traz as regiões de ênfase, até 2', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <StepPreferences
        {...common}
        onChange={onChange}
        data={{ ...EMPTY_PREFERENCES, muscleEmphasis: ['CHEST', 'BACK'] }}
        resumed={false}
        strengthSelected
      />,
    );
    expect(screen.getByText(/Escolha até 2 · 2 de 2/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Glúteos' }));
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Peitoral' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ muscleEmphasis: ['BACK'] }));
  });

  it('preferências: responder "Sim" para condição de saúde abre os campos', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <StepPreferences
        {...common}
        onChange={onChange}
        data={EMPTY_PREFERENCES}
        resumed={false}
        strengthSelected={false}
      />,
    );
    const group = screen.getByRole('group', {
      name: 'Você tem alguma condição de saúde ou toma algum medicamento que a gente deva saber?',
    });
    await user.click(within(group).getByRole('radio', { name: 'Sim' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ hasCondition: true }));
    rerender(
      <StepPreferences
        {...common}
        data={{ ...EMPTY_PREFERENCES, hasCondition: true }}
        resumed={false}
        strengthSelected={false}
      />,
    );
    expect(screen.getByLabelText('Quais condições de saúde?')).toBeInTheDocument();
    expect(screen.getByLabelText('Quais medicamentos você usa?')).toBeInTheDocument();
  });

  it('dores: tela própria, só com a pergunta de dor', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StepPain {...common} onChange={onChange} data={EMPTY_PAIN} resumed={false} />);
    expect(
      screen.getByText('Você sente alguma dor hoje que atrapalha ou preocupa na hora de treinar?'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/condição de saúde/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'Não' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ hasPain: false }));
  });

  it('alimentação: contexto de vida, combos, listas e grade 2x2 da fome', () => {
    render(<StepNutrition {...common} data={EMPTY_NUTRITION} resumed={false} />);
    const cooking = screen.getByRole('group', { name: 'Você sabe cozinhar?' });
    expect(cooking.querySelector('.grid-cols-1')).not.toBeNull();
    expect(
      screen.getByLabelText('Quantas refeições por semana você faz fora de casa?'),
    ).toBeInTheDocument();
    const budget = screen.getByLabelText('Qual seu orçamento mensal para alimentação?');
    expect(budget).toHaveAttribute('placeholder', 'R$ 0,00');
    expect(
      screen.getByRole('combobox', { name: 'Alguma restrição alimentar?' }),
    ).toBeInTheDocument();
    const meals = screen.getByRole('group', { name: 'Quais refeições você costuma fazer?' });
    expect(meals.querySelector('.grid-cols-1')).not.toBeNull();
    const hunger = screen.getByRole('group', {
      name: 'Como costuma ser a sua fome ao longo do dia?',
    });
    expect(hunger.querySelector('.grid-cols-2')).not.toBeNull();
    expect(hunger.querySelector('.sm\\:grid-cols-3')).toBeNull();
  });

  it('alimentação: aplica "refeições" ao número digitado', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <StepNutrition
        {...common}
        onChange={onChange}
        data={{ ...EMPTY_NUTRITION, mealsPerDay: '4' }}
        resumed={false}
      />,
    );
    const input = screen.getByLabelText('Quantas refeições você faz por dia?');
    expect(input).toHaveValue('4');
    expect(input.parentElement).toHaveTextContent('refeições');
    await user.type(input, '5');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ mealsPerDay: '4' }));
  });

  it('alimentação: gravidade é um combo e "Outro" suplemento abre o campo', () => {
    render(
      <StepNutrition
        {...common}
        data={{
          ...EMPTY_NUTRITION,
          hasAllergy: true,
          allergies: [{ allergen: '', severity: null }],
          supplements: ['OTHER'],
        }}
        resumed={false}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Gravidade' })).toBeInTheDocument();
    expect(screen.getByLabelText('Qual outro suplemento você usa?')).toBeInTheDocument();
  });
});

describe('etapa de corpo', () => {
  const photos = {
    photos: {},
    sentAngles: [] as never[],
    photosConsent: {
      type: 'BODY_PHOTOS' as const,
      version: 'v1',
      title: 'Sobre as fotos do seu corpo',
      body: [],
      label: 'Autorizo as fotos.',
      required: false,
    },
    photosConsentAccepted: true,
    sex: 'FEMALE' as const,
    onSetPhotosConsent: vi.fn(),
    onUploadPhoto: vi.fn(),
    onRemovePhoto: vi.fn(),
  };

  it('é opcional: "Continuar" fica sempre habilitado, sem "Pular", e só salva se houver medida', async () => {
    const user = userEvent.setup();
    const onFinish = vi.fn();
    const { rerender } = render(
      <StepBody data={{}} {...photos} onChange={vi.fn()} onFinish={onFinish} saving={false} />,
    );
    expect(screen.queryByRole('button', { name: 'Pular esta etapa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar e continuar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(onFinish).toHaveBeenLastCalledWith(false);
    rerender(
      <StepBody
        data={{ WAIST: '90' }}
        {...photos}
        onChange={vi.fn()}
        onFinish={onFinish}
        saving={false}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(onFinish).toHaveBeenLastCalledWith(true);
  });

  it('mostra as instruções e as quatro posições antes das medidas, com unidade em cm', () => {
    render(
      <StepBody
        data={{ WAIST: '92.5' }}
        {...photos}
        onChange={vi.fn()}
        onFinish={vi.fn()}
        saving={false}
      />,
    );
    expect(screen.getByText('Fotos do corpo')).toBeInTheDocument();
    for (const label of ['Frontal', 'Lado direito', 'Costas', 'Lado esquerdo']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByRole('img', { name: /posição da foto/i })).toHaveLength(4);
    expect(screen.getByLabelText('Cintura').parentElement).toHaveTextContent('cm');
    // Seis medidas, em duas colunas simétricas: a de quadril é a dos glúteos e não há pescoço.
    for (const label of ['Cintura', 'Glúteos', 'Peitoral', 'Braço', 'Coxa', 'Panturrilha']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.queryByLabelText('Pescoço')).not.toBeInTheDocument();
    expect(
      screen.getByText('Fotos do corpo').compareDocumentPosition(screen.getByLabelText('Cintura')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
