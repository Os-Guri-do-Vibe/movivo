'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  SESSION_MODALITY_LABELS,
  SESSION_PRIORITY_LABELS,
  type ExecutionView,
  type TrainingDay,
  type TrainingDaySession,
} from '@movivo/shared';

import { Button } from '@/components/ui/button';
import {
  finishExecution,
  getTrainingDay,
  startSession,
  TrainingApiError,
} from '@/lib/training-api';

import { EnduranceSession } from './endurance-session';
import { ExternalLogForm } from './external-log-form';
import { FinishForm } from './finish-form';
import { dateLabel } from './format';
import { StrengthSession } from './strength-session';

const STATUS_LABELS: Record<TrainingDaySession['status'], string> = {
  PLANNED: 'Planejado',
  DONE: 'Concluído',
  PARTIAL: 'Em parte',
  MISSED: 'Sem registro',
  SKIPPED: 'Fora desta semana',
  MOVED: 'Movido',
};

function SessionCard({
  session,
  onChanged,
}: {
  session: TrainingDaySession;
  onChanged: () => Promise<void>;
}) {
  const [execution, setExecution] = useState<ExecutionView | null>(session.execution);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const closed =
    session.status === 'DONE' || session.status === 'PARTIAL' || session.status === 'SKIPPED';
  const inProgress = execution?.status === 'IN_PROGRESS';

  async function start() {
    setBusy(true);
    setError('');
    try {
      setExecution(await startSession(session.scheduledSessionId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível abrir o treino.');
    } finally {
      setBusy(false);
    }
  }

  const content = session.content;
  return (
    <article className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-h3 font-semibold">{session.title}</h3>
        <span className="text-label text-muted-foreground">
          {SESSION_MODALITY_LABELS[session.modality]} · {SESSION_PRIORITY_LABELS[session.priority]}{' '}
          · {session.estimatedMinutes} min · {STATUS_LABELS[session.status]}
        </span>
      </header>
      {session.purpose && <p className="text-body text-muted-foreground">{session.purpose}</p>}

      {!execution && !closed && (
        <div>
          <Button type="button" disabled={busy} onClick={() => void start()}>
            Começar treino
          </Button>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive bg-destructive/10 p-3 text-label"
        >
          {error}
        </p>
      )}

      {execution && content.modality === 'STRENGTH' && (
        <StrengthSession
          executionId={execution.id}
          exercises={content.exercises}
          initialSets={execution.sets}
          onSaved={setExecution}
        />
      )}
      {execution && (content.modality === 'RUNNING' || content.modality === 'HYROX') && (
        <EnduranceSession
          executionId={execution.id}
          content={content}
          metrics={execution.metrics}
          confirmed={execution.metricsConfirmed}
          onChange={setExecution}
        />
      )}
      {execution && content.modality === 'EXTERNAL_SPORT' && (
        <p className="text-body">
          {content.label}: {content.plannedMinutes} min. Ao terminar, conte como foi.
        </p>
      )}

      {inProgress && (
        <FinishForm
          defaultMinutes={session.estimatedMinutes}
          needsConfirmation={Boolean(execution.metrics) && !execution.metricsConfirmed}
          onFinish={async (request) => {
            setExecution(await finishExecution(execution.id, request));
            await onChanged();
          }}
        />
      )}
      {execution && !inProgress && (
        <p role="status" className="text-body">
          Registrado. {execution.rpe !== null ? `Esforço ${execution.rpe}/10` : ''}
          {execution.durationMinutes ? ` · ${execution.durationMinutes} min` : ''}. Bom trabalho.
        </p>
      )}
    </article>
  );
}

export function TrainingDayView({ date }: { date?: string }) {
  const [day, setDay] = useState<TrainingDay | null>(null);
  const [selected, setSelected] = useState<string | undefined>(date);
  const [error, setError] = useState('');
  const [showExternal, setShowExternal] = useState(false);

  const load = useCallback(async (target?: string) => {
    try {
      setDay(await getTrainingDay(target));
      setError('');
    } catch (caught) {
      setError(
        caught instanceof TrainingApiError && caught.status === 401
          ? 'Abra o link mais recente enviado no seu WhatsApp.'
          : 'Não foi possível carregar o treino agora.',
      );
    }
  }, []);

  useEffect(() => {
    void load(selected);
  }, [load, selected]);

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p role="alert" className="rounded-xl border border-destructive bg-destructive/10 p-4">
          {error}
        </p>
      </main>
    );
  }
  if (!day) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10" aria-busy="true">
        <p className="text-muted-foreground">Carregando seu treino…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-8">
      <section className="flex flex-col gap-2">
        <h1 className="text-h2 font-semibold">
          {day.firstName ? `${day.firstName}, seu treino` : 'Seu treino'}
        </h1>
        <p className="text-body text-muted-foreground">
          {day.date === day.today ? 'Hoje' : dateLabel(day.date)}, com a metodologia dos
          profissionais de Educação Física da MOVIVO.
        </p>
      </section>

      <nav aria-label="Semana" className="grid grid-cols-7 gap-1">
        {day.week.map((d) => (
          <button
            key={d.date}
            type="button"
            aria-current={d.date === day.date ? 'date' : undefined}
            onClick={() => setSelected(d.date)}
            className={`flex flex-col items-center rounded-lg border p-2 text-label ${d.date === day.date ? 'border-primary bg-primary/10' : 'border-border'}`}
          >
            <span>{dateLabel(d.date).slice(0, 3)}</span>
            <span aria-hidden="true">
              {d.sessions.length === 0
                ? '·'
                : d.sessions.every((s) => s.status === 'DONE')
                  ? '✓'
                  : '●'}
            </span>
          </button>
        ))}
      </nav>

      {day.selected.length === 0 ? (
        <p className="text-body text-muted-foreground">
          {day.hasPlan
            ? 'Dia de descanso: recuperar também é parte do plano.'
            : 'Seu plano ainda está sendo preparado. Assim que ficar pronto, avisamos por aqui.'}
        </p>
      ) : (
        day.selected.map((session) => (
          <SessionCard
            key={session.scheduledSessionId}
            session={session}
            onChanged={() => load(selected)}
          />
        ))
      )}

      <section>
        {showExternal ? (
          <ExternalLogForm
            today={day.today}
            onLogged={() => {
              setShowExternal(false);
              void load(selected);
            }}
          />
        ) : (
          <Button type="button" variant="outline" onClick={() => setShowExternal(true)}>
            Registrar outro treino
          </Button>
        )}
      </section>
    </main>
  );
}
