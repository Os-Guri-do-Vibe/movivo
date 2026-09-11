'use client';

import * as React from 'react';

import {
  PRIMARY_GOAL_LABELS,
  TRAINING_LOCATION_LABELS,
  type ConsistencyBarrier,
  type PrimaryGoal,
  type RenewalContextChange,
  type RenewalTargetEventStatus,
  type SessionDuration,
  type TrainingLocation,
  type Weekday,
} from '@movivo/shared';

import {
  ChoiceGroup,
  FieldLabel,
  QuestionField,
  QuestionStack,
  TextArea,
  YesNo,
} from '@/components/onboarding/fields';
import { DatePicker } from '@/components/onboarding/date-picker';
import { BlockFooter, QuestionHeader } from './block-shell';

/** Bloco 5 — contexto e logística (perguntas 14-18). */
export interface Block5State {
  changes: RenewalContextChange[];
  daysPerWeek: number | null;
  preferredDays: Weekday[];
  sessionDuration: SessionDuration | null;
  location: TrainingLocation | null;
  dislikedExercise: { has: boolean | undefined; description: string };
  barriers: ConsistencyBarrier[];
  goalChange: { changed: boolean | undefined; newGoal: PrimaryGoal | null };
  /** Só relevante quando `hasTargetEvent` (o GET informa se a pergunta 18 aparece). */
  targetEvent: { status: RenewalTargetEventStatus | null; newDate: string };
}

export const EMPTY_BLOCK5: Block5State = {
  changes: [],
  daysPerWeek: null,
  preferredDays: [],
  sessionDuration: null,
  location: null,
  dislikedExercise: { has: undefined, description: '' },
  barriers: [],
  goalChange: { changed: undefined, newGoal: null },
  targetEvent: { status: null, newDate: '' },
};

const CHANGE_ITEMS: { value: RenewalContextChange; label: string }[] = [
  { value: 'DAYS_PER_WEEK', label: 'Dias disponíveis por semana' },
  { value: 'SESSION_DURATION', label: 'Tempo disponível por sessão' },
  { value: 'TRAINING_LOCATION', label: 'Local de treino' },
  { value: 'NONE', label: 'Nenhuma mudança' },
];
const CHANGE_VALUES_EXCEPT_NONE: RenewalContextChange[] = [
  'DAYS_PER_WEEK',
  'SESSION_DURATION',
  'TRAINING_LOCATION',
];

const DAYS_ITEMS = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
  value: String(n),
  label: `${n} dia${n > 1 ? 's' : ''}`,
}));

const WEEKDAY_ITEMS: { value: Weekday; label: string }[] = [
  { value: 'MON', label: 'Segunda' },
  { value: 'TUE', label: 'Terça' },
  { value: 'WED', label: 'Quarta' },
  { value: 'THU', label: 'Quinta' },
  { value: 'FRI', label: 'Sexta' },
  { value: 'SAT', label: 'Sábado' },
  { value: 'SUN', label: 'Domingo' },
];

/** Mesmas 5 faixas/rótulos de `onboarding/step2-anamnesis.tsx` (`sessionDurationSchema`). */
const DURATION_ITEMS: { value: SessionDuration; label: string }[] = [
  { value: 'LT_30', label: 'Até 20 minutos' },
  { value: 'M30_TO_45', label: 'Aproximadamente 30 minutos' },
  { value: 'M45_TO_60', label: 'Aproximadamente 45 minutos' },
  { value: 'M60_TO_90', label: 'Aproximadamente 60 minutos' },
  { value: 'GT_90', label: 'Mais de 60 minutos' },
];

const LOCATION_ITEMS = (Object.keys(TRAINING_LOCATION_LABELS) as TrainingLocation[]).map(
  (value) => ({ value, label: TRAINING_LOCATION_LABELS[value] }),
);

