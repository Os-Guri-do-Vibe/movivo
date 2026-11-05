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
      title="Quer registrar o seu ponto de partida?"
      description="Fotos e medidas são opcionais. Elas mostram a sua evolução melhor do que a balança sozinha. Se não quiser agora, é só tocar em Continuar."
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
      <div className="flex flex-col gap-0.5">
        <h2 className="text-body font-semibold text-foreground">Medidas do corpo</h2>
        <p className="text-label text-muted-foreground">
          Com fita métrica, em centímetros. Preencha só as que quiser e meça sempre no mesmo ponto
          do corpo e no mesmo horário. O peso você já informou no cadastro.
        </p>
      </div>
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
