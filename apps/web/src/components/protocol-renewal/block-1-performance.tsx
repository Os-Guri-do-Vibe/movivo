'use client';

import * as React from 'react';

import type {
  RenewalActualFrequency,
  RenewalCompletionRate,
  RenewalLoadProgression,
  RenewalPerceivedEffort,
} from '@movivo/shared';

import { ChoiceGroup } from '@/components/onboarding/fields';
import { BlockFooter, QuestionHeader } from './block-shell';

/** Bloco 1 — desempenho e execução real (perguntas 1-4). */
export interface Block1State {
  completionRate: RenewalCompletionRate | null;
  actualFrequency: RenewalActualFrequency | null;
  loadProgression: RenewalLoadProgression | null;
  perceivedEffort: RenewalPerceivedEffort | null;
}

export const EMPTY_BLOCK1: Block1State = {
  completionRate: null,
  actualFrequency: null,
  loadProgression: null,
  perceivedEffort: null,
};

const COMPLETION_RATE_ITEMS: { value: RenewalCompletionRate; label: string }[] = [
  { value: 'SEMPRE', label: 'Sempre' },
  { value: 'NA_MAIORIA_DAS_VEZES', label: 'Na maioria das vezes' },
  { value: 'SO_AS_VEZES', label: 'Só às vezes' },
  { value: 'RARAMENTE', label: 'Raramente' },
];

const ACTUAL_FREQUENCY_ITEMS: { value: RenewalActualFrequency; label: string }[] = [
  { value: 'TODOS_OS_DIAS_PLANEJADOS', label: 'Todos os dias planejados' },
  { value: 'FALTOU_1_DIA_NA_MAIORIA', label: 'Faltou 1 dia na maioria das semanas' },
  {
    value: 'FALTARAM_2_OU_MAIS_NA_MAIORIA',
    label: 'Faltaram 2 ou mais dias na maioria das semanas',
  },
  { value: 'TREINEI_BEM_MENOS', label: 'Treinei bem menos do que o planejado' },
];

const LOAD_PROGRESSION_ITEMS: { value: RenewalLoadProgression; label: string }[] = [
  { value: 'EVOLUI_NA_MAIORIA', label: 'Consegui evoluir na maioria dos exercícios' },
  { value: 'MANTIVE_SEM_EVOLUIR', label: 'Consegui manter, mas sem evoluir muito' },
  { value: 'DIFICULDADE_MANTER', label: 'Tive dificuldade até para manter o que já fazia' },
  { value: 'NAO_ACOMPANHEI', label: 'Não acompanhei isso' },
];

const PERCEIVED_EFFORT_ITEMS: { value: RenewalPerceivedEffort; label: string }[] = [
  { value: 'SOBRAVA_BASTANTE', label: 'Sobrava bastante, fácil' },
  { value: 'SOBRAVA_UM_POUCO', label: 'Sobrava um pouco (moderado)' },
  { value: 'QUASE_NO_LIMITE', label: 'Quase no limite' },
  { value: 'PERTO_DA_FALHA', label: 'Chegava perto da falha com frequência' },
];

const TOTAL_QUESTIONS = 4;

export function Block1Performance({
  data,
  onChange,
  onContinue,
  onBack,
  initialScreen = 0,
  onScreenChange,
  saving,
}: {
  data: Block1State;
  onChange: (data: Block1State) => void;
  onContinue: () => void;
  onBack?: () => void;
  initialScreen?: number;
  onScreenChange?: (screen: number) => void;
  saving: boolean;
}) {
  const [screen, setScreen] = React.useState(
    Math.min(TOTAL_QUESTIONS - 1, Math.max(0, initialScreen)),
  );
  const titleRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    titleRef.current?.focus();
  }, [screen]);

  function navigate(next: number) {
    const bounded = Math.min(TOTAL_QUESTIONS - 1, Math.max(0, next));
    setScreen(bounded);
    onScreenChange?.(bounded);
  }

  function set<K extends keyof Block1State>(key: K, value: Block1State[K]) {
    onChange({ ...data, [key]: value });
  }

  const screenComplete = [
    data.completionRate !== null,
    data.actualFrequency !== null,
    data.loadProgression !== null,
    data.perceivedEffort !== null,
  ][screen];

  return (
    <div className="flex flex-col gap-6 pb-4">
      {screen === 0 && (
        <section className="flex flex-col gap-6" aria-labelledby="block1-title">
          <QuestionHeader index={1} total={TOTAL_QUESTIONS} titleId="block1-title" titleRef={titleRef}>
            Nas últimas semanas, você conseguiu completar as séries e repetições planejadas?
          </QuestionHeader>
          <ChoiceGroup<RenewalCompletionRate>
            legend="Selecione uma resposta"
            items={COMPLETION_RATE_ITEMS}
            selected={data.completionRate ? [data.completionRate] : []}
            onToggle={(value) => set('completionRate', value)}
            stack
            indicatorSide="left"
          />
        </section>
      )}

      {screen === 1 && (
        <section className="flex flex-col gap-6" aria-labelledby="block1-title">
          <QuestionHeader index={2} total={TOTAL_QUESTIONS} titleId="block1-title" titleRef={titleRef}>
            Em quantos dias por semana, em média, você de fato treinou (não o planejado, o real)?
          </QuestionHeader>
          <ChoiceGroup<RenewalActualFrequency>
            legend="Selecione uma resposta"
            items={ACTUAL_FREQUENCY_ITEMS}
            selected={data.actualFrequency ? [data.actualFrequency] : []}
            onToggle={(value) => set('actualFrequency', value)}
            stack
            indicatorSide="left"
          />
        </section>
      )}

      {screen === 2 && (
        <section className="flex flex-col gap-6" aria-labelledby="block1-title">
          <QuestionHeader index={3} total={TOTAL_QUESTIONS} titleId="block1-title" titleRef={titleRef}>
            Nos exercícios principais (agachamento, supino, remada, etc.), como foi sua evolução de
            carga ou repetições desde o início do ciclo?
          </QuestionHeader>
          <ChoiceGroup<RenewalLoadProgression>
            legend="Selecione uma resposta"
            items={LOAD_PROGRESSION_ITEMS}
            selected={data.loadProgression ? [data.loadProgression] : []}
            onToggle={(value) => set('loadProgression', value)}
            stack
            indicatorSide="left"
          />
        </section>
      )}

      {screen === 3 && (
        <section className="flex flex-col gap-6" aria-labelledby="block1-title">
          <QuestionHeader index={4} total={TOTAL_QUESTIONS} titleId="block1-title" titleRef={titleRef}>
            De forma geral, como estava seu esforço ao final da maioria das séries de trabalho?
          </QuestionHeader>
          <ChoiceGroup<RenewalPerceivedEffort>
            legend="Selecione uma resposta"
            items={PERCEIVED_EFFORT_ITEMS}
            selected={data.perceivedEffort ? [data.perceivedEffort] : []}
            onToggle={(value) => set('perceivedEffort', value)}
            stack
            indicatorSide="left"
          />
        </section>
      )}

      <BlockFooter
        onBack={screen > 0 ? () => navigate(screen - 1) : onBack}
        onContinue={() => (screen < TOTAL_QUESTIONS - 1 ? navigate(screen + 1) : onContinue())}
        disabled={!screenComplete}
        saving={saving}
      />
    </div>
  );
}