/** Enum real + uma opção de conveniência só de UI ("Nenhuma"), nunca enviada ao backend. */
type BarrierChoice = ConsistencyBarrier | 'NONE_UI';
const BARRIER_ITEMS: { value: BarrierChoice; label: string }[] = [
  { value: 'NONE_UI', label: 'Nenhuma, está indo bem' },
  { value: 'LACK_OF_TIME', label: 'Falta de tempo' },
  { value: 'LACK_OF_MOTIVATION', label: 'Falta de motivação' },
  { value: 'DONT_KNOW_WHAT_TO_DO', label: 'Não sabe o que fazer' },
  { value: 'NO_RESULTS', label: 'Falta de resultados' },
  { value: 'PAIN_OR_INJURY', label: 'Dor ou lesão' },
  { value: 'COST', label: 'Custo' },
  { value: 'EMBARRASSMENT', label: 'Constrangimento' },
  { value: 'TIREDNESS', label: 'Cansaço' },
  { value: 'ROUTINE_CHANGE', label: 'Mudança de rotina' },
  { value: 'OTHER', label: 'Outra' },
];

const GOAL_ITEMS = (Object.keys(PRIMARY_GOAL_LABELS) as PrimaryGoal[]).map((value) => ({
  value,
  label: PRIMARY_GOAL_LABELS[value],
}));

const TARGET_EVENT_ITEMS: { value: RenewalTargetEventStatus; label: string }[] = [
  { value: 'STILL_ON', label: 'Sim, continua de pé' },
  { value: 'DATE_CHANGED', label: 'Mudou a data' },
  { value: 'NO_LONGER_APPLIES', label: 'Não tenho mais esse evento' },
];

function hasText(value: string) {
  return value.trim().length > 0;
}

