'use client';

import type { MuscleEmphasisRegion } from '@movivo/shared';

import { ChoiceGroup, TextArea, YesNo } from './fields';
import { MuscleEmphasisGrid } from './muscle-emphasis';
import { preferencesComplete, type PreferencesDraft } from './onboarding-drafts';
import { Labeled, StepFrame } from './step-frame';

const PRIORITY_ITEMS: { value: NonNullable<PreferencesDraft['priority']>; label: string }[] = [
  { value: 'MAX_RESULT', label: 'Focado no melhor resultado possível' },
  { value: 'BALANCED', label: 'Equilibrado entre resultado e constância' },
  { value: 'ENJOYMENT', label: 'Leve e prazeroso, para manter o hábito' },
];

export function StepPreferences({
  data,
  onChange,
  onContinue,
  onBack,
  saving,
  resumed,
  strengthSelected,
}: {
  data: PreferencesDraft;
  onChange: (data: PreferencesDraft) => void;
  onContinue: () => void;
  onBack?: () => void;
  saving: boolean;
  resumed: boolean;
  /** Só quem treina musculação escolhe regiões de ênfase. */
  strengthSelected: boolean;
}) {
  const toggleRegion = (region: MuscleEmphasisRegion) =>
    onChange({
      ...data,
      muscleEmphasis: data.muscleEmphasis.includes(region)
        ? data.muscleEmphasis.filter((r) => r !== region)
        : [...data.muscleEmphasis, region],
    });

  return (
    <StepFrame
      title="Suas preferências de treino"
      description="Quem monta o treino é o profissional da MOVIVO. Aqui você só conta o que ele deve levar em consideração."
      notice={
        resumed
          ? 'Suas respostas de saúde e os textos livres ficam guardados em sigilo e não são exibidos de novo. Se voltar aqui, responda outra vez para atualizar.'
          : undefined
      }
      canContinue={preferencesComplete(data)}
      saving={saving}
      onContinue={onContinue}
      onBack={onBack}
    >
      <ChoiceGroup
        legend="Como você prefere que seu treino seja?"
        items={PRIORITY_ITEMS}
        selected={data.priority ? [data.priority] : []}
        onToggle={(priority) => onChange({ ...data, priority })}
        layout="stack"
      />
      {strengthSelected && (
        <MuscleEmphasisGrid selected={data.muscleEmphasis} onToggle={toggleRegion} />
      )}
      <YesNo
        legend="Você tem alguma preferência para os seus protocolos de treino?"
        value={data.hasTrainingPreferences}
        onChange={(hasTrainingPreferences) =>
          onChange({
            ...data,
            hasTrainingPreferences,
            ...(hasTrainingPreferences ? {} : { trainingPreferences: '' }),
          })
        }
      />
      {data.hasTrainingPreferences && (
        <div className="border-l-2 border-primary pl-4">
          <Labeled
            id="training-preferences"
            label="Conte quais são as suas preferências."
            help="Como gosta de dividir os treinos, o esforço que prefere, o que mais curte. Os profissionais da MOVIVO levam isso em consideração."
          >
            <TextArea
              id="training-preferences"
              value={data.trainingPreferences}
              onChange={(trainingPreferences) => onChange({ ...data, trainingPreferences })}
              maxLength={500}
            />
          </Labeled>
        </div>
      )}
      <YesNo
        legend="Existe algo ou algum exercício ou movimento que você não gosta e prefere evitar?"
        value={data.hasDislikedExercises}
        onChange={(hasDislikedExercises) =>
          onChange({
            ...data,
            hasDislikedExercises,
            ...(hasDislikedExercises ? {} : { dislikedExercises: '' }),
          })
        }
      />
      {data.hasDislikedExercises && (
        <div className="border-l-2 border-primary pl-4">
          <Labeled id="disliked" label="O que você prefere evitar?">
            <TextArea
              id="disliked"
              value={data.dislikedExercises}
              onChange={(dislikedExercises) => onChange({ ...data, dislikedExercises })}
              maxLength={500}
            />
          </Labeled>
        </div>
      )}

      <YesNo
        legend="Você tem alguma condição de saúde ou toma algum medicamento que a gente deva saber?"
        value={data.hasCondition}
        onChange={(hasCondition) =>
          onChange({
            ...data,
            hasCondition,
            ...(hasCondition ? {} : { conditions: '', medications: '' }),
          })
        }
      />
      {data.hasCondition && (
        <div className="flex flex-col gap-6 border-l-2 border-primary pl-4">
          <Labeled
            id="conditions"
            label="Quais condições de saúde?"
            help="Se não tiver nenhuma, deixe em branco e preencha só os medicamentos. Pelo menos um dos dois campos é necessário."
            optional
          >
            <TextArea
              id="conditions"
              value={data.conditions}
              onChange={(conditions) => onChange({ ...data, conditions })}
              maxLength={500}
            />
          </Labeled>
          <Labeled
            id="medications"
            label="Quais medicamentos você usa?"
            help="A MOVIVO não indica nem altera medicamentos. Isto só ajuda a treinar com segurança."
            optional
          >
            <TextArea
              id="medications"
              value={data.medications}
              onChange={(medications) => onChange({ ...data, medications })}
              maxLength={500}
            />
          </Labeled>
        </div>
      )}
      <YesNo
        legend="Algum profissional de saúde te orientou sobre treino ou alimentação?"
        value={data.hasProfessionalGuidance}
        onChange={(hasProfessionalGuidance) =>
          onChange({
            ...data,
            hasProfessionalGuidance,
            ...(hasProfessionalGuidance ? {} : { professionalGuidance: '' }),
          })
        }
      />
      {data.hasProfessionalGuidance && (
        <div className="border-l-2 border-primary pl-4">
          <Labeled
            id="guidance"
            label="O que ele orientou?"
            help="Médico, fisioterapeuta, nutricionista…"
          >
            <TextArea
              id="guidance"
              value={data.professionalGuidance}
              onChange={(professionalGuidance) => onChange({ ...data, professionalGuidance })}
              maxLength={500}
            />
          </Labeled>
        </div>
      )}
    </StepFrame>
  );
}
