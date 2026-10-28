'use client';

import { DECLARED_GOAL_LABELS, type DeclaredGoalKind } from '@movivo/shared';

import { ChoiceGroup, TextArea, TextInput, YesNo } from './fields';
import {
  goalsComplete,
  type EventKind,
  type GoalEmphasis,
  type GoalsDraft,
} from './onboarding-drafts';
import { Labeled, StepFrame } from './step-frame';

const GOAL_ITEMS = (Object.keys(DECLARED_GOAL_LABELS) as DeclaredGoalKind[]).map((value) => ({
  value,
  label: DECLARED_GOAL_LABELS[value],
}));

const EMPHASIS_ITEMS: { value: GoalEmphasis; label: string }[] = [
  { value: 'AESTHETICS', label: 'Estética e composição corporal' },
  { value: 'PERFORMANCE', label: 'Desempenho' },
  { value: 'HEALTH', label: 'Saúde e qualidade de vida' },
  { value: 'BALANCED', label: 'Um pouco de tudo' },
];

const EVENT_ITEMS: { value: EventKind; label: string }[] = [
  { value: 'RUNNING_RACE', label: 'Prova de corrida' },
  { value: 'HYROX_RACE', label: 'Prova de HYROX' },
  { value: 'COMPETITION', label: 'Competição' },
  { value: 'PERSONAL_DATE', label: 'Data pessoal' },
];

export function StepGoals({
  data,
  onChange,
  onContinue,
  onBack,
  saving,
  resumed,
}: {
  data: GoalsDraft;
  onChange: (data: GoalsDraft) => void;
  onContinue: () => void;
  onBack?: () => void;
  saving: boolean;
  resumed: boolean;
}) {
  const secondaryItems = GOAL_ITEMS.filter((item) => item.value !== data.primary);
  return (
    <StepFrame
      title="Qual é o seu objetivo?"
      description="A MOVIVO usa isso para montar a estratégia, não para te encaixar num treino pronto."
      notice={
        resumed
          ? 'O que você escreveu em texto livre fica guardado em sigilo e não é exibido de novo. Se voltar aqui, escreva outra vez para atualizar.'
          : undefined
      }
      canContinue={goalsComplete(data)}
      saving={saving}
      onContinue={onContinue}
      onBack={onBack}
    >
      <ChoiceGroup
        legend="O que você mais quer agora?"
        items={GOAL_ITEMS}
        selected={data.primary ? [data.primary] : []}
        onToggle={(primary) =>
          onChange({ ...data, primary, secondary: data.secondary.filter((g) => g !== primary) })
        }
        stack
      />
      <ChoiceGroup
        legend="Mais algum objetivo? (até 3)"
        items={secondaryItems}
        selected={data.secondary}
        multi
        onToggle={(goal) =>
          onChange({
            ...data,
            secondary: data.secondary.includes(goal)
              ? data.secondary.filter((g) => g !== goal)
              : data.secondary.length < 3
                ? [...data.secondary, goal]
                : data.secondary,
          })
        }
        stack
      />
      <ChoiceGroup
        legend="O que pesa mais para você?"
        items={EMPHASIS_ITEMS}
        selected={data.emphasis ? [data.emphasis] : []}
        onToggle={(emphasis) => onChange({ ...data, emphasis })}
        stack
      />
      <YesNo
        legend="Você tem uma prova, competição ou data importante pela frente?"
        value={data.hasEvent}
        onChange={(hasEvent) => onChange({ ...data, hasEvent })}
      />
      {data.hasEvent && (
        <>
          <ChoiceGroup
            legend="Que tipo de data?"
            items={EVENT_ITEMS}
            selected={[data.eventKind]}
            onToggle={(eventKind) => onChange({ ...data, eventKind })}
          />
          <Labeled id="event-name" label="Nome do evento">
            <TextInput
              id="event-name"
              value={data.eventName}
              onChange={(eventName) => onChange({ ...data, eventName })}
              maxLength={120}
            />
          </Labeled>
          <Labeled id="event-date" label="Data">
            <TextInput
              id="event-date"
              type="date"
              value={data.eventDate}
              onChange={(eventDate) => onChange({ ...data, eventDate })}
            />
          </Labeled>
          {data.eventKind === 'RUNNING_RACE' && (
            <Labeled id="event-distance" label="Distância da prova (km)">
              <TextInput
                id="event-distance"
                inputMode="decimal"
                value={data.eventDistanceKm}
                onChange={(eventDistanceKm) => onChange({ ...data, eventDistanceKm })}
              />
            </Labeled>
          )}
        </>
      )}
      <Labeled
        id="motivation"
        label="O que fez você procurar acompanhamento agora?"
        help="Opcional. Ajuda a gente a falar a sua língua."
      >
        <TextArea
          id="motivation"
          value={data.motivation}
          onChange={(motivation) => onChange({ ...data, motivation })}
          maxLength={300}
        />
      </Labeled>
    </StepFrame>
  );
}