export function Block5Context({
  data,
  onChange,
  hasTargetEvent,
  onContinue,
  onBack,
  initialScreen = 0,
  onScreenChange,
  saving,
}: {
  data: Block5State;
  onChange: (data: Block5State) => void;
  /** Vem de `RenewalSessionView.hasTargetEvent` — controla se a pergunta 18 aparece. */
  hasTargetEvent: boolean;
  onContinue: () => void;
  onBack?: () => void;
  initialScreen?: number;
  onScreenChange?: (screen: number) => void;
  saving: boolean;
}) {
  const totalQuestions = hasTargetEvent ? 5 : 4;
  const [screen, setScreen] = React.useState(
    Math.min(totalQuestions - 1, Math.max(0, initialScreen)),
  );
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const [minEventDate] = React.useState(() => {
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  });

  React.useEffect(() => {
    titleRef.current?.focus();
  }, [screen]);

  function navigate(next: number) {
    const bounded = Math.min(totalQuestions - 1, Math.max(0, next));
    setScreen(bounded);
    onScreenChange?.(bounded);
  }

  function set<K extends keyof Block5State>(key: K, value: Block5State[K]) {
    onChange({ ...data, [key]: value });
  }

  function toggleChange(value: RenewalContextChange) {
    if (value === 'NONE') {
      set('changes', data.changes.includes('NONE') ? [] : ['NONE']);
      return;
    }
    const withoutNone = data.changes.filter((v) => v !== 'NONE');
    set(
      'changes',
      withoutNone.includes(value)
        ? withoutNone.filter((v) => v !== value)
        : [...withoutNone, value],
    );
  }

  function togglePreferredDay(value: Weekday) {
    set(
      'preferredDays',
      data.preferredDays.includes(value)
        ? data.preferredDays.filter((v) => v !== value)
        : [...data.preferredDays, value],
    );
  }

  function toggleBarrier(value: BarrierChoice) {
    if (value === 'NONE_UI') {
      set('barriers', []);
      return;
    }
    set(
      'barriers',
      data.barriers.includes(value)
        ? data.barriers.filter((v) => v !== value)
        : [...data.barriers, value],
    );
  }

  const changesComplete =
    data.changes.length > 0 &&
    (!data.changes.includes('DAYS_PER_WEEK') || data.daysPerWeek !== null) &&
    (!data.changes.includes('SESSION_DURATION') || data.sessionDuration !== null) &&
    (!data.changes.includes('TRAINING_LOCATION') || data.location !== null);

  const dislikedExerciseComplete =
    data.dislikedExercise.has === false ||
    (data.dislikedExercise.has === true && hasText(data.dislikedExercise.description));

  const goalChangeComplete =
    data.goalChange.changed === false ||
    (data.goalChange.changed === true && data.goalChange.newGoal !== null);

  const targetEventComplete =
    data.targetEvent.status !== null &&
    (data.targetEvent.status !== 'DATE_CHANGED' || hasText(data.targetEvent.newDate));

  const screenComplete = [
    changesComplete,
    dislikedExerciseComplete,
    true, // barriers: vazio já é uma resposta válida ("Nenhuma, está indo bem")
    goalChangeComplete,
    targetEventComplete,
  ][screen];

  return (
    <div className="flex flex-col gap-6 pb-4">
      {screen === 0 && (
        <section className="flex flex-col gap-6" aria-labelledby="block5-title">
          <QuestionHeader index={1} total={totalQuestions} titleId="block5-title" titleRef={titleRef}>
            Algo mudou desde o início deste ciclo?
          </QuestionHeader>
          <ChoiceGroup<RenewalContextChange>
            legend="Selecione todas que se aplicam"
            items={CHANGE_ITEMS}
            selected={data.changes}
            onToggle={toggleChange}
            multi
            disabledValues={data.changes.includes('NONE') ? CHANGE_VALUES_EXCEPT_NONE : undefined}
            stack
            indicatorSide="left"
          />

          {data.changes.includes('DAYS_PER_WEEK') && (
            <QuestionStack className="border-l-2 border-primary pl-4" aria-live="polite">
              <ChoiceGroup
                legend="Quantos dias por semana você tem disponível agora?"
                items={DAYS_ITEMS}
                selected={data.daysPerWeek ? [String(data.daysPerWeek)] : []}
                onToggle={(value) => set('daysPerWeek', Number(value))}
                columns
                indicatorSide="left"
              />
              <ChoiceGroup<Weekday>
                legend="Quais dias da semana? (opcional)"
                items={WEEKDAY_ITEMS}
                selected={data.preferredDays}
                onToggle={togglePreferredDay}
                multi
                stack
                indicatorSide="left"
              />
            </QuestionStack>
          )}

          {data.changes.includes('SESSION_DURATION') && (
            <div className="border-l-2 border-primary pl-4" aria-live="polite">
              <ChoiceGroup<SessionDuration>
                legend="Quanto tempo você tem disponível por treino agora?"
                items={DURATION_ITEMS}
                selected={data.sessionDuration ? [data.sessionDuration] : []}
                onToggle={(value) => set('sessionDuration', value)}
                stack
                indicatorSide="left"
              />
            </div>
          )}

          {data.changes.includes('TRAINING_LOCATION') && (
            <div className="border-l-2 border-primary pl-4" aria-live="polite">
              <ChoiceGroup<TrainingLocation>
                legend="Onde você pretende treinar agora?"
                items={LOCATION_ITEMS}
                selected={data.location ? [data.location] : []}
                onToggle={(value) => set('location', value)}
                indicatorSide="left"
              />
            </div>
          )}
        </section>
      )}

      {screen === 1 && (
        <section className="flex flex-col gap-6" aria-labelledby="block5-title">
          <QuestionHeader index={2} total={totalQuestions} titleId="block5-title" titleRef={titleRef}>
            Existe algum exercício deste ciclo que você não gostou e prefere não repetir?
          </QuestionHeader>
          <YesNo
            legend="Selecione uma resposta"
            value={data.dislikedExercise.has}
            onChange={(has) => set('dislikedExercise', { has, description: '' })}
            indicatorSide="left"
          />
          {data.dislikedExercise.has && (
            <QuestionField className="border-l-2 border-primary pl-4" aria-live="polite">
              <FieldLabel htmlFor="dislikedExerciseDescription">Qual exercício?</FieldLabel>
              <TextArea
                id="dislikedExerciseDescription"
                value={data.dislikedExercise.description}
                onChange={(description) =>
                  set('dislikedExercise', { ...data.dislikedExercise, description })
                }
                maxLength={300}
              />
            </QuestionField>
          )}
        </section>
      )}

      {screen === 2 && (
        <section className="flex flex-col gap-6" aria-labelledby="block5-title">
          <QuestionHeader index={3} total={totalQuestions} titleId="block5-title" titleRef={titleRef}>
            Alguma das dificuldades que você relatou no início ainda te atrapalha? Surgiu alguma
            nova?
          </QuestionHeader>
          <ChoiceGroup<BarrierChoice>
            legend="Selecione todas que se aplicam"
            items={BARRIER_ITEMS}
            selected={data.barriers.length === 0 ? ['NONE_UI'] : data.barriers}
            onToggle={toggleBarrier}
            multi
            stack
            indicatorSide="left"
          />
        </section>
      )}

      {screen === 3 && (
        <section className="flex flex-col gap-6" aria-labelledby="block5-title">
          <QuestionHeader index={4} total={totalQuestions} titleId="block5-title" titleRef={titleRef}>
            Seu objetivo principal continua o mesmo?
          </QuestionHeader>
          <ChoiceGroup<'same' | 'changed'>
            legend="Selecione uma resposta"
            items={[
              { value: 'same', label: 'Sim, continua o mesmo' },
              { value: 'changed', label: 'Não, mudou' },
            ]}
            selected={
              data.goalChange.changed === undefined
                ? []
                : [data.goalChange.changed ? 'changed' : 'same']
            }
            onToggle={(value) =>
              set('goalChange', { changed: value === 'changed', newGoal: null })
            }
            indicatorSide="left"
          />
          {data.goalChange.changed && (
            <div className="border-l-2 border-primary pl-4" aria-live="polite">
              <ChoiceGroup<PrimaryGoal>
                legend="Qual é o seu novo objetivo principal?"
                items={GOAL_ITEMS}
                selected={data.goalChange.newGoal ? [data.goalChange.newGoal] : []}
                onToggle={(newGoal) => set('goalChange', { ...data.goalChange, newGoal })}
                stack
                indicatorSide="left"
              />
            </div>
          )}
        </section>
      )}

      {screen === 4 && hasTargetEvent && (
        <section className="flex flex-col gap-6" aria-labelledby="block5-title">
          <QuestionHeader index={5} total={totalQuestions} titleId="block5-title" titleRef={titleRef}>
            Sua data-alvo/evento ainda está de pé?
          </QuestionHeader>
          <ChoiceGroup<RenewalTargetEventStatus>
            legend="Selecione uma resposta"
            items={TARGET_EVENT_ITEMS}
            selected={data.targetEvent.status ? [data.targetEvent.status] : []}
            onToggle={(status) => set('targetEvent', { status, newDate: '' })}
            stack
            indicatorSide="left"
          />
          {data.targetEvent.status === 'DATE_CHANGED' && (
            <QuestionField className="border-l-2 border-primary pl-4" aria-live="polite">
              <FieldLabel htmlFor="targetEventNewDate">Qual é a nova data?</FieldLabel>
              <DatePicker
                id="targetEventNewDate"
                value={data.targetEvent.newDate}
                onChange={(newDate) => set('targetEvent', { ...data.targetEvent, newDate })}
                minDate={minEventDate}
                maxDate={null}
              />
            </QuestionField>
          )}
        </section>
      )}

      <BlockFooter
        onBack={screen > 0 ? () => navigate(screen - 1) : onBack}
        onContinue={() => (screen < totalQuestions - 1 ? navigate(screen + 1) : onContinue())}
        continueLabel={screen === totalQuestions - 1 ? 'Enviar formulário' : 'Continuar'}
        savingLabel={screen === totalQuestions - 1 ? 'Enviando…' : 'Salvando…'}
        disabled={!screenComplete}
        saving={saving}
      />
    </div>
  );
}
