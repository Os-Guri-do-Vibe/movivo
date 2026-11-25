'use client';

import { DECLARED_GOAL_LABELS, type DeclaredGoalKind } from '@movivo/shared';

import { EMPHASIS_ITEMS, EVENT_ITEMS } from './anamnesis-options';
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
  type GoalsDraft,
} from './onboarding-drafts';
import { Labeled, StepFrame } from './step-frame';

/** Uma linha por objetivo, para separar os que parecem iguais (ex.: emagrecer x definir). */
const GOAL_DESCRIPTIONS: Readonly<Record<DeclaredGoalKind, string>> = {
  HYPERTROPHY: 'Ganhar massa muscular.',
  STRENGTH: 'Levantar mais carga nos exercícios.',
  FAT_LOSS: 'Perder gordura corporal.',
  BODY_DEFINITION: 'Deixar os músculos mais aparentes, perdendo gordura sem perder massa.',
  CONDITIONING: 'Ter mais fôlego e disposição no dia a dia e nos treinos.',
  HEALTH: 'Cuidar do corpo e da mente, sem foco em estética ou desempenho.',
  START_TRAINING: 'Nunca treinei com constância e quero criar o hábito.',
  RETURN_TO_TRAINING: 'Já treinei antes, parei e quero retomar.',
  BODYBUILDING_COMPETITION: 'Preparar o físico para subir no palco.',
  RUNNING_PERFORMANCE: 'Correr mais rápido ou mais longe, sem prova marcada.',
  RACE_PREPARATION: 'Treinar para uma prova de corrida com data definida.',
  HYROX_PREPARATION: 'Treinar para uma prova de HYROX.',
  SPORT_PERFORMANCE: 'Usar o treino para jogar ou competir melhor em outro esporte.',
};

const GOAL_ITEMS = (Object.keys(DECLARED_GOAL_LABELS) as DeclaredGoalKind[]).map((value) => ({
  value,
  label: DECLARED_GOAL_LABELS[value],
  description: GOAL_DESCRIPTIONS[value],
}));

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
      description="O que você quer conquistar define a estratégia do seu treino e da sua alimentação. Nada de plano pronto."
      notice={
        resumed
          ? 'Por sigilo, o que você escreveu nos campos de texto não aparece de novo. Deixe em branco para manter o que já foi salvo, ou escreva outra vez para substituir.'
          : undefined
      }
      canContinue={goalsComplete(data)}
      saving={saving}
      onContinue={onContinue}
      onBack={onBack}
    >
      <Combobox
        id="goal-primary"
        legend="Qual é o seu objetivo principal?"
        help="Escolha o que mais pesa para você hoje. É ele que guia o plano."
        items={GOAL_ITEMS}
        value={data.primary}
        onChange={(primary) =>
          onChange({ ...data, primary, secondary: data.secondary.filter((g) => g !== primary) })
        }
        placeholder="Selecione o objetivo principal"
      />
      <Combobox
        id="goal-secondary"
        legend="Tem outros objetivos além do principal?"
        help="Eles entram como complemento, sem tirar a prioridade do principal."
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
        legend="Que tipo de resultado mais importa para você?"
        help="Ajuda a decidir quando os seus objetivos puxam para lados diferentes."
        items={EMPHASIS_ITEMS}
        selected={data.emphasis ? [data.emphasis] : []}
        onToggle={(emphasis) => onChange({ ...data, emphasis })}
        layout="stack"
      />
      <YesNo
        legend="Você tem alguma prova ou competição com data marcada?"
        value={data.hasEvent}
        onChange={(hasEvent) => onChange({ ...data, hasEvent })}
      />
      {data.hasEvent && (
        <div className="flex flex-col gap-6 border-l-2 border-primary pl-4">
          <ChoiceGroup
            legend="De qual modalidade é a prova?"
            items={EVENT_ITEMS}
            selected={data.eventKind ? [data.eventKind] : []}
            onToggle={(eventKind) => onChange({ ...data, eventKind })}
          />
          <Labeled id="event-name" label="Qual é o nome da prova?">
            <FieldValidation
              error={data.eventName.trim() === '' ? 'Escreva o nome da prova.' : undefined}
            >
              <TextInput
                id="event-name"
                value={data.eventName}
                onChange={(eventName) => onChange({ ...data, eventName })}
                placeholder="Ex.: Meia Maratona do Rio"
                maxLength={120}
              />
            </FieldValidation>
          </Labeled>
          <QuestionField>
            <FieldLabel htmlFor="event-date">Quando é a prova?</FieldLabel>
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
            <Labeled id="event-distance" label="Qual é a distância da prova?" optional>
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
        help="Em poucas palavras. Ajuda a MOVIVO a conversar com você do seu jeito e a lembrar o seu porquê nos dias difíceis."
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
