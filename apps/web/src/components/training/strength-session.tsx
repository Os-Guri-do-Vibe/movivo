'use client';

import { useState } from 'react';

import type { ExecutionSet, ExecutionView, StrengthExercise } from '@movivo/shared';

import { saveSets } from '@/lib/training-api';

type Draft = { reps: string; loadKg: string; completed: boolean };

const key = (exerciseId: string, setNumber: number) => `${exerciseId}:${setNumber}`;

/** Séries de força: cada exercício com as séries prescritas; grava ao marcar/alterar. */
export function StrengthSession({
  executionId,
  exercises,
  initialSets,
  onSaved,
}: {
  executionId: string;
  exercises: StrengthExercise[];
  initialSets: ExecutionSet[];
  onSaved: (view: ExecutionView) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      initialSets
        .filter((s) => s.setNumber >= 1)
        .map((s) => [
          key(s.exerciseId, s.setNumber),
          {
            reps: s.reps?.toString() ?? '',
            loadKg: s.loadKg?.toString() ?? '',
            completed: s.completed,
          },
        ]),
    ),
  );
  const [error, setError] = useState('');

  async function persist(exercise: StrengthExercise, setNumber: number, draft: Draft) {
    setError('');
    try {
      const view = await saveSets(executionId, {
        sets: [
          {
            exerciseId: exercise.exerciseId,
            setNumber,
            reps: draft.reps === '' ? null : Number(draft.reps),
            loadKg: draft.loadKg === '' ? null : Number(draft.loadKg.replace(',', '.')),
            durationSeconds: exercise.durationSeconds ?? null,
            rir: exercise.rir ?? null,
            completed: draft.completed,
          },
        ],
      });
      onSaved(view);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar a série.');
    }
  }

  function update(
    exercise: StrengthExercise,
    setNumber: number,
    patch: Partial<Draft>,
    save: boolean,
  ) {
    const id = key(exercise.exerciseId, setNumber);
    const next: Draft = { reps: '', loadKg: '', completed: false, ...drafts[id], ...patch };
    setDrafts((prev) => ({ ...prev, [id]: next }));
    if (save) void persist(exercise, setNumber, next);
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive bg-destructive/10 p-3 text-label"
        >
          {error}
        </p>
      )}
      {exercises.map((exercise) => (
        <section key={exercise.exerciseId} className="rounded-xl border border-border p-4">
          <h4 className="font-semibold">{exercise.name}</h4>
          <p className="text-label text-muted-foreground">
            {exercise.sets} séries ·{' '}
            {exercise.durationSeconds
              ? `${exercise.durationSeconds} s`
              : exercise.reps
                ? `${exercise.reps.min}–${exercise.reps.max} reps`
                : ''}
            {exercise.rir !== undefined ? ` · deixe ${exercise.rir} repetições na reserva` : ''} ·
            descanso {exercise.restSeconds} s
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {Array.from({ length: exercise.sets }, (_, index) => index + 1).map((setNumber) => {
              const draft = drafts[key(exercise.exerciseId, setNumber)] ?? {
                reps: '',
                loadKg: '',
                completed: false,
              };
              return (
                <li key={setNumber} className="flex flex-wrap items-center gap-3">
                  <span className="w-16 text-label text-muted-foreground">Série {setNumber}</span>
                  {!exercise.durationSeconds && (
                    <label className="flex items-center gap-1 text-label">
                      <span className="sr-only">Repetições da série {setNumber}</span>
                      <input
                        inputMode="numeric"
                        value={draft.reps}
                        placeholder="reps"
                        onChange={(e) =>
                          update(exercise, setNumber, { reps: e.target.value }, false)
                        }
                        onBlur={() => draft.completed && update(exercise, setNumber, {}, true)}
                        className="h-10 w-20 rounded-lg border border-border bg-card px-2 text-body"
                      />
                    </label>
                  )}
                  <label className="flex items-center gap-1 text-label">
                    <span className="sr-only">Carga da série {setNumber} em quilos</span>
                    <input
                      inputMode="decimal"
                      value={draft.loadKg}
                      placeholder="kg"
                      onChange={(e) =>
                        update(exercise, setNumber, { loadKg: e.target.value }, false)
                      }
                      onBlur={() => draft.completed && update(exercise, setNumber, {}, true)}
                      className="h-10 w-20 rounded-lg border border-border bg-card px-2 text-body"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-label">
                    <input
                      type="checkbox"
                      checked={draft.completed}
                      onChange={(e) =>
                        update(exercise, setNumber, { completed: e.target.checked }, true)
                      }
                    />
                    Feita
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
