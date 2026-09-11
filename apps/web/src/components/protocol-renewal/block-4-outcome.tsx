'use client';

import * as React from 'react';

import { MAX_WEIGHT_KG, MIN_WEIGHT_KG, type RenewalGoalProgress } from '@movivo/shared';

import { ChoiceGroup, FieldHelp, FieldLabel, QuestionField, TextInput } from '@/components/onboarding/fields';
import { BlockFooter, QuestionHeader } from './block-shell';

/** Bloco 4 — resultado percebido (perguntas 11-13). */
export interface Block4State {
  /** String vazia = não informado (campo opcional). */
  currentWeightKg: string;
  goalProgress: RenewalGoalProgress | null;
  /** Escala 0-10; começa em 5 (ponto médio), mesma convenção do slider de dor da anamnese. */
  satisfaction: number;
}

export const EMPTY_BLOCK4: Block4State = {
  currentWeightKg: '',
  goalProgress: null,
  satisfaction: 5,
};

const GOAL_PROGRESS_ITEMS: { value: RenewalGoalProgress; label: string }[] = [
  { value: 'MELHOR_QUE_ESPERAVA', label: 'Melhor do que esperava' },
  { value: 'DENTRO_DO_ESPERADO', label: 'Dentro do esperado' },
  { value: 'ABAIXO_DO_ESPERADO', label: 'Abaixo do esperado' },
  { value: 'NAO_SEI_AVALIAR', label: 'Não sei avaliar' },
];

const TOTAL_QUESTIONS = 3;

function isWeightValid(weightKg: string): boolean {
  if (weightKg.trim().length === 0) return true;
  const value = Number(weightKg.replace(',', '.'));
  return Number.isFinite(value) && value >= MIN_WEIGHT_KG && value <= MAX_WEIGHT_KG;
}

export function Block4Outcome({
  data,
  onChange,
  onContinue,
  onBack,
  initialScreen = 0,
  onScreenChange,
  saving,
}: {
  data: Block4State;
  onChange: (data: Block4State) => void;
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

  function set<K extends keyof Block4State>(key: K, value: Block4State[K]) {
    onChange({ ...data, [key]: value });
  }

  const screenComplete = [isWeightValid(data.currentWeightKg), data.goalProgress !== null, true][
    screen
  ];

  return (
    <div className="flex flex-col gap-6 pb-4">
      {screen === 0 && (
        <section className="flex flex-col gap-6" aria-labelledby="block4-title">
          <QuestionHeader index={1} total={TOTAL_QUESTIONS} titleId="block4-title" titleRef={titleRef}>
            Peso atual (kg)
          </QuestionHeader>
          <QuestionField>
            <FieldLabel htmlFor="currentWeightKg">Peso atual, em kg (opcional)</FieldLabel>
            <TextInput
              id="currentWeightKg"
              value={data.currentWeightKg}
              onChange={(value) => set('currentWeightKg', value)}
              inputMode="decimal"
              placeholder="Ex.: 78"
              error={!isWeightValid(data.currentWeightKg)}
            />
            <FieldHelp>
              Opcional — mais relevante para quem tem objetivo de emagrecimento ou hipertrofia.
            </FieldHelp>
          </QuestionField>
        </section>
      )}

      {screen === 1 && (
        <section className="flex flex-col gap-6" aria-labelledby="block4-title">
          <QuestionHeader index={2} total={TOTAL_QUESTIONS} titleId="block4-title" titleRef={titleRef}>
            Em relação ao seu objetivo principal, como você sente que está a evolução?
          </QuestionHeader>
          <ChoiceGroup<RenewalGoalProgress>
            legend="Selecione uma resposta"
            items={GOAL_PROGRESS_ITEMS}
            selected={data.goalProgress ? [data.goalProgress] : []}
            onToggle={(value) => set('goalProgress', value)}
            stack
            indicatorSide="left"
          />
        </section>
      )}

      {screen === 2 && (
        <section className="flex flex-col gap-6" aria-labelledby="block4-title">
          <QuestionHeader index={3} total={TOTAL_QUESTIONS} titleId="block4-title" titleRef={titleRef}>
            De 0 a 10, o quanto você está satisfeito com os resultados até agora?
          </QuestionHeader>
          <QuestionField className="rounded-xl border border-border bg-secondary p-4">
            <FieldLabel htmlFor="satisfaction">Satisfação com os resultados</FieldLabel>
            <input
              id="satisfaction"
              type="range"
              min={0}
              max={10}
              step={1}
              value={data.satisfaction}
              onChange={(e) => set('satisfaction', Number(e.target.value))}
              aria-valuetext={`${data.satisfaction} de 10`}
              className="h-2 w-full accent-primary"
            />
            <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3 text-label text-muted-foreground">
              <span>0 · Nada satisfeito</span>
              <span className="font-mono text-h3 font-semibold text-foreground" aria-hidden="true">
                {data.satisfaction}
              </span>
              <span className="text-right">10 · Totalmente satisfeito</span>
            </div>
          </QuestionField>
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
