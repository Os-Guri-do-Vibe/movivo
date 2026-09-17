'use client';

import * as React from 'react';

import {
  ProtocolRenewalApiError,
  patchRenewalStep,
  submitRenewal,
  type RenewalSessionView,
} from '@/lib/protocol-renewal-api';
import { ProgressBar } from './progress-bar';
import { Block1Performance, type Block1State } from './block-1-performance';
import { Block2Fatigue, type Block2State } from './block-2-fatigue';
import { Block3Safety, EMPTY_BLOCK3, type Block3State } from './block-3-safety';
import { Block4Outcome, EMPTY_BLOCK4, type Block4State } from './block-4-outcome';
import { Block5Context, type Block5State } from './block-5-context';
import { RenewalSuccessScreen } from './success-screen';

type Block = 1 | 2 | 3 | 4 | 5;

const LAST_SCREEN_OF_BLOCK: Record<Block, (hasTargetEvent: boolean) => number> = {
  1: () => 3,
  2: () => 3,
  3: () => 1,
  4: () => 2,
  5: (hasTargetEvent) => (hasTargetEvent ? 4 : 3),
};

function record(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

/** `unknown` de `RenewalSessionView.block1` → `Block1State` (retomada por token). */
function block1FromServer(raw: unknown): Block1State {
  const r = record(raw);
  return {
    completionRate: (r.completionRate as Block1State['completionRate']) ?? null,
    actualFrequency: (r.actualFrequency as Block1State['actualFrequency']) ?? null,
    loadProgression: (r.loadProgression as Block1State['loadProgression']) ?? null,
    perceivedEffort: (r.perceivedEffort as Block1State['perceivedEffort']) ?? null,
  };
}

function block2FromServer(raw: unknown): Block2State {
  const r = record(raw);
  return {
    fatigueLevel: (r.fatigueLevel as Block2State['fatigueLevel']) ?? null,
    sleepQuality: (r.sleepQuality as Block2State['sleepQuality']) ?? null,
    stressLevel: (r.stressLevel as Block2State['stressLevel']) ?? null,
    muscleSoreness: (r.muscleSoreness as Block2State['muscleSoreness']) ?? null,
  };
}

function block4FromServer(raw: unknown): Block4State {
  const r = record(raw);
  return {
    currentWeightKg: typeof r.currentWeightKg === 'number' ? String(r.currentWeightKg) : '',
    goalProgress: (r.goalProgress as Block4State['goalProgress']) ?? null,
    satisfaction: typeof r.satisfaction === 'number' ? r.satisfaction : EMPTY_BLOCK4.satisfaction,
  };
}

function block5FromServer(raw: unknown): Block5State {
  const r = record(raw);
  const dislikedExercise = record(r.dislikedExercise);
  const goalChange = record(r.goalChange);
  const targetEvent = record(r.targetEvent);
  return {
    changes: Array.isArray(r.changes) ? (r.changes as Block5State['changes']) : [],
    daysPerWeek: typeof r.daysPerWeek === 'number' ? r.daysPerWeek : null,
    preferredDays: Array.isArray(r.preferredDays)
      ? (r.preferredDays as Block5State['preferredDays'])
      : [],
    sessionDuration: (r.sessionDuration as Block5State['sessionDuration']) ?? null,
    location: (r.location as Block5State['location']) ?? null,
    dislikedExercise: {
      has: typeof dislikedExercise.has === 'boolean' ? dislikedExercise.has : undefined,
      description:
        typeof dislikedExercise.description === 'string' ? dislikedExercise.description : '',
    },
    barriers: Array.isArray(r.barriers) ? (r.barriers as Block5State['barriers']) : [],
    barrierOther: typeof r.barrierOther === 'string' ? r.barrierOther : '',
    goalChange: {
      changed: typeof goalChange.changed === 'boolean' ? goalChange.changed : undefined,
      newGoal: (goalChange.newGoal as Block5State['goalChange']['newGoal']) ?? null,
      newGoalOther: typeof goalChange.newGoalOther === 'string' ? goalChange.newGoalOther : '',
    },
    targetEvent: {
      status: (targetEvent.status as Block5State['targetEvent']['status']) ?? null,
      newDate: typeof targetEvent.newDate === 'string' ? targetEvent.newDate : '',
    },
  };
}

const GENERIC_SAVE_ERROR =
  'Não conseguimos salvar suas respostas. Confira os campos e tente de novo.';

export function RenewalWizard({ token, initial }: { token: string; initial: RenewalSessionView }) {
  const firstName = initial.firstName?.trim() || 'você';
  const hasTargetEvent = initial.hasTargetEvent;

  const [showIntro, setShowIntro] = React.useState(initial.currentStep <= 1);
  const [block, setBlock] = React.useState<Block>(
    (initial.currentStep >= 1 && initial.currentStep <= 5 ? initial.currentStep : 1) as Block,
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [submitted, setSubmitted] = React.useState(false);

  const [block1, setBlock1] = React.useState<Block1State>(() => block1FromServer(initial.block1));
  const [block2, setBlock2] = React.useState<Block2State>(() => block2FromServer(initial.block2));
  // Bloco 3 é dado de saúde: o servidor NUNCA devolve o conteúdo já salvo, mesmo se
  // `block3Completed` for true — reeditar sempre começa em branco (mesmo padrão do
  // PAR-Q original da anamnese).
  const [block3, setBlock3] = React.useState<Block3State>(EMPTY_BLOCK3);
  const [block4, setBlock4] = React.useState<Block4State>(() => block4FromServer(initial.block4));
  const [block5, setBlock5] = React.useState<Block5State>(() => block5FromServer(initial.block5));

  const [block1Screen, setBlock1Screen] = React.useState(0);
  const [block2Screen, setBlock2Screen] = React.useState(0);
  const [block3Screen, setBlock3Screen] = React.useState(0);
  const [block4Screen, setBlock4Screen] = React.useState(0);
  const [block5Screen, setBlock5Screen] = React.useState(0);

  // Blocos 1..(currentStep-1) já foram salvos no servidor em uma visita anterior
  // (retomada por token) — "Voltar" precisa continuar disponível pra eles também, não
  // só para os completados nesta mesma passagem pelo formulário.
  const [completedThrough, setCompletedThrough] = React.useState(
    Math.max(0, Math.min(4, initial.currentStep - 1)),
  );

  function goToBlock(target: Block, screenSetter: (screen: number) => void) {
    screenSetter(LAST_SCREEN_OF_BLOCK[target](hasTargetEvent));
    setBlock(target);
  }

  async function handleBlock1Continue() {
    setSaving(true);
    setError(null);
    try {
      await patchRenewalStep(token, 1, {
        completionRate: block1.completionRate,
        actualFrequency: block1.actualFrequency,
        loadProgression: block1.loadProgression,
        perceivedEffort: block1.perceivedEffort,
      });
      setCompletedThrough((n) => Math.max(n, 1));
      setBlock(2);
    } catch {
      setError(GENERIC_SAVE_ERROR);
    } finally {
      setSaving(false);
    }
  }

  async function handleBlock2Continue() {
    setSaving(true);
    setError(null);
    try {
      await patchRenewalStep(token, 2, {
        fatigueLevel: block2.fatigueLevel,
        sleepQuality: block2.sleepQuality,
        stressLevel: block2.stressLevel,
        muscleSoreness: block2.muscleSoreness,
      });
      setCompletedThrough((n) => Math.max(n, 2));
      setBlock(3);
    } catch {
      setError(GENERIC_SAVE_ERROR);
    } finally {
      setSaving(false);
    }
  }

  async function handleBlock3Continue() {
    setSaving(true);
    setError(null);
    try {
      await patchRenewalStep(token, 3, {
        newPain: block3.newPain.hasNewPain
          ? {
              hasNewPain: true,
              region: block3.newPain.region ?? undefined,
              regionOther:
                block3.newPain.region === 'OTHER'
                  ? block3.newPain.regionOther.trim() || undefined
                  : undefined,
              intensity: block3.newPain.intensity,
              trend: block3.newPain.trend ?? undefined,
              soughtCare: block3.newPain.soughtCare,
            }
          : { hasNewPain: false },
        parqRecheck: block3.parqRecheck.changedToYes
          ? { changedToYes: true, detail: block3.parqRecheck.detail.trim() || undefined }
          : { changedToYes: false },
      });
      setCompletedThrough((n) => Math.max(n, 3));
      setBlock(4);
    } catch {
      setError(GENERIC_SAVE_ERROR);
    } finally {
      setSaving(false);
    }
  }

  async function handleBlock4Continue() {
    setSaving(true);
    setError(null);
    try {
      await patchRenewalStep(token, 4, {
        currentWeightKg: Number(block4.currentWeightKg.replace(',', '.')),
        goalProgress: block4.goalProgress,
        satisfaction: block4.satisfaction,
      });
      setCompletedThrough((n) => Math.max(n, 4));
      setBlock(5);
    } catch {
      setError(GENERIC_SAVE_ERROR);
    } finally {
      setSaving(false);
    }
  }

  async function handleBlock5Submit() {
    setSaving(true);
    setError(null);
    try {
      await patchRenewalStep(token, 5, {
        changes: block5.changes,
        daysPerWeek: block5.changes.includes('DAYS_PER_WEEK')
          ? (block5.daysPerWeek ?? undefined)
          : undefined,
        preferredDays: block5.preferredDays,
        sessionDuration: block5.changes.includes('SESSION_DURATION')
          ? (block5.sessionDuration ?? undefined)
          : undefined,
        location: block5.changes.includes('TRAINING_LOCATION')
          ? (block5.location ?? undefined)
          : undefined,
        dislikedExercise: block5.dislikedExercise.has
          ? { has: true, description: block5.dislikedExercise.description.trim() || undefined }
          : { has: false },
        barriers: block5.barriers,
        barrierOther: block5.barriers.includes('OTHER')
          ? block5.barrierOther.trim() || undefined
          : undefined,
        goalChange: block5.goalChange.changed
          ? {
              changed: true,
              newGoal: block5.goalChange.newGoal ?? undefined,
              newGoalOther:
                block5.goalChange.newGoal === 'OTHER'
                  ? block5.goalChange.newGoalOther.trim() || undefined
                  : undefined,
            }
          : { changed: false },
        targetEvent: hasTargetEvent
          ? {
              status: block5.targetEvent.status,
              newDate:
                block5.targetEvent.status === 'DATE_CHANGED'
                  ? block5.targetEvent.newDate || undefined
                  : undefined,
            }
          : undefined,
      });
      await submitRenewal(token);
      setSubmitted(true);
    } catch (err) {
      if (err instanceof ProtocolRenewalApiError) {
        if (err.status === 410) {
          setError(
            'Sua sessão expirou. Recarregue a página para pedir um novo link pelo WhatsApp.',
          );
        } else if (err.status === 409) {
          setError(
            'Este formulário já tinha sido enviado. Recarregue a página para ver o status atual.',
          );
        } else if (err.status === 400 && err.issues[0]) {
          setError(err.issues[0]);
        } else {
          setError('Não conseguimos enviar suas respostas. Tente de novo em instantes.');
        }
      } else {
        setError('Não conseguimos enviar suas respostas. Tente de novo em instantes.');
      }
    } finally {
      setSaving(false);
    }
  }

  if (submitted) {
    return <RenewalSuccessScreen name={firstName} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <ProgressBar currentBlock={block} />

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive bg-destructive/10 p-3 text-label text-petroleo"
        >
          {error}
        </p>
      )}

      {showIntro && (
        <section className="flex flex-col gap-6" aria-labelledby="renewal-intro-title">
          <h1
            id="renewal-intro-title"
            tabIndex={-1}
            className="text-h1 font-bold text-petroleo outline-none"
          >
            Olá, {firstName}! Vamos preparar seu próximo protocolo.
          </h1>
          <p className="text-body text-muted-foreground">
            Preencha este formulário para receber seu protocolo atualizado para o seu novo
            mesociclo. São 5 blocos rápidos sobre como foi seu desempenho, sua fadiga, sua
            segurança, seus resultados percebidos e sua rotina atual.
          </p>
          <p className="rounded-xl border border-coral bg-coral/10 p-4 text-body text-petroleo">
            Suas respostas são fundamentais para ajustar seu novo protocolo de forma personalizada e
            otimizar seus resultados.
          </p>
          <button
            type="button"
            onClick={() => setShowIntro(false)}
            className="h-[52px] rounded-xl bg-primary px-6 text-body font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary/85"
          >
            Começar
          </button>
        </section>
      )}

      {!showIntro && block === 1 && (
        <Block1Performance
          data={block1}
          onChange={setBlock1}
          onContinue={() => void handleBlock1Continue()}
          onBack={() => setShowIntro(true)}
          initialScreen={block1Screen}
          onScreenChange={setBlock1Screen}
          saving={saving}
        />
      )}

      {!showIntro && block === 2 && (
        <Block2Fatigue
          data={block2}
          onChange={setBlock2}
          onContinue={() => void handleBlock2Continue()}
          onBack={completedThrough >= 1 ? () => goToBlock(1, setBlock1Screen) : undefined}
          initialScreen={block2Screen}
          onScreenChange={setBlock2Screen}
          saving={saving}
        />
      )}

      {!showIntro && block === 3 && (
        <Block3Safety
          data={block3}
          onChange={setBlock3}
          onContinue={() => void handleBlock3Continue()}
          onBack={completedThrough >= 2 ? () => goToBlock(2, setBlock2Screen) : undefined}
          initialScreen={block3Screen}
          onScreenChange={setBlock3Screen}
          saving={saving}
        />
      )}

      {!showIntro && block === 4 && (
        <Block4Outcome
          data={block4}
          onChange={setBlock4}
          onContinue={() => void handleBlock4Continue()}
          onBack={completedThrough >= 3 ? () => goToBlock(3, setBlock3Screen) : undefined}
          initialScreen={block4Screen}
          onScreenChange={setBlock4Screen}
          saving={saving}
        />
      )}

      {!showIntro && block === 5 && (
        <Block5Context
          data={block5}
          onChange={setBlock5}
          hasTargetEvent={hasTargetEvent}
          onContinue={() => void handleBlock5Submit()}
          onBack={completedThrough >= 4 ? () => goToBlock(4, setBlock4Screen) : undefined}
          initialScreen={block5Screen}
          onScreenChange={setBlock5Screen}
          saving={saving}
        />
      )}
    </div>
  );
}
