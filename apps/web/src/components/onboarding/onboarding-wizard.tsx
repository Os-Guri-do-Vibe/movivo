'use client';

import * as React from 'react';

import { PARQ_DECLARATIONS_VERSION, PARQ_VERSION, type BiologicalSex } from '@movivo/shared';

import {
  AnamnesisApiError,
  isSessionReplaced,
  parsePhoneE164,
  patchStep,
  recordConsents,
  SESSION_REPLACED_MESSAGE,
  submitAnamnesis,
  toE164,
  type OnboardingStep,
  type SessionView,
} from '@/lib/anamnesis-api';

import {
  bodyPayload,
  goalsFromBlock,
  goalsPayload,
  modalitiesFromBlock,
  modalitiesPayload,
  nutritionFromBlock,
  nutritionPayload,
  preferencesFromBlock,
  preferencesPayload,
  routineFromBlock,
  routinePayload,
  type BodyDraft,
} from './onboarding-drafts';
import { ProgressBar } from './progress-bar';
import { Step1Registration, type Step1Data } from './step1-registration';
import { StepBody } from './step-body';
import { StepGoals } from './step-goals';
import { StepModalities } from './step-modalities';
import { StepNutrition } from './step-nutrition';
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
    biologicalSex: (r.biologicalSex as BiologicalSex | undefined) ?? undefined,
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

/** Primeira etapa que ainda não foi salva (a retomada abre nela). */
function firstPendingStep(session: SessionView): OnboardingStep {
  const first = session.flow === 'COMPLEMENTARY' ? 2 : 1;
  for (let step = first; step <= 7; step += 1) {
    if (!session.completedSteps.includes(step)) return step as OnboardingStep;
  }
  return 8;
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
  const [routine, setRoutine] = React.useState(() => routineFromBlock(initial.blocks.routine));
  const [preferences, setPreferences] = React.useState(() =>
    preferencesFromBlock(initial.blocks.preferences),
  );
  const [parqAnswers, setParqAnswers] = React.useState<ParqState>(EMPTY_PARQ);
  const [declarations, setDeclarations] = React.useState<Set<string>>(new Set());
  const [nutrition, setNutrition] = React.useState(() =>
    nutritionFromBlock(initial.blocks.nutrition),
  );
  const [body, setBody] = React.useState<BodyDraft>({});

  const resumed = (n: number) => session.completedSteps.includes(n) && !answeredHere.has(n);

  function describeError(err: unknown, fallback: string): string {
    if (isSessionReplaced(err)) return SESSION_REPLACED_MESSAGE;
    if (err instanceof AnamnesisApiError) {
      if (err.status === 409)
        return (
          err.issues[0] ??
          'Este telefone ou e-mail já está cadastrado. Fale com a gente se precisar de ajuda.'
        );
      if (err.status === 410)
        return 'Sua sessão expirou. Recarregue a página para recomeçar o formulário.';
    }
    return fallback;
  }

  /** Salva uma etapa e vai para a seguinte (ou fica, se `advance` for falso). */
  async function save(target: OnboardingStep, payload: unknown, next: OnboardingStep | null) {
    setSaving(true);
    setError(null);
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
        describeError(
          err,
          'Não conseguimos salvar suas respostas. Confira os campos e tente de novo.',
        ),
      );
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleRegistration() {
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
      setError(describeError(err, 'Não conseguimos registrar os aceites. Tente de novo.'));
      setSaving(false);
      return;
    }
    setSaving(false);
    await save(
      1,
      {
        name: step1.name.trim(),
        birthDate: step1.birthDate,
        biologicalSex: step1.biologicalSex,
        heightCm: Number(step1.heightCm),
        weightKg: Number(step1.weightKg.replace(',', '.')),
        phoneNumber: toE164(step1.phoneCountryIso, step1.phoneMasked),
        email: step1.email.trim(),
      },
      2,
    );
  }

  async function handleParq() {
    await save(
      6,
      {
        parq: {
          version: PARQ_VERSION,
          answers: Object.entries(parqAnswers).map(([questionId, a]) => ({
            questionId,
            answer: a.answer === true,
            detail: a.detail.trim() || undefined,
          })),
        },
        declarationsVersion: PARQ_DECLARATIONS_VERSION,
        declarations: [...declarations],
      },
      7,
    );
  }

  async function handleFinish(withMeasurements: boolean) {
    if (withMeasurements && !(await save(8, bodyPayload(body, todayIso()), null))) return;
    setSaving(true);
    setError(null);
    try {
      setOutcome((await submitAnamnesis(sessionRef)).outcome);
    } catch (err) {
      setError(
        describeError(err, 'Não conseguimos enviar suas respostas. Tente de novo em instantes.'),
      );
    } finally {
      setSaving(false);
    }
  }

  if (outcome) {
    return <SuccessScreen outcome={outcome} name={step1.name.trim().split(' ')[0] || 'você'} />;
  }

  const back = (target: OnboardingStep) => (step > firstStep ? () => setStep(target) : undefined);

  return (
    <div className="flex flex-col gap-6">
      <ProgressBar
        currentStep={step}
        completedSteps={session.completedSteps}
        firstStep={firstStep}
        context={
          step === 6
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

      {step === 2 && (
        <StepGoals
          data={goals}
          onChange={setGoals}
          onContinue={() => void save(2, goalsPayload(goals), 3)}
          onBack={back(1)}
          saving={saving}
          resumed={resumed(2)}
        />
      )}

      {step === 3 && (
        <StepModalities
          data={modalities}
          onChange={setModalities}
          onContinue={() => void save(3, modalitiesPayload(modalities), 4)}
          onBack={back(2)}
          saving={saving}
        />
      )}

      {step === 4 && (
        <StepRoutine
          data={routine}
          onChange={setRoutine}
          onContinue={() => void save(4, routinePayload(routine), 5)}
          onBack={back(3)}
          saving={saving}
        />
      )}

      {step === 5 && (
        <StepPreferences
          data={preferences}
          onChange={setPreferences}
          onContinue={() => void save(5, preferencesPayload(preferences), 6)}
          onBack={back(4)}
          saving={saving}
          resumed={resumed(5)}
        />
      )}

      {step === 6 && (
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
          onSubmit={() => void handleParq()}
          onBack={back(5)}
          initialScreen={parqScreen}
          onScreenChange={setParqScreen}
          submitting={saving}
        />
      )}

      {step === 7 && (
        <StepNutrition
          data={nutrition}
          onChange={setNutrition}
          onContinue={() => void save(7, nutritionPayload(nutrition), 8)}
          onBack={() => setStep(6)}
          saving={saving}
          resumed={resumed(7)}
        />
      )}

      {step === 8 && (
        <StepBody
          data={body}
          onChange={setBody}
          onFinish={(withMeasurements) => void handleFinish(withMeasurements)}
          onBack={() => setStep(7)}
          saving={saving}
        />
      )}
    </div>
  );
}
