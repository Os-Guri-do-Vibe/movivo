'use client';

import { MEASUREMENT_LABELS, type BiologicalSex } from '@movivo/shared';

import type { ConsentItemView } from '@/lib/anamnesis-api';

import { BodyPhotosField, type BodyPhotos } from './body-photos';
import type { PoseAngle } from './pose-guide';
import { FieldValidation, UnitInput } from './fields';
import { BODY_FIELDS, bodyValid, measurementError, type BodyDraft } from './onboarding-drafts';
import { Labeled, StepFrame } from './step-frame';

/** Medidas e fotos do corpo: totalmente opcionais. O peso já foi informado no cadastro. */
export function StepBody({
  data,
  photos,
  sentAngles,
  photosConsent,
  photosConsentAccepted,
  sex,
  onChange,
  onSetPhotosConsent,
  onUploadPhoto,
  onRemovePhoto,
  onFinish,
  onBack,
  saving,
}: {
  data: BodyDraft;
  photos: BodyPhotos;
  /** Posições que já têm foto enviada ao servidor. */
  sentAngles: readonly PoseAngle[];
  photosConsent: ConsentItemView;
  photosConsentAccepted: boolean;
  sex: BiologicalSex | null;
  onChange: (data: BodyDraft) => void;
  onSetPhotosConsent: (accepted: boolean) => Promise<void>;
  onUploadPhoto: (angle: PoseAngle, file: File) => Promise<void>;
  onRemovePhoto: (angle: PoseAngle) => Promise<void>;
  /** `withMeasurements=false` quando não há medida preenchida: a etapa é opcional e só segue. */
  onFinish: (withMeasurements: boolean) => void;
  onBack?: () => void;
  saving: boolean;
}) {
  const hasMeasurements = BODY_FIELDS.some((kind) => (data[kind] ?? '').trim() !== '');
  return (
    <StepFrame
      title="Quer acompanhar suas medidas?"
      description="É opcional, mas ajuda a MOVIVO a mostrar sua evolução com mais clareza do que a balança sozinha. Meça sempre no mesmo lugar e no mesmo horário."
      canContinue={bodyValid(data)}
      saving={saving}
      onContinue={() => onFinish(hasMeasurements)}
      onBack={onBack}
    >
      <BodyPhotosField
        photos={photos}
        sentAngles={sentAngles}
        consent={photosConsent}
        consentAccepted={photosConsentAccepted}
        sex={sex}
        onSetConsent={onSetPhotosConsent}
        onUpload={onUploadPhoto}
        onRemove={onRemovePhoto}
      />
      <div className="grid grid-cols-2 gap-x-3 gap-y-6">
        {BODY_FIELDS.map((kind) => (
          <Labeled key={kind} id={`body-${kind}`} label={MEASUREMENT_LABELS[kind]} optional>
            <FieldValidation error={measurementError(kind, data[kind] ?? '')}>
              <UnitInput
                id={`body-${kind}`}
                unit="cm"
                maxInteger={3}
                decimals={1}
                placeholder="0 cm"
                value={data[kind] ?? ''}
                onChange={(value) => onChange({ ...data, [kind]: value })}
              />
            </FieldValidation>
          </Labeled>
        ))}
      </div>
    </StepFrame>
  );
}
