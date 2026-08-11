'use client';

import * as React from 'react';

import { PARQ_DECLARATIONS_VERSION, PARQ_VERSION, type BiologicalSex } from '@movivo/shared';

import {
  patchStep,
  recordConsents,
  submitAnamnesis,
  type SessionView,
} from '@/lib/anamnesis-api';
import { ProgressBar } from './progress-bar';
import { Step1Registration, type Step1Data } from './step1-registration';
import { Step2Anamnesis, EMPTY_STEP2, type Step2State } from './step2-anamnesis';
import { Step3Parq, EMPTY_PARQ, type ParqState } from './step3-parq';
import { SuccessScreen } from './success-screen';

/** `unknown` de `SessionView.step1` → `Step1Data` (retomada por token). */
function step1FromServer(raw: unknown): Partial<Step1Data> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  return {
    name: typeof r.name === 'string' ? r.name : undefined,
    birthDate: typeof r.birthDate === 'string' ? r.birthDate : undefined,
    biologicalSex: (r.biologicalSex as BiologicalSex | undefined) ?? undefined,
    email: typeof r.email === 'string' ? r.email : undefined,
  };
}

export function OnboardingWizard({
  token,
  initial,
}: {
  token: string;
  initial: SessionView;
}) {
  const [session, setSession] = React.useState(initial);
  const [step, setStep] = React.useState<1 | 2 | 3>(
    (initial.currentStep >= 1 && initial.currentStep <= 3 ? initial.currentStep : 1) as 1 | 2 | 3,
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const s1 = step1FromServer(initial.step1);
  const [step1, setStep1] = React.useState<Step1Data>({
    name: s1.name ?? '',
    birthDate: s1.birthDate ?? '',
    biologicalSex: s1.biologicalSex ?? null,
    phoneMasked: '',
    email: s1.email ?? '',
  });
  const [acceptedConsents, setAcceptedConsents] = React.useState<Set<string>>(new Set());

  const [step2, setStep2] = React.useState<Step2State>(EMPTY_STEP2);
  const [parqAnswers, setParqAnswers] = React.useState<ParqState>(EMPTY_PARQ);
  const [declarations, setDeclarations] = React.useState<Set<string>>(new Set());
  const [outcome, setOutcome] = React.useState(session.outcome);

  async function handleStep1Continue() {
    setSaving(true);
    setError(null);
    try {
      await recordConsents(
        token,
        session.consents
          .filter((c) => acceptedConsents.has(c.type))
          .map((c) => ({ type: c.type, version: c.version, accepted: true })),
      );
      await patchStep(token, 1, {
        name: step1.name.trim(),
        birthDate: step1.birthDate,
        biologicalSex: step1.biologicalSex,
        phoneNumber: `+55${step1.phoneMasked.replace(/\D/g, '')}`,
        email: step1.email.trim() || undefined,
      });
      setStep(2);
    } catch {
      setError('Não conseguimos salvar suas informações. Confira os campos e tente de novo.');
    } finally {
      setSaving(false);
    }
  }

  async function handleStep2Continue() {
    setSaving(true);
    setError(null);
    try {
      await patchStep(token, 2, {
        anamnesis: {
          structured: {
            primaryGoal: step2.primaryGoal,
            emphasis: step2.emphasis,
            hasImportantEvent: step2.hasImportantEvent,
            importantEventDate: step2.importantEventDate || undefined,
            trainingStatus: step2.trainingStatus,
            stoppedFor: step2.stoppedFor ?? undefined,
            experience: step2.experience,
            pastActivities: step2.pastActivities,
            consistencyBarriers: step2.consistencyBarriers,
            daysPerWeek: step2.daysPerWeek,
            preferredDays: step2.preferredDays,
            sessionDuration: step2.sessionDuration,
            location: step2.location,
            preferredPeriod: step2.preferredPeriod,
            practicesOtherSport: step2.practicesOtherSport,
            otherSportDaysPerWeek: step2.otherSportDaysPerWeek ?? undefined,
            hasAvoidedExercise: step2.hasAvoidedExercise,
          },
          freeText: {
            primaryGoalOther: step2.primaryGoalOther || undefined,
            importantEventDescription: step2.importantEventDescription || undefined,
            pastActivityOther: step2.pastActivityOther || undefined,
            consistencyBarrierOther: step2.consistencyBarrierOther || undefined,
            otherSportName: step2.otherSportName || undefined,
            avoidedExercise: step2.avoidedExercise || undefined,
          },
        },
        pain: step2.pain.hasPain
          ? {
              hasPain: true,
              points: step2.pain.points.map((p) => ({
                region: p.region,
                intensity: p.intensity,
                regionOther: p.regionOther || undefined,
              })),
              trend: step2.pain.trend,
              trigger: step2.pain.trigger || undefined,
              hasProfessionalExplanation: step2.pain.hasProfessionalExplanation,
              professionalExplanation: step2.pain.professionalExplanation || undefined,
              underMedicalFollowUp: step2.pain.underMedicalFollowUp,
              hasAvoidanceRecommendation: step2.pain.hasAvoidanceRecommendation,
              avoidanceRecommendation: step2.pain.avoidanceRecommendation || undefined,
            }
          : { hasPain: false, points: [] },
      });
      setStep(3);
    } catch {
      setError('Não conseguimos salvar suas respostas. Confira os campos e tente de novo.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    try {
      await patchStep(token, 3, {
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
      });
      const result = await submitAnamnesis(token);
      setOutcome(result.outcome);
    } catch {
      setError('Não conseguimos enviar sua avaliação. Tente de novo em instantes.');
    } finally {
      setSaving(false);
    }
  }

  if (outcome) {
    return <SuccessScreen outcome={outcome} name={step1.name.trim().split(' ')[0] || 'você'} />;
  }

  return (
    <div className="flex flex-col gap-8">
      <ProgressBar currentStep={step} />
      <p className="text-label text-muted-foreground" role="status">
        Suas respostas foram salvas — você pode voltar a este link quando quiser, até{' '}
        {new Date(session.expiresAt).toLocaleDateString('pt-BR')}.
      </p>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-label text-destructive">
          {error}
        </p>
      )}

      {step === 1 && (
        <Step1Registration
          data={step1}
          onChange={setStep1}
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
          token={token}
          onContinue={() => void handleStep1Continue()}
          saving={saving}
        />
      )}

      {step === 2 && (
        <Step2Anamnesis
          data={step2}
          onChange={setStep2}
          onContinue={() => void handleStep2Continue()}
          saving={saving}
        />
      )}

      {step === 3 && (
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
          onSubmit={() => void handleSubmit()}
          submitting={saving}
        />
      )}
    </div>
  );
}
