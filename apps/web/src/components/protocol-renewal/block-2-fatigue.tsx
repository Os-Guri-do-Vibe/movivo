'use client';

import * as React from 'react';

import type {
  RenewalFatigueLevel,
  RenewalMuscleSoreness,
  RenewalSleepQuality,
  RenewalStressLevel,
} from '@movivo/shared';

import { ChoiceGroup } from '@/components/onboarding/fields';
import { BlockFooter, QuestionHeader } from './block-shell';

/** Bloco 2 — fadiga e recuperação (perguntas 5-8). */
export interface Block2State {
  fatigueLevel: RenewalFatigueLevel | null;
  sleepQuality: RenewalSleepQuality | null;
  stressLevel: RenewalStressLevel | null;
  muscleSoreness: RenewalMuscleSoreness | null;
}

export const EMPTY_BLOCK2: Block2State = {
  fatigueLevel: null,
  sleepQuality: null,
  stressLevel: null,
  muscleSoreness: null,
};

const FATIGUE_LEVEL_ITEMS: { value: RenewalFatigueLevel; label: string }[] = [
  { value: 'BAIXO_RECUPERADO', label: 'Baixo, me sinto recuperado' },
  { value: 'MODERADO', label: 'Moderado, cansaço normal' },
  { value: 'ALTO_SEM_RECUPERACAO', label: 'Alto, não sinto recuperação completa entre treinos' },
  { value: 'MUITO_ALTO_EXAUSTO', label: 'Muito alto, me sinto exausto' },
];

const SLEEP_QUALITY_ITEMS: { value: RenewalSleepQuality; label: string }[] = [
  { value: 'BOA', label: 'Boa' },
  { value: 'REGULAR', label: 'Regular' },
  { value: 'RUIM', label: 'Ruim' },
];

const STRESS_LEVEL_ITEMS: { value: RenewalStressLevel; label: string }[] = [
  { value: 'BAIXO', label: 'Baixo' },
  { value: 'MODERADO', label: 'Moderado' },
  { value: 'ALTO', label: 'Alto' },
];

const MUSCLE_SORENESS_ITEMS: { value: RenewalMuscleSoreness; label: string }[] = [
  { value: 'NORMAL', label: 'Normal' },
  { value: 'MAIS_INTENSA_OU_DEMORADA', label: 'Um pouco mais intensa ou demorada que o normal' },
  { value: 'BEM_MAIS_INTENSA_OU_DEMORADA', label: 'Bem mais intensa ou demorada que o normal' },
];

const TOTAL_QUESTIONS = 4;

export function Block2Fatigue({
  data,
  onChange,
  onContinue,
  onBack,
  initialScreen = 0,
  onScreenChange,
  saving,
}: {
  data: Block2State;
  onChange: (data: Block2State) => void;
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

  function set<K extends keyof Block2State>(key: K, value: Block2State[K]) {
    onChange({ ...data, [key]: value });
  }

  const screenComplete = [
    data.fatigueLevel !== null,
    data.sleepQuality !== null,
    data.stressLevel !== null,
    data.muscleSoreness !== null,
  ][screen];

  return (
    <div className="flex flex-col gap-6 pb-4">
      {screen === 0 && (
        <section className="flex flex-col gap-6" aria-labelledby="block2-title">
          <QuestionHeader
            index={1}
            total={TOTAL_QUESTIONS}
            titleId="block2-title"
            titleRef={titleRef}
          >
            Como está seu nível de fadiga acumulada nas últimas semanas?
          </QuestionHeader>
          <ChoiceGroup<RenewalFatigueLevel>
            legend="Selecione uma resposta"
            items={FATIGUE_LEVEL_ITEMS}
            selected={data.fatigueLevel ? [data.fatigueLevel] : []}
            onToggle={(value) => set('fatigueLevel', value)}
            stack
            indicatorSide="left"
          />
        </section>
      )}

      {screen === 1 && (
        <section className="flex flex-col gap-6" aria-labelledby="block2-title">
          <QuestionHeader
            index={2}
            total={TOTAL_QUESTIONS}
            titleId="block2-title"
            titleRef={titleRef}
          >
            Como está sua qualidade de sono nas últimas semanas?
          </QuestionHeader>
          <ChoiceGroup<RenewalSleepQuality>
            legend="Selecione uma resposta"
            items={SLEEP_QUALITY_ITEMS}
            selected={data.sleepQuality ? [data.sleepQuality] : []}
            onToggle={(value) => set('sleepQuality', value)}
            stack
            indicatorSide="left"
          />
        </section>
      )}

      {screen === 2 && (
        <section className="flex flex-col gap-6" aria-labelledby="block2-title">
          <QuestionHeader
            index={3}
            total={TOTAL_QUESTIONS}
            titleId="block2-title"
            titleRef={titleRef}
          >
            Como está seu nível de estresse fora dos treinos (trabalho, rotina, pessoal)?
          </QuestionHeader>
          <ChoiceGroup<RenewalStressLevel>
            legend="Selecione uma resposta"
            items={STRESS_LEVEL_ITEMS}
            selected={data.stressLevel ? [data.stressLevel] : []}
            onToggle={(value) => set('stressLevel', value)}
            stack
            indicatorSide="left"
          />
        </section>
      )}

      {screen === 3 && (
        <section className="flex flex-col gap-6" aria-labelledby="block2-title">
          <QuestionHeader
            index={4}
            total={TOTAL_QUESTIONS}
            titleId="block2-title"
            titleRef={titleRef}
          >
            A dor muscular pós-treino (aquela normal, não lesão) tem sido diferente do habitual?
          </QuestionHeader>
          <ChoiceGroup<RenewalMuscleSoreness>
            legend="Selecione uma resposta"
            items={MUSCLE_SORENESS_ITEMS}
            selected={data.muscleSoreness ? [data.muscleSoreness] : []}
            onToggle={(value) => set('muscleSoreness', value)}
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
