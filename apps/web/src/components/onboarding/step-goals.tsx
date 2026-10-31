'use client';

import { DECLARED_GOAL_LABELS, type DeclaredGoalKind } from '@movivo/shared';

import { DatePicker } from './date-picker';
import {
  ChoiceGroup,
  Combobox,
  FieldError,
  FieldLabel,
  FieldValidation,
  QuestionField,
  TextArea,
  TextInput,
  UnitInput,
  YesNo,
} from './fields';
import {
  eventDateError,
  eventDistanceError,
  goalsComplete,
  lastEventDate,
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
  { value: 'RUNNING_RACE', label: 'Corrida' },
  { value: 'HYROX_RACE', label: 'HYROX' },
  { value: 'STRENGTH_EVENT', label: 'Musculação' },
  { value: 'OTHER_EVENT', label: 'Outra modalidade' },
];

/** Hoje, no calendário do aluno: um evento futuro não pode ser anterior a isso. */
function todayDate(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

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
      title="Seus objetivos"
      description="A MOVIVO usa isso para montar a estratégia, não para te encaixar num treino pronto."
      notice={
        resumed
          ? 'O que você escreveu em texto livre fica guardado em sigilo e não aparece de novo. Deixe em branco para manter, ou escreva outra vez para substituir.'
          : undefined
      }
      canContinue={goalsComplete(data)}
      saving={saving}
      onContinue={onContinue}
      onBack={onBack}
    >
      <Combobox
        id="goal-primary"
        legend="Qual seu objetivo?"
        items={GOAL_ITEMS}
        value={data.primary}
        onChange={(primary) =>
          onChange({ ...data, primary, secondary: data.secondary.filter((g) => g !== primary) })
        }
        placeholder="Selecione o seu objetivo"
      />
      <Combobox
        id="goal-secondary"
        legend="Você tem mais algum objetivo?"
        items={secondaryItems}
        multiple
        max={3}
        value={data.secondary}
        onChange={(goal) =>
          onChange({
            ...data,
            secondary: data.secondary.includes(goal)
              ? data.secondary.filter((g) => g !== goal)
              : [...data.secondary, goal],
          })
        }
        placeholder="Nenhum outro objetivo"
        optional
      />
      <ChoiceGroup
        legend="Nos resultados, o que você quer priorizar agora?"
        items={EMPHASIS_ITEMS}
        selected={data.emphasis ? [data.emphasis] : []}
        onToggle={(emphasis) => onChange({ ...data, emphasis })}
        layout="stack"
      />
      <YesNo
        legend="Você tem uma prova, competição ou data importante pela frente?"
        value={data.hasEvent}
        onChange={(hasEvent) => onChange({ ...data, hasEvent })}
      />
      {data.hasEvent && (
        <div className="flex flex-col gap-6 border-l-2 border-primary pl-4">
          <ChoiceGroup
            legend="Qual a modalidade?"
            items={EVENT_ITEMS}
            selected={data.eventKind ? [data.eventKind] : []}
            onToggle={(eventKind) => onChange({ ...data, eventKind })}
          />
          <Labeled id="event-name" label="Nome do evento">
            <FieldValidation
              error={data.eventName.trim() === '' ? 'Informe o nome do evento.' : undefined}
            >
              <TextInput
                id="event-name"
                value={data.eventName}
                onChange={(eventName) => onChange({ ...data, eventName })}
                maxLength={120}
              />
            </FieldValidation>
          </Labeled>
          <QuestionField>
            <FieldLabel htmlFor="event-date">Qual é a data?</FieldLabel>
            <DatePicker
              id="event-date"
              value={data.eventDate}
              onChange={(eventDate) => onChange({ ...data, eventDate })}
              minDate={todayDate()}
              maxDate={lastEventDate()}
              invalidMessage="Escolha uma data a partir de hoje e até 3 anos à frente."
            />
            <FieldError message={eventDateError(data.eventDate)} />
          </QuestionField>
          {data.eventKind === 'RUNNING_RACE' && (
            <Labeled id="event-distance" label="Qual a distância da prova?" optional>
              <FieldValidation error={eventDistanceError(data.eventDistanceKm)}>
                <UnitInput
                  id="event-distance"
                  unit="km"
                  maxInteger={3}
                  decimals={1}
                  value={data.eventDistanceKm}
                  onChange={(eventDistanceKm) => onChange({ ...data, eventDistanceKm })}
                />
              </FieldValidation>
            </Labeled>
          )}
        </div>
      )}
      <Labeled
        id="motivation"
        label="O que fez você procurar acompanhamento agora?"
        help="Ajuda a gente a falar a sua língua."
        optional
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
