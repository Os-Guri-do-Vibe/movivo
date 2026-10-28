'use client';

import { ChoiceGroup, TextArea, YesNo } from './fields';
import { preferencesComplete, type PreferencesDraft } from './onboarding-drafts';
import { PainSection } from './pain-section';
import { Labeled, StepFrame } from './step-frame';

const SPLIT_ITEMS: { value: NonNullable<PreferencesDraft['split']>; label: string }[] = [
  { value: 'FULL_BODY', label: 'Corpo inteiro em cada treino' },
  { value: 'UPPER_LOWER', label: 'Superior e inferior em dias alternados' },
  { value: 'PUSH_PULL_LEGS', label: 'Empurrar, puxar e pernas' },
  { value: 'BODY_PART', label: 'Um ou dois grupos musculares por dia' },
  { value: 'NO_PREFERENCE', label: 'Sem preferência: decidam por mim' },
];

const EFFORT_ITEMS: { value: NonNullable<PreferencesDraft['effort']>; label: string }[] = [
  { value: 'NEAR_FAILURE', label: 'Gosto de treinar perto do limite' },
  { value: 'AVOID_FAILURE', label: 'Prefiro terminar com folga' },
  { value: 'UNSURE', label: 'Ainda não sei' },
];

const PRIORITY_ITEMS: { value: NonNullable<PreferencesDraft['priority']>; label: string }[] = [
  { value: 'MAX_RESULT', label: 'O melhor resultado possível' },
  { value: 'BALANCED', label: 'Equilíbrio entre resultado e constância' },
  { value: 'ENJOYMENT', label: 'Treinar com prazer e facilidade' },
];

const MINUTES_ITEMS = ['30', '40', '50', '60', '90'].map((value) => ({
  value,
  label: `${value} minutos`,
}));

export function StepPreferences({
  data,
  onChange,
  onContinue,
  onBack,
  saving,
  resumed,
}: {
  data: PreferencesDraft;
  onChange: (data: PreferencesDraft) => void;
  onContinue: () => void;
  onBack?: () => void;
  saving: boolean;
  resumed: boolean;
}) {
  const hasMedication = data.medications.trim() !== '' || data.conditions.trim() !== '';
  return (
    <StepFrame
      title="Como você gosta de treinar — e como está o seu corpo"
      description="Quanto mais a gente souber do que funciona para você, menos você precisa pedir ajustes."
      notice={
        resumed
          ? 'Suas respostas de saúde ficam guardadas em sigilo e não são exibidas de novo. Se voltar aqui, responda outra vez para atualizar.'
          : undefined
      }
      canContinue={preferencesComplete(data)}
      saving={saving}
      onContinue={onContinue}
      onBack={onBack}
    >
      <ChoiceGroup
        legend="Como você prefere dividir os treinos?"
        items={SPLIT_ITEMS}
        selected={data.split ? [data.split] : []}
        onToggle={(split) => onChange({ ...data, split })}
        stack
      />
      <ChoiceGroup
        legend="E o esforço?"
        items={EFFORT_ITEMS}
        selected={data.effort ? [data.effort] : []}
        onToggle={(effort) => onChange({ ...data, effort })}
        stack
      />
      <ChoiceGroup
        legend="O que importa mais para você?"
        items={PRIORITY_ITEMS}
        selected={data.priority ? [data.priority] : []}
        onToggle={(priority) => onChange({ ...data, priority })}
        stack
      />
      <ChoiceGroup
        legend="Quanto tempo por sessão é o ideal?"
        items={MINUTES_ITEMS}
        selected={[data.sessionMinutes]}
        onToggle={(sessionMinutes) => onChange({ ...data, sessionMinutes })}
        columns
      />
      <Labeled id="liked" label="O que você mais gosta nos treinos?" help="Opcional.">
        <TextArea
          id="liked"
          value={data.likedTraining}
          onChange={(likedTraining) => onChange({ ...data, likedTraining })}
          maxLength={300}
        />
      </Labeled>
      <Labeled id="disliked" label="Algum exercício que você prefere evitar?" help="Opcional.">
        <TextArea
          id="disliked"
          value={data.dislikedExercises}
          onChange={(dislikedExercises) => onChange({ ...data, dislikedExercises })}
          maxLength={300}
        />
      </Labeled>

      <PainSection data={data.pain} onChange={(pain) => onChange({ ...data, pain })} />

      <YesNo
        legend="Você tem alguma condição de saúde ou toma algum medicamento que a gente deva saber?"
        value={hasMedication}
        onChange={(yes) => {
          if (!yes) onChange({ ...data, conditions: '', medications: '' });
        }}
      />
      {hasMedication && (
        <>
          <Labeled id="conditions" label="Condições de saúde">
            <TextArea
              id="conditions"
              value={data.conditions}
              onChange={(conditions) => onChange({ ...data, conditions })}
              maxLength={500}
            />
          </Labeled>
          <Labeled
            id="medications"
            label="Medicamentos em uso"
            help="A MOVIVO não indica nem altera medicamentos. Isto só ajuda a treinar com segurança."
          >
            <TextArea
              id="medications"
              value={data.medications}
              onChange={(medications) => onChange({ ...data, medications })}
              maxLength={500}
            />
          </Labeled>
        </>
      )}
      <Labeled
        id="guidance"
        label="Algum profissional de saúde te orientou sobre treino ou alimentação?"
        help="Opcional. Médico, fisioterapeuta, nutricionista…"
      >
        <TextArea
          id="guidance"
          value={data.professionalGuidance}
          onChange={(professionalGuidance) => onChange({ ...data, professionalGuidance })}
          maxLength={500}
        />
      </Labeled>
    </StepFrame>
  );
}
