'use client';

import { MEASUREMENT_LABELS } from '@movivo/shared';

import { TextInput } from './fields';
import { BODY_FIELDS, type BodyDraft } from './onboarding-drafts';
import { Labeled, StepFrame } from './step-frame';

/** Medidas corporais: totalmente opcionais. O peso já foi informado no cadastro. */
export function StepBody({
  data,
  onChange,
  onFinish,
  onBack,
  saving,
}: {
  data: BodyDraft;
  onChange: (data: BodyDraft) => void;
  /** `withMeasurements=false` quando o aluno pula a etapa. */
  onFinish: (withMeasurements: boolean) => void;
  onBack?: () => void;
  saving: boolean;
}) {
  const filled = BODY_FIELDS.some((kind) => (data[kind] ?? '').trim() !== '');
  return (
    <StepFrame
      title="Quer acompanhar suas medidas?"
      description="É opcional, mas ajuda a MOVIVO a mostrar sua evolução com mais clareza do que a balança sozinha. Meça sempre no mesmo lugar e no mesmo horário. Em centímetros."
      canContinue={filled}
      saving={saving}
      continueLabel="Salvar e finalizar"
      onContinue={() => onFinish(true)}
      onSkip={() => onFinish(false)}
      onBack={onBack}
    >
      {BODY_FIELDS.map((kind) => (
        <Labeled key={kind} id={`body-${kind}`} label={`${MEASUREMENT_LABELS[kind]} (cm)`}>
          <TextInput
            id={`body-${kind}`}
            inputMode="decimal"
            value={data[kind] ?? ''}
            onChange={(value) => onChange({ ...data, [kind]: value })}
          />
        </Labeled>
      ))}
    </StepFrame>
  );
}
