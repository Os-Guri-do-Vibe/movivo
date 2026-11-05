'use client';

import type { MuscleEmphasisRegion } from '@movivo/shared';

import { ChoiceGroup, TextArea, YesNo } from './fields';
import { MuscleEmphasisGrid } from './muscle-emphasis';
import { preferencesComplete, type PreferencesDraft } from './onboarding-drafts';
import { Labeled, StepFrame } from './step-frame';

const PRIORITY_ITEMS: {
  value: NonNullable<PreferencesDraft['priority']>;
  label: string;
  description: string;
}[] = [
  {
    value: 'MAX_RESULT',
    label: 'Puxado',
    description: 'Mais exigente, para buscar o melhor resultado possível.',
  },
  {
    value: 'BALANCED',
    label: 'Equilibrado',
    description: 'Desafiador, mas fácil de encaixar e manter na rotina.',
  },
  {
    value: 'ENJOYMENT',
    label: 'Leve e prazeroso',
    description: 'Mais tranquilo, para criar e manter o hábito.',
  },
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
      title="Preferências e saúde geral"
      description="Conte como você gosta de treinar e o que precisamos saber da sua saúde. Os profissionais da MOVIVO levam tudo isso em conta no seu plano."
      notice={
        resumed
          ? 'Por sigilo, suas respostas de saúde e os textos livres não aparecem de novo. Responda essas perguntas outra vez para continuar.'
          : undefined
      }
      canContinue={preferencesComplete(data)}
      saving={saving}
      onContinue={onContinue}
      onBack={onBack}
    >
      <ChoiceGroup
        legend="Que ritmo de treino combina com você?"
        help="Não muda o seu objetivo, só o quanto o plano vai te exigir."
        items={PRIORITY_ITEMS}
        selected={data.priority ? [data.priority] : []}
        onToggle={(priority) => onChange({ ...data, priority })}
        layout="stack"
      />
      {strengthSelected && (
        <MuscleEmphasisGrid selected={data.muscleEmphasis} onToggle={toggleRegion} />
      )}
      <YesNo
        legend="Tem algum jeito de treinar que você prefere?"
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
            label="Conte como você gosta de treinar."
            help="Ex.: dividir por grupo muscular, treinos curtos e intensos, exercícios que você curte."
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
        legend="Tem algum exercício que você prefere evitar só por não gostar?"
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
          <Labeled
            id="disliked"
            label="Quais exercícios você prefere evitar?"
            help="Se for por dor ou lesão, conte na próxima etapa."
          >
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
        legend="Você tem alguma condição de saúde ou usa algum medicamento contínuo?"
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
            help="Ex.: asma, diabetes, hipotireoidismo. Preencha pelo menos um dos dois campos: se for só medicamento, deixe este em branco."
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
            help="Nome e para que serve, se souber. A MOVIVO não indica nem altera medicamentos: isso só ajuda a planejar com segurança."
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
        legend="Algum profissional de saúde já te deu orientações sobre treino ou alimentação que ainda valem?"
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
            label="O que foi orientado, e por quem?"
            help="Ex.: o nutricionista pediu menos sal; o médico liberou corrida leve. Orientações sobre uma dor específica ficam na próxima etapa."
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
