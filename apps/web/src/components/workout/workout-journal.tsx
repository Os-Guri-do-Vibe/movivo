'use client';

import type { WorkoutJournal, WorkoutSetInput } from '@movivo/shared';
import { ChevronDown, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

const DAY_LABELS: Readonly<Record<string, string>> = {
  SUN: 'Dom',
  MON: 'Seg',
  TUE: 'Ter',
  WED: 'Qua',
  THU: 'Qui',
  FRI: 'Sex',
  SAT: 'Sab',
};

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function formatTimer(seconds: number) {
  const hours = Math.floor(seconds / 3600)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const rest = (seconds % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${rest}`;
}

function weekStart(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - value.getUTCDay());
  return value;
}

function weekContext(selectedDate: string, today: string) {
  const offset = Math.round(
    (weekStart(selectedDate).getTime() - weekStart(today).getTime()) / 604_800_000,
  );
  if (offset === 0) return 'Semana atual';
  if (offset === -1) return 'Semana passada';
  return `${Math.abs(offset)} semanas atras`;
}

function weekRange(week: WorkoutJournal['week']) {
  const first = week[0]?.date;
  const last = week.at(-1)?.date;
  if (!first || !last) return '';
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const year = new Date(`${last}T12:00:00Z`).getUTCFullYear();
  return `${formatter.format(new Date(`${first}T12:00:00Z`))} - ${formatter.format(new Date(`${last}T12:00:00Z`))} de ${year}`;
}

function selectedDateLabel(date: string) {
  const label = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function acceptSuggestedWorkoutSets(
  sets: WorkoutSetInput[],
  workout: NonNullable<WorkoutJournal['workout']>,
): WorkoutSetInput[] {
  const exerciseById = new Map(
    workout.prescription.exercises.map((exercise) => [exercise.exerciseId, exercise]),
  );
  const previousByKey = new Map(
    workout.sets.map((entry) => [`${entry.exerciseId}:${entry.setNumber}`, entry.previous]),
  );
  return sets.map((entry) => {
    if (entry.skipped) return { ...entry, completed: false };
    const exercise = exerciseById.get(entry.exerciseId);
    const previous = previousByKey.get(`${entry.exerciseId}:${entry.setNumber}`);
    return {
      ...entry,
      reps: entry.reps ?? previous?.reps ?? exercise?.reps?.min ?? null,
      loadValue: entry.loadValue ?? previous?.loadValue ?? null,
      loadUnit: previous?.loadValue != null ? previous.loadUnit : entry.loadUnit,
      durationSeconds:
        entry.durationSeconds ?? previous?.durationSeconds ?? exercise?.durationSeconds ?? null,
      completed: true,
      skipped: false,
    };
  });
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(payload?.message ?? 'Nao foi possivel concluir.');
  }
  return response;
}

export function WorkoutJournalView() {
  const router = useRouter();
  const [journal, setJournal] = useState<WorkoutJournal | null>(null);
  const [sets, setSets] = useState<WorkoutSetInput[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const [effort, setEffort] = useState(5);
  const [feelingNotes, setFeelingNotes] = useState('');
  const [painReported, setPainReported] = useState(false);
  const [painExerciseId, setPainExerciseId] = useState('');
  const [painNotes, setPainNotes] = useState('');
  const [elapsed, setElapsed] = useState(0);

  const load = useCallback(
    async (date?: string) => {
      setError('');
      const response = await fetch(`/api/workout/journal${date ? `?date=${date}` : ''}`, {
        cache: 'no-store',
      });
      if (response.status === 401) {
        router.replace('/treino/acessar');
        return;
      }
      if (!response.ok) throw new Error('Nao foi possivel carregar seu treino.');
      const value = (await response.json()) as WorkoutJournal;
      setJournal(value);
      setSets(value.workout?.sets.map(({ previous: _previous, ...entry }) => entry) ?? []);
    },
    [router],
  );

  useEffect(() => {
    void load().catch((reason: Error) => setError(reason.message));
  }, [load]);
  useEffect(() => {
    const started = journal?.workout?.startedAt;
    if (!started || journal?.workout?.status !== 'IN_PROGRESS') return;
    const tick = () =>
      setElapsed(Math.max(0, Math.floor((Date.now() - new Date(started).getTime()) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [journal?.workout?.startedAt, journal?.workout?.status]);

  const previousByKey = useMemo(
    () =>
      new Map(
        journal?.workout?.sets.map((entry) => [
          `${entry.exerciseId}:${entry.setNumber}`,
          entry.previous,
        ]) ?? [],
      ),
    [journal],
  );
  const workout = journal?.workout;

  function updateSet(index: number, patch: Partial<WorkoutSetInput>) {
    setSets((current) =>
      current.map((entry, at) => {
        if (at !== index) return entry;
        const updated = { ...entry, ...patch, skipped: false };
        return {
          ...updated,
          completed:
            updated.reps != null || updated.loadValue != null || updated.durationSeconds != null,
        };
      }),
    );
  }

  async function save(entries = sets) {
    if (!workout) return;
    await request(`/api/workout/sessions/${workout.id}/sets`, {
      method: 'PATCH',
      body: JSON.stringify({ entries }),
    });
  }

  async function toggleExerciseSkipped(exerciseId: string) {
    const exerciseSets = sets.filter((entry) => entry.exerciseId === exerciseId);
    const skipped = !exerciseSets.every((entry) => entry.skipped);
    const next = sets.map((entry) =>
      entry.exerciseId !== exerciseId
        ? entry
        : {
            ...entry,
            reps: skipped ? null : entry.reps,
            loadValue: skipped ? null : entry.loadValue,
            durationSeconds: skipped ? null : entry.durationSeconds,
            completed: false,
            skipped,
          },
    );
    setSets(next);
    try {
      await save(next);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  async function start() {
    if (!workout) return;
    setBusy(true);
    try {
      await request(`/api/workout/sessions/${workout.id}/start`, { method: 'POST' });
      await load(journal?.selectedDate);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!workout) return;
    setBusy(true);
    setError('');
    try {
      await save();
      await request(`/api/workout/sessions/${workout.id}/finish`, {
        method: 'POST',
        body: JSON.stringify({
          perceivedEffort: effort,
          feelingNotes,
          painReported,
          painExerciseId: painExerciseId || null,
          painNotes,
        }),
      });
      setFeedback(false);
      await load(journal?.selectedDate);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!journal)
    return (
      <main className="onboarding-light grid min-h-dvh place-items-center bg-[var(--nevoa)]">
        <p>{error || 'Preparando seu treino...'}</p>
      </main>
    );

  if (feedback && workout) {
    return (
      <main className="onboarding-light min-h-dvh bg-[var(--nevoa)] px-4 py-6 text-[var(--grafite)]">
        <section className="mx-auto max-w-xl rounded-3xl bg-white p-6 shadow-sm sm:p-8">
          <Image
            src="/brand/movivo-logo-horizontal.svg"
            alt="MOVIVO"
            width={180}
            height={40}
            className="h-9 rounded-md bg-[var(--petroleo-vivo)] px-3 py-2"
          />
          <p className="mt-10 text-sm font-bold uppercase tracking-widest text-[var(--musgo)]">
            Treino concluido
          </p>
          <h1 className="mt-2 text-3xl font-extrabold">Como foi para voce?</h1>
          <label className="mt-8 block font-bold">
            Percepcao de esforco: <span className="text-xl">{effort}/10</span>
          </label>
          <input
            aria-label="Percepcao de esforco"
            type="range"
            min="1"
            max="10"
            value={effort}
            onChange={(event) => setEffort(Number(event.target.value))}
            className="mt-3 w-full accent-[var(--verde-pulso)]"
          />
          <label className="mt-7 block font-bold" htmlFor="feeling">
            Como voce se sentiu?
          </label>
          <textarea
            id="feeling"
            value={feelingNotes}
            onChange={(event) => setFeelingNotes(event.target.value)}
            maxLength={1000}
            className="mt-2 min-h-28 w-full rounded-xl border border-[var(--input)] p-3"
            placeholder="Conte o que foi leve, dificil ou diferente hoje."
          />
          <label className="mt-6 flex min-h-12 items-center gap-3 rounded-xl bg-[var(--nevoa)] px-4 font-bold">
            <input
              type="checkbox"
              checked={painReported}
              onChange={(event) => setPainReported(event.target.checked)}
              className="size-5 accent-[var(--coral-vivo)]"
            />{' '}
            Senti dor durante ou depois do treino
          </label>
          {painReported ? (
            <div className="mt-4 space-y-3 rounded-2xl border-2 border-[var(--coral-vivo)] p-4">
              <p className="font-bold">Isso gera um alerta para o profissional CREF.</p>
              <select
                aria-label="Exercicio relacionado a dor"
                value={painExerciseId}
                onChange={(event) => setPainExerciseId(event.target.value)}
                className="min-h-12 w-full rounded-xl border border-[var(--input)] bg-white px-3"
              >
                <option value="">Selecione o exercicio</option>
                {workout.prescription.exercises.map((exercise) => (
                  <option key={exercise.exerciseId} value={exercise.exerciseId}>
                    {exercise.name}
                  </option>
                ))}
              </select>
              <textarea
                aria-label="Descricao da dor"
                value={painNotes}
                onChange={(event) => setPainNotes(event.target.value)}
                className="min-h-24 w-full rounded-xl border border-[var(--input)] p-3"
                placeholder="Onde doeu e como foi a sensacao?"
              />
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="mt-4 text-sm text-red-800">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            disabled={busy || (painReported && (!painExerciseId || painNotes.trim().length < 3))}
            onClick={finish}
            className="mt-8 min-h-14 w-full rounded-2xl bg-[var(--verde-pulso)] font-extrabold text-[var(--petroleo-vivo)] disabled:opacity-50"
          >
            {busy ? 'Salvando...' : 'Enviar e finalizar'}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="onboarding-light min-h-dvh bg-[var(--nevoa)] pb-28 text-[var(--grafite)]">
      <header className="bg-[var(--petroleo-vivo)] px-5 pb-8 pt-5 text-white">
        <div className="mx-auto flex max-w-2xl items-center">
          <Image
            src="/brand/movivo-logo-horizontal.svg"
            alt="MOVIVO"
            width={180}
            height={40}
            className="h-9 w-auto"
          />
        </div>
        <div className="mx-auto mt-8 max-w-2xl">
          <p className="text-white/70">Ola,</p>
          <h1 className="text-3xl font-extrabold">{journal.firstName}</h1>
        </div>
      </header>
      <div className="mx-auto max-w-2xl px-4">
        <section className="-mt-4 rounded-3xl bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <button
              type="button"
              aria-label="Semana anterior"
              onClick={() => void load(addDays(journal.selectedDate, -7))}
              className="grid size-10 place-items-center rounded-full bg-[var(--nevoa)]"
            >
              <ChevronLeft />
            </button>
            <div className="text-center">
              <p className="font-extrabold">{weekContext(journal.selectedDate, journal.today)}</p>
              <p className="mt-0.5 text-xs text-[var(--musgo)]">{weekRange(journal.week)}</p>
            </div>
            <button
              type="button"
              aria-label="Proxima semana"
              disabled={addDays(journal.selectedDate, 7) > journal.today}
              onClick={() => void load(addDays(journal.selectedDate, 7))}
              className="grid size-10 place-items-center rounded-full bg-[var(--nevoa)] disabled:opacity-30"
            >
              <ChevronRight />
            </button>
          </div>
          {weekContext(journal.selectedDate, journal.today) !== 'Semana atual' ? (
            <button
              type="button"
              onClick={() => void load(journal.today)}
              className="mx-auto mb-4 block rounded-full bg-[var(--petroleo-vivo)] px-4 py-2 text-sm font-bold text-white"
            >
              Voltar para hoje
            </button>
          ) : null}
          <div className="grid grid-cols-7 gap-1" aria-label="Dias da semana">
            {journal.week.map((day) => {
              const selected = day.date === journal.selectedDate;
              const today = day.date === journal.today;
              return (
                <button
                  key={day.date}
                  type="button"
                  disabled={day.state === 'FUTURE'}
                  onClick={() => void load(day.date)}
                  aria-label={`${DAY_LABELS[day.weekday]}, ${day.date}`}
                  aria-current={selected ? 'date' : undefined}
                  className="mx-auto flex min-w-10 flex-col items-center gap-1.5 disabled:opacity-35"
                >
                  <span
                    className={`grid size-10 place-items-center rounded-full text-sm font-extrabold ${today ? 'bg-[var(--verde-pulso)] text-[var(--petroleo-vivo)]' : selected ? 'bg-[var(--coral-vivo)] text-[var(--petroleo-vivo)]' : 'bg-[var(--nevoa-elevada)] text-[var(--musgo)]'}`}
                  >
                    {Number(day.date.slice(-2))}
                  </span>
                  <span className="text-[0.68rem] font-bold uppercase text-[var(--musgo)]">
                    {DAY_LABELS[day.weekday]}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-4 text-center text-sm font-bold text-[var(--grafite)]">
            {selectedDateLabel(journal.selectedDate)}
          </p>
        </section>
        {error ? (
          <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-red-800">
            {error}
          </p>
        ) : null}
        {!workout ? (
          <section className="mt-5 rounded-3xl bg-white p-8 text-center">
            <p className="text-2xl">🌿</p>
            <h2 className="mt-3 text-xl font-extrabold">Dia de recuperacao</h2>
            <p className="mt-2 text-[var(--musgo)]">Nao ha treino prescrito para este dia.</p>
          </section>
        ) : workout.status === 'COMPLETED' ? (
          <section className="mt-5 rounded-3xl bg-white p-8 text-center">
            <p className="text-3xl">✓</p>
            <h2 className="mt-3 text-2xl font-extrabold">Treino concluido</h2>
            <p className="mt-2 text-[var(--musgo)]">
              Tempo total: {formatTimer(workout.durationSeconds ?? 0)} · Esforco{' '}
              {workout.perceivedEffort}/10
            </p>
          </section>
        ) : (
          <>
            <section className="mt-5 flex items-center justify-between rounded-2xl bg-white p-4">
              <div>
                <p className="text-sm text-[var(--musgo)]">{workout.prescription.dayLabel}</p>
                <h2 className="text-xl font-extrabold">{workout.prescription.focus}</h2>
              </div>
              {workout.status === 'IN_PROGRESS' ? (
                <div className="flex items-center gap-2 font-mono font-bold">
                  <Clock3 size={18} />
                  {formatTimer(elapsed)}
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={start}
                  className="min-h-12 rounded-xl bg-[var(--verde-pulso)] px-5 font-extrabold text-[var(--petroleo-vivo)]"
                >
                  Iniciar treino
                </button>
              )}
            </section>
            <div className="mt-4 space-y-4">
              {workout.prescription.exercises.map((exercise) => {
                const exerciseSets = sets.filter(
                  (entry) => entry.exerciseId === exercise.exerciseId,
                );
                const exerciseSkipped =
                  exerciseSets.length > 0 && exerciseSets.every((entry) => entry.skipped);
                return (
                  <details
                    key={exercise.exerciseId}
                    open
                    className="group rounded-3xl bg-white p-5 shadow-sm"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between">
                      <div>
                        <h3 className="text-lg font-extrabold">{exercise.name}</h3>
                        <p className="mt-1 text-sm text-[var(--musgo)]">
                          {exercise.sets} series ·{' '}
                          {exercise.reps
                            ? `${exercise.reps.min}-${exercise.reps.max} repeticoes`
                            : `${exercise.durationSeconds}s`}{' '}
                          · descanso ${exercise.restSeconds}s
                        </p>
                      </div>
                      <ChevronDown className="transition group-open:rotate-180" />
                    </summary>
                    {exerciseSkipped ? (
                      <div className="mt-5 rounded-2xl bg-[var(--nevoa)] p-4 text-sm text-[var(--musgo)]">
                        Este exercicio foi marcado como pulado e nao entrara como realizado.
                      </div>
                    ) : (
                      <div className="mt-5 space-y-3">
                        {sets.map((entry, index) => {
                          if (entry.exerciseId !== exercise.exerciseId) return null;
                          const previous = previousByKey.get(
                            `${entry.exerciseId}:${entry.setNumber}`,
                          );
                          const delta =
                            entry.loadValue != null &&
                            previous?.loadValue != null &&
                            entry.loadUnit === previous.loadUnit
                              ? entry.loadValue - previous.loadValue
                              : null;
                          return (
                            <div
                              key={entry.setNumber}
                              className="grid grid-cols-[2rem_1fr_1fr] items-end gap-2"
                            >
                              <span className="pb-3 text-center font-bold">{entry.setNumber}</span>
                              {exercise.reps ? (
                                <label className="text-xs text-[var(--musgo)]">
                                  Reps
                                  <input
                                    inputMode="numeric"
                                    value={entry.reps ?? ''}
                                    placeholder={
                                      previous?.reps?.toString() ?? `${exercise.reps.min}`
                                    }
                                    onChange={(event) =>
                                      updateSet(index, {
                                        reps: event.target.value
                                          ? Number(event.target.value)
                                          : null,
                                      })
                                    }
                                    onBlur={() => void save()}
                                    className="mt-1 min-h-11 w-full rounded-xl border border-[var(--input)] px-3 text-base text-[var(--grafite)]"
                                  />
                                </label>
                              ) : (
                                <label className="text-xs text-[var(--musgo)]">
                                  Segundos
                                  <input
                                    inputMode="numeric"
                                    value={entry.durationSeconds ?? ''}
                                    placeholder={
                                      previous?.durationSeconds?.toString() ??
                                      `${exercise.durationSeconds}`
                                    }
                                    onChange={(event) =>
                                      updateSet(index, {
                                        durationSeconds: event.target.value
                                          ? Number(event.target.value)
                                          : null,
                                      })
                                    }
                                    onBlur={() => void save()}
                                    className="mt-1 min-h-11 w-full rounded-xl border border-[var(--input)] px-3 text-base text-[var(--grafite)]"
                                  />
                                </label>
                              )}
                              <label className="text-xs text-[var(--musgo)]">
                                Carga (kg)
                                <span
                                  className={`ml-1 font-bold ${delta && delta > 0 ? 'text-emerald-700' : 'text-[var(--musgo)]'}`}
                                >
                                  {delta === null
                                    ? ''
                                    : delta > 0
                                      ? `+${delta}kg`
                                      : delta < 0
                                        ? `${delta}kg`
                                        : '—'}
                                </span>
                                <input
                                  inputMode="decimal"
                                  value={entry.loadValue ?? ''}
                                  placeholder={previous?.loadValue?.toString() ?? '—'}
                                  onChange={(event) =>
                                    updateSet(index, {
                                      loadValue: event.target.value
                                        ? Number(event.target.value)
                                        : null,
                                    })
                                  }
                                  onBlur={() => void save()}
                                  className="mt-1 min-h-11 w-full rounded-xl border border-[var(--input)] px-3 text-base text-[var(--grafite)]"
                                />
                              </label>
                              <span
                                className={`col-span-2 col-start-2 text-xs font-bold ${entry.completed ? 'text-emerald-700' : 'text-[var(--musgo)]'}`}
                              >
                                {entry.completed
                                  ? 'Registrada automaticamente'
                                  : 'Usara a sugestao'}
                              </span>
                            </div>
                          );
                        })}
                        <p className="text-xs text-[var(--musgo)]">
                          Ao finalizar, valores em cinza serao aceitos como realizados. Edite apenas
                          o que mudou.
                        </p>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => void toggleExerciseSkipped(exercise.exerciseId)}
                      aria-pressed={exerciseSkipped}
                      className={`mt-4 min-h-11 w-full rounded-xl border px-4 text-sm font-bold ${exerciseSkipped ? 'border-[var(--verde-pulso)] text-[var(--petroleo-vivo)]' : 'border-[var(--input)] text-[var(--musgo)]'}`}
                    >
                      {exerciseSkipped ? 'Incluir exercicio novamente' : 'Pular este exercicio'}
                    </button>
                  </details>
                );
              })}
            </div>
            {workout.status === 'IN_PROGRESS' ? (
              <button
                type="button"
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    const accepted = acceptSuggestedWorkoutSets(sets, workout);
                    setSets(accepted);
                    await save(accepted);
                    setFeedback(true);
                    window.scrollTo(0, 0);
                  } catch (reason) {
                    setError((reason as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy}
                className="mt-6 min-h-14 w-full rounded-2xl bg-[var(--coral-vivo)] font-extrabold text-[var(--petroleo-vivo)]"
              >
                {busy ? 'Salvando...' : 'Finalizar treino'}
              </button>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
