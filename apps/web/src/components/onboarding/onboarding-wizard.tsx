'use client';

import * as React from 'react';

import {
  biologicalSexSchema,
  ONBOARDING_STEP_SCHEMAS,
  PARQ_DECLARATIONS_VERSION,
  PARQ_QUESTION_IDS,
  PARQ_VERSION,
} from '@movivo/shared';

import {
  deleteBodyPhoto,
  describeAnamnesisError,
  parsePhoneE164,
  patchStep,
  recordConsents,
  submitAnamnesis,
  toE164,
  uploadBodyPhoto,
  type OnboardingStep,
  type SessionView,
} from '@/lib/anamnesis-api';

import type { BodyPhotos } from './body-photos';
import type { PoseAngle } from './pose-guide';
import {
  bodyPayload,
  EMPTY_PAIN,
  goalsFromBlock,
  goalsPayload,
  modalitiesFromBlock,
  modalitiesPayload,
  nutritionFromBlock,
  nutritionPayload,
  painPayload,
  preferencesFromBlock,
  preferencesPayload,
  routineFromBlock,
  routinePayload,
  type BodyDraft,
  type CoachedModalityKey,
} from './onboarding-drafts';
import { ProgressBar } from './progress-bar';
import { ComplementaryConsents } from './complementary-consents';
import { Step1Registration, type Step1Data } from './step1-registration';
import { StepBody } from './step-body';
import { StepGoals } from './step-goals';
import { StepModalities } from './step-modalities';
import { StepNutrition } from './step-nutrition';
import { StepPain } from './step-pain';
import { StepPreferences } from './step-preferences';
import { StepRoutine } from './step-routine';
import { Step3Parq, EMPTY_PARQ, type ParqState } from './step3-parq';
import { SuccessScreen } from './success-screen';

/** Registro da sessão (bloco `registration`) → rascunho do cadastro. */
function step1FromServer(raw: unknown): Partial<Step1Data> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const parsedPhone = typeof r.phoneNumber === 'string' ? parsePhoneE164(r.phoneNumber) : null;
  return {
    name: typeof r.name === 'string' ? r.name : undefined,
    birthDate: typeof r.birthDate === 'string' ? r.birthDate : undefined,
    biologicalSex: biologicalSexSchema.safeParse(r.biologicalSex).data,
    heightCm: typeof r.heightCm === 'number' ? String(r.heightCm) : undefined,
    weightKg: typeof r.weightKg === 'number' ? String(r.weightKg) : undefined,
    phoneCountryIso: parsedPhone?.countryIso,
    phoneMasked: parsedPhone?.phoneMasked,
    email: typeof r.email === 'string' ? r.email : undefined,
  };
}

/** Hoje no calendário do aluno (data das medidas). */
function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

const INVALID_PAYLOAD_MESSAGE =
  'Algumas respostas estão incompletas ou fora do formato esperado. Confira os campos desta etapa e tente de novo.';

/** Primeira etapa que ainda não foi salva (a retomada abre nela). */
function firstPendingStep(session: SessionView): OnboardingStep {
  const first = session.flow === 'COMPLEMENTARY' ? 2 : 1;
  for (let step = first; step <= 8; step += 1) {
    if (!session.completedSteps.includes(step)) return step as OnboardingStep;
  }
  return 9;
}

