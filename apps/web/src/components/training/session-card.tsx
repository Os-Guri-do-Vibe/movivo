'use client';

import { Clock3 } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  SESSION_MODALITY_LABELS,
  SESSION_PRIORITY_LABELS,
  formatShareCardClock,
  type ExecutionView,
  type TrainingDaySession,
} from '@movivo/shared';

import { EnduranceLines, EnduranceSession } from './endurance-session';
import { ShareCardPanel } from './share-card/share-card-panel';
import { StrengthSession, durationText, repsText } from './strength-session';
import { StudentAlert } from './student-nav';
import { useTrainingApi } from './training-api-context';

const STATUS_LABELS: Record<TrainingDaySession['status'], string> = {
  PLANNED: 'Planejado',
  DONE: 'Concluído',
  PARTIAL: 'Em parte',
  MISSED: 'Sem registro',
  SKIPPED: 'Não feito',
  MOVED: 'Movido',
};

/** Cronômetro do treino (hh:mm:ss) a partir do "Iniciar", no cabeçalho do cartão. */
export function WorkoutTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div
      role="timer"
      aria-label="Tempo de treino"
      className="flex items-center gap-2 font-mono font-bold text-white"
    >
      <Clock3 size={18} aria-hidden="true" />
      {formatShareCardClock(Math.max(0, Math.floor((now - startedAt) / 1000)))}
    </div>
  );
}

/** O treino antes de começar, só para leitura: o aluno vê o que vai fazer. */
function Prescription({ content }: { content: TrainingDaySession['content'] }) {
  if (content.modality === 'STRENGTH') {
    return (
      <ol className="divide-y divide-border">
        {content.exercises.map((exercise) => (
          <li key={exercise.exerciseId} className="px-4 py-4">
            <p className="text-h3 font-extrabold text-foreground">{exercise.name}</p>
            <p className="mt-1 text-label text-muted-foreground">
              {exercise.sets} séries ·{' '}
              {exercise.reps
                ? `${repsText(exercise.reps)} repetições`
                : durationText(exercise.durationSeconds ?? 0)}{' '}
              · descanso {durationText(exercise.restSeconds)}
            </p>
          </li>
        ))}
      </ol>
    );
  }
  if (content.modality === 'RUNNING' || content.modality === 'HYROX') {
    return <EnduranceLines content={content} />;
  }
  return (
    <p className="px-4 py-4 text-body text-foreground">
      {content.label}: {content.plannedMinutes} min.
    </p>
  );
}

/** Tempo total do treino: o do relógio quando há, senão os minutos informados. */
function totalSeconds(execution: ExecutionView): number | null {
  const recorded = execution.metricsConfirmed
    ? (execution.metrics?.movingSeconds ?? execution.metrics?.elapsedSeconds)
    : undefined;
  if (recorded !== undefined) return recorded;
  return execution.durationMinutes !== null ? execution.durationMinutes * 60 : null;
}

/** Etapa 5: treino concluído, com o resumo e o cartão para o Story. */
function Completed({ execution }: { execution: ExecutionView }) {
  const seconds = totalSeconds(execution);
  return (
    <div className="px-4 py-8 text-center">
      <p aria-hidden="true" className="text-h2 font-extrabold text-verde-pulso">
        ✓
      </p>
      <h4 className="mt-3 text-h2 font-extrabold text-foreground">
        {execution.status === 'PARTIAL' ? 'Treino concluído em parte' : 'Treino concluído'}
      </h4>
      <p role="status" className="mt-2 text-muted-foreground">
        Tempo total: {formatShareCardClock(seconds)}
        {execution.rpe !== null ? ` · Esforço ${execution.rpe}/10` : ''}
      </p>
      <ShareCardPanel executionId={execution.id} />
    </div>
  );
}

/**
 * Um treino do dia: antes de começar mostra a prescrição e o "Iniciar"; em andamento, o
 * cronômetro e os registros da sessão até "Finalizar treino"; concluído, o resumo e o cartão.
 */