export function OnboardingWizard({
  sessionRef,
  initial,
}: {
  sessionRef: string;
  initial: SessionView;
}) {
  const complementary = initial.flow === 'COMPLEMENTARY';
  const firstStep: OnboardingStep = complementary ? 2 : 1;
  const [session, setSession] = React.useState(initial);
  const [step, setStep] = React.useState<OnboardingStep>(firstPendingStep(initial));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [parqScreen, setParqScreen] = React.useState(-1);
  const [outcome, setOutcome] = React.useState(initial.outcome);
  // Etapas respondidas NESTA aba: as sensíveis não voltam do servidor ao retomar.
  const [answeredHere, setAnsweredHere] = React.useState<Set<number>>(new Set());

  const s1 = step1FromServer(initial.blocks.registration);
  const [step1, setStep1] = React.useState<Step1Data>({
    name: s1.name ?? '',
    birthDate: s1.birthDate ?? '',
    biologicalSex: s1.biologicalSex ?? null,
    heightCm: s1.heightCm ?? '',
    weightKg: s1.weightKg ?? '',
    phoneCountryIso: s1.phoneCountryIso ?? 'BR',
    phoneMasked: s1.phoneMasked ?? '',
    email: s1.email ?? '',
  });
  const [acceptedConsents, setAcceptedConsents] = React.useState<Set<string>>(new Set());
  const [goals, setGoals] = React.useState(() => goalsFromBlock(initial.blocks.goals));
  const [modalities, setModalities] = React.useState(() =>
    modalitiesFromBlock(initial.blocks.modalities),
  );
  // Sessões salvas antes da mudança guardavam o esporte externo na etapa 3.
  const [routine, setRoutine] = React.useState(() =>
    routineFromBlock(initial.blocks.routine, initial.blocks.modalities),
  );
  const [preferences, setPreferences] = React.useState(() =>
    preferencesFromBlock(initial.blocks.preferences),
  );
  const [pain, setPain] = React.useState(EMPTY_PAIN);
  const [nutrition, setNutrition] = React.useState(() =>
    nutritionFromBlock(initial.blocks.nutrition),
  );
  const [body, setBody] = React.useState<BodyDraft>({});
  const [bodyPhotos, setBodyPhotos] = React.useState<BodyPhotos>({});
  const [sentPhotos, setSentPhotos] = React.useState<PoseAngle[]>(
    () => initial.photos as PoseAngle[],
  );
  const [photosConsentAccepted, setPhotosConsentAccepted] = React.useState(
    initial.bodyPhotosConsentAccepted,
  );
  const [parqAnswers, setParqAnswers] = React.useState<ParqState>(EMPTY_PARQ);
  const [declarations, setDeclarations] = React.useState<Set<string>>(new Set());

  const resumed = (n: number) => session.completedSteps.includes(n) && !answeredHere.has(n);
  // Trava síncrona contra clique duplo: o `saving` do estado só vale no próximo render.
  const inFlight = React.useRef(false);

  /**
   * Texto opcional em branco: se foi salvo nesta aba, o aluno o apagou (`""` apaga no servidor);
   * numa etapa retomada ele nunca foi exibido, então fica omitido e o servidor mantém o salvo.
   */
  function withClearedTexts<T extends object>(step: number, payload: T, fields: string[]): T {
    if (!answeredHere.has(step)) return payload;
    const out: Record<string, unknown> = { ...(payload as Record<string, unknown>) };
    for (const field of fields) if (out[field] === undefined) out[field] = '';
    return out as T;
  }

  /** Salva uma etapa e vai para a seguinte (ou fica, se `advance` for falso). */
  async function save(target: OnboardingStep, payload: unknown, next: OnboardingStep | null) {
    if (inFlight.current) return false;
    setError(null);
    // O servidor é a autoridade; aqui só se evita mandar o que ele recusaria com erro genérico.
    if (!ONBOARDING_STEP_SCHEMAS[target].safeParse(payload).success) {
      setError(INVALID_PAYLOAD_MESSAGE);
      return false;
    }
    inFlight.current = true;
    setSaving(true);
    try {
      await patchStep(sessionRef, target, payload);
      setAnsweredHere((prev) => new Set(prev).add(target));
      setSession((prev) => ({
        ...prev,
        completedSteps: [...new Set([...prev.completedSteps, target])].sort((a, b) => a - b),
      }));
      if (next) setStep(next);
      return true;
    } catch (err) {
      setError(
        describeAnamnesisError(
          err,
          'Não conseguimos salvar suas respostas. Confira os campos e tente de novo.',
        ),
      );
      return false;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  async function handleRegistration() {
    if (inFlight.current) return;
    setSaving(true);
    setError(null);
    try {
      await recordConsents(
        sessionRef,
        session.consents
          .filter((c) => acceptedConsents.has(c.type))
          .map((c) => ({ type: c.type, version: c.version, accepted: true })),
      );
    } catch (err) {
      setError(describeAnamnesisError(err, 'Não conseguimos registrar os aceites. Tente de novo.'));
      setSaving(false);
      return;
    }
    setSaving(false);
    await save(
      1,
      {
        name: step1.name.trim().replace(/\s+/g, ' '),
        birthDate: step1.birthDate,
        biologicalSex: step1.biologicalSex,
        heightCm: Number(step1.heightCm),
        weightKg: Number(step1.weightKg.replace(',', '.')),
        phoneNumber: toE164(step1.phoneCountryIso, step1.phoneMasked),
        email: step1.email.trim().toLowerCase(),
      },
      2,
    );
  }

  async function handleComplementaryConsents(accepted: SessionView['consents']) {
    setSaving(true);
    setError(null);
    try {
      await recordConsents(
        sessionRef,
        accepted.map((c) => ({ type: c.type, version: c.version, accepted: true })),
      );
      setSession((prev) => ({ ...prev, consentsPending: false }));
    } catch (err) {
      setError(describeAnamnesisError(err, 'Não conseguimos registrar os aceites. Tente de novo.'));
    } finally {
      setSaving(false);
    }
  }

  /** Consentimento próprio das fotos: aceitar ou retirar é registrado na hora. */
  async function setPhotosConsent(accepted: boolean) {
    const consent = session.bodyPhotosConsent;
    await recordConsents(sessionRef, [{ type: consent.type, version: consent.version, accepted }]);
    setPhotosConsentAccepted(accepted);
    if (!accepted) {
      // Retirar o aceite apaga as fotos já enviadas (o servidor faz o mesmo).
      setBodyPhotos({});
      setSentPhotos([]);
    }
  }

  async function uploadPhoto(angle: PoseAngle, file: File) {
    await uploadBodyPhoto(sessionRef, angle, file);
    setBodyPhotos((prev) => ({ ...prev, [angle]: file }));
    setSentPhotos((prev) => (prev.includes(angle) ? prev : [...prev, angle]));
  }

  async function removePhoto(angle: PoseAngle) {
    await deleteBodyPhoto(sessionRef, angle);
    setBodyPhotos((prev) => {
      const next = { ...prev };
      delete next[angle];
      return next;
    });
    setSentPhotos((prev) => prev.filter((a) => a !== angle));
  }

  /** Medidas e fotos (opcionais): salva e segue para o PAR-Q, que é sempre a última parte. */
  async function handleBody(withMeasurements: boolean) {
    if (!withMeasurements) {
      setStep(9);
      return;
    }
    await save(8, bodyPayload(body, todayIso()), 9);
  }

  /** PAR-Q: salva a última etapa e envia a anamnese inteira. */
  async function handleParqAndFinish() {
    const pending = PARQ_QUESTION_IDS.findIndex((id) => parqAnswers[id].answer === undefined);
    if (pending >= 0) {
      setError(
        `Falta responder a pergunta ${pending + 1} de 9 do questionário de saúde. Volte nela para finalizar.`,
      );
      return;
    }
    const saved = await save(
      9,
      {
        parq: {
          version: PARQ_VERSION,
          answers: PARQ_QUESTION_IDS.map((questionId) => {
            const a = parqAnswers[questionId];
            return {
              questionId,
              answer: a.answer === true,
              // O detalhe só acompanha um "Sim": trocar para "Não" descarta o que foi escrito.
              detail: (a.answer === true && a.detail.trim()) || undefined,
            };
          }),
        },
        declarationsVersion: PARQ_DECLARATIONS_VERSION,
        declarations: [...declarations],
      },
      null,
    );
    if (!saved || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      setOutcome((await submitAnamnesis(sessionRef)).outcome);
    } catch (err) {
      setError(
        describeAnamnesisError(
          err,
          'Não conseguimos enviar suas respostas. Tente de novo em instantes.',
        ),
      );
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  if (outcome) {
    return <SuccessScreen outcome={outcome} name={step1.name.trim().split(' ')[0] || 'você'} />;
  }

  const back = (target: OnboardingStep) => (step > firstStep ? () => setStep(target) : undefined);
  // Anamnese complementar: nenhuma etapa abre antes do novo aceite dos textos vigentes.
  const blockedByConsents = complementary && session.consentsPending;
  const strengthSelected = modalities.modalities.STRENGTH.selected;

  return (
    <div className="flex flex-col gap-6">
      <ProgressBar
        currentStep={step}
        completedSteps={session.completedSteps}
        firstStep={firstStep}
        context={
          step === 9
            ? parqScreen < 0
              ? 'Introdução'
              : parqScreen < 9
                ? `Pergunta ${parqScreen + 1} de 9`
                : 'Confirmações finais'
            : undefined
        }
      />

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive bg-destructive/10 p-3 text-label text-petroleo"
        >
          {error}
        </p>
      )}

      {step === 1 && (
        <Step1Registration
          data={step1}
          onChange={(next) => {
            const previousPhone = toE164(step1.phoneCountryIso, step1.phoneMasked);
            const nextPhone = toE164(next.phoneCountryIso, next.phoneMasked);
            setStep1(next);
            if (
              (step1.phoneCountryIso !== next.phoneCountryIso || previousPhone !== nextPhone) &&
              session.phoneVerified
            ) {
              setSession((previous) => ({ ...previous, phoneVerified: false }));
            }
          }}
          consents={session.consents}
          acceptedConsents={acceptedConsents}
          onToggleConsent={(type, checked) =>
            setAcceptedConsents((prev) => {
              const next = new Set(prev);
              if (checked) next.add(type);
              else next.delete(type);
              return next;
            })
          }
          phoneVerified={session.phoneVerified}
          onPhoneVerified={() => setSession((prev) => ({ ...prev, phoneVerified: true }))}
          sessionRef={sessionRef}
          onContinue={() => void handleRegistration()}
          saving={saving}
        />
      )}

      {blockedByConsents && (
        <ComplementaryConsents
          consents={session.consents}
          saving={saving}
          onAccept={(accepted) => void handleComplementaryConsents(accepted)}
        />
      )}

      {!blockedByConsents && step === 2 && (
        <StepGoals
          data={goals}
          onChange={setGoals}
          onContinue={() =>
            void save(2, withClearedTexts(2, goalsPayload(goals), ['motivation']), 3)
          }
          onBack={back(1)}
          saving={saving}
          resumed={resumed(2)}
        />
      )}

      {!blockedByConsents && step === 3 && (
        <StepModalities
          data={modalities}
          onChange={setModalities}
          onContinue={() => void save(3, modalitiesPayload(modalities), 4)}
          onBack={back(2)}
          saving={saving}
        />
      )}

      {!blockedByConsents && step === 4 && (
        <StepRoutine
          data={routine}
          modalities={(Object.keys(modalities.modalities) as CoachedModalityKey[]).filter(
            (key) => modalities.modalities[key].selected,
          )}
          onChange={setRoutine}
          onContinue={() => void save(4, routinePayload(routine), 5)}
          onBack={back(3)}
          saving={saving}
        />
      )}

      {!blockedByConsents && step === 5 && (
        <StepPreferences
          data={preferences}
          onChange={setPreferences}
          onContinue={() =>
            void save(
              5,
              preferencesPayload(
                strengthSelected ? preferences : { ...preferences, muscleEmphasis: [] },
              ),
              6,
            )
          }
          onBack={back(4)}
          saving={saving}
          resumed={resumed(5)}
          strengthSelected={strengthSelected}
        />
      )}

      {!blockedByConsents && step === 6 && (
        <StepPain
          data={pain}
          onChange={setPain}
          onContinue={() => void save(6, painPayload(pain), 7)}
          onBack={back(5)}
          saving={saving}
          resumed={resumed(6)}
        />
      )}

      {!blockedByConsents && step === 7 && (
        <StepNutrition
          data={nutrition}
          onChange={setNutrition}
          onContinue={() =>
            void save(
              7,
              withClearedTexts(7, nutritionPayload(nutrition), ['likedFoods', 'dislikedFoods']),
              8,
            )
          }
          onBack={back(6)}
          saving={saving}
          resumed={resumed(7)}
        />
      )}

      {!blockedByConsents && step === 8 && (
        <StepBody
          data={body}
          photos={bodyPhotos}
          sentAngles={sentPhotos}
          photosConsent={session.bodyPhotosConsent}
          photosConsentAccepted={photosConsentAccepted}
          onChange={setBody}
          sex={step1.biologicalSex}
          onSetPhotosConsent={setPhotosConsent}
          onUploadPhoto={uploadPhoto}
          onRemovePhoto={removePhoto}
          onFinish={(withMeasurements) => void handleBody(withMeasurements)}
          onBack={back(7)}
          saving={saving}
        />
      )}

      {!blockedByConsents && step === 9 && (
        <Step3Parq
          answers={parqAnswers}
          onChange={(id, value) => setParqAnswers((prev) => ({ ...prev, [id]: value }))}
          declarations={declarations}
          onToggleDeclaration={(id, checked) =>
            setDeclarations((prev) => {
              const next = new Set(prev);
              if (checked) next.add(id);
              else next.delete(id);
              return next;
            })
          }
          onSubmit={() => void handleParqAndFinish()}
          onBack={back(8)}
          initialScreen={parqScreen}
          onScreenChange={setParqScreen}
          submitting={saving}
        />
      )}
    </div>
  );
}