export function SessionCard({
  session,
  isToday,
  onChanged,
  onFinish,
}: {
  session: TrainingDaySession;
  isToday: boolean;
  onChanged: () => Promise<void>;
  /** Abre o questionário pós-treino desta sessão. */
  onFinish: () => Promise<void>;
}) {
  const api = useTrainingApi();
  const [startedLocally, setStartedLocally] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const execution = session.execution;
  const inProgress = execution?.status === 'IN_PROGRESS' || startedLocally !== null;
  const finished = execution && execution.status !== 'IN_PROGRESS' ? execution : null;
  const closed =
    session.status === 'DONE' || session.status === 'PARTIAL' || session.status === 'SKIPPED';
  const startedAt =
    (execution?.startedAt ? Date.parse(execution.startedAt) : NaN) || startedLocally || Date.now();

  async function start() {
    if (busy) return;
    setBusy(true);
    setError('');
    // O cronômetro aparece no toque, sem esperar a rede.
    setStartedLocally(Date.now());
    try {
      await api.startSession(session.scheduledSessionId);
      await onChanged();
    } catch (caught) {
      setStartedLocally(null);
      setError(caught instanceof Error ? caught.message : 'Não foi possível iniciar o treino.');
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    setError('');
    try {
      await onFinish();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível finalizar agora.');
      setBusy(false);
    }
  }

  const content = session.content;
  return (
    <article className="overflow-hidden rounded-3xl bg-card shadow-sm">
      <header className="flex items-center justify-between gap-3 bg-petroleo px-4 py-4">
        <div className="min-w-0">
          <h3 className="text-h3 font-bold text-white">{session.title}</h3>
          <p className="mt-0.5 text-label text-white/70">
            {SESSION_MODALITY_LABELS[session.modality]} ·{' '}
            {SESSION_PRIORITY_LABELS[session.priority]} · {session.estimatedMinutes} min
          </p>
        </div>
        {inProgress && !finished ? (
          <WorkoutTimer startedAt={startedAt} />
        ) : !execution && !closed && isToday ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void start()}
            className="min-h-12 shrink-0 rounded-xl bg-primary px-5 font-extrabold text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-60"
          >
            Iniciar
          </button>
        ) : (
          <span className="shrink-0 text-label font-semibold text-white/70">
            {!execution && !closed ? 'Dia encerrado' : STATUS_LABELS[session.status]}
          </span>
        )}
      </header>
      {session.purpose && !finished ? (
        <p className="border-b border-border px-4 py-3 text-label text-muted-foreground">
          {session.purpose}
        </p>
      ) : null}

      {error ? (
        <div className="px-4 pt-4">
          <StudentAlert>{error}</StudentAlert>
        </div>
      ) : null}

      {finished && (finished.status === 'COMPLETED' || finished.status === 'PARTIAL') ? (
        <Completed execution={finished} />
      ) : finished ? (
        <p role="status" className="px-6 py-8 text-center text-muted-foreground">
          Registrado: hoje não deu. A semana se ajusta, sem culpa.
        </p>
      ) : inProgress && execution ? (
        <>
          {content.modality === 'STRENGTH' ? (
            <StrengthSession
              executionId={execution.id}
              exercises={content.exercises}
              initialSets={execution.sets}
              onSaved={() => undefined}
            />
          ) : content.modality === 'RUNNING' || content.modality === 'HYROX' ? (
            <EnduranceSession
              executionId={execution.id}
              content={content}
              metrics={execution.metrics}
              onChange={() => void onChanged()}
            />
          ) : (
            <p className="px-4 py-4 text-body text-foreground">
              {content.label}: {content.plannedMinutes} min. Ao terminar, conte como foi.
            </p>
          )}
          <div className="border-t border-border p-4">
            <button
              type="button"
              disabled={busy}
              onClick={() => void finish()}
              className="min-h-14 w-full rounded-2xl bg-petroleo font-extrabold text-white transition-colors hover:bg-petroleo/85 disabled:pointer-events-none disabled:opacity-60"
            >
              {busy ? 'Salvando...' : 'Finalizar treino'}
            </button>
          </div>
        </>
      ) : inProgress ? (
        <p role="status" className="px-4 py-6 text-center text-muted-foreground">
          Abrindo seu treino…
        </p>
      ) : (
        <Prescription content={content} />
      )}
    </article>
  );
}
