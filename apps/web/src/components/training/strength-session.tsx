'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import type { ExecutionSet, ExecutionView, StrengthExercise } from '@movivo/shared';

import { useTrainingApi } from './training-api-context';

import { StudentAlert } from './student-nav';

const FIELD_BASE =
  'mt-1 min-h-11 w-full rounded-xl border bg-card px-3 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
/** Campo de registro do treino: alto para o polegar, borda verde-pulso (padrão do diário). */
export const INPUT_CLASS = `${FIELD_BASE} border-verde-pulso`;
/** Campo de formulário secundário (dor, treino avulso): mesma forma, borda neutra. */
export const NEUTRAL_INPUT_CLASS = `${FIELD_BASE} border-input`;

/** Segundos → "45 s", "2 min", "1 min 30 s", "1 h 15 min" (nunca mais de dois níveis). */
export function durationText(totalSeconds: number): string {
  if (totalSeconds <= 60) return `${totalSeconds} s`;
  if (totalSeconds <= 3600) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/**
 * Número digitado → número ou null. Aceita vírgula (teclado de celular em pt-BR) e nunca
 * devolve NaN: o texto cru fica no campo enquanto o aluno digita.
 */
function parseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

type Draft = { reps: string; loadKg: string; durationSeconds: string };
const EMPTY: Draft = { reps: '', loadKg: '', durationSeconds: '' };

const keyOf = (exerciseId: string, setNumber: number) => `${exerciseId}:${setNumber}`;

/** Série feita = repetições (ou tempo) > 0. Carga vazia não invalida (feita sem peso). */
function isDone(draft: Draft | undefined): boolean {
  return (
    (parseNumber(draft?.reps ?? '') ?? 0) > 0 ||
    (parseNumber(draft?.durationSeconds ?? '') ?? 0) > 0
  );
}

/**
 * Séries do exercício, na ordem: aquecimento numerado até 0 (logo antes da série 1) e depois as
 * séries válidas. Cada uma sabe a faixa de repetições (ou o tempo) que vale para ela.
 */
function setsOf(exercise: StrengthExercise) {
  const warmup = (exercise.warmup ?? []).flatMap((block) =>
    Array.from({ length: block.sets }, () => block),
  );
  return [
    ...warmup.map((block, index) => ({
      setNumber: index - warmup.length + 1,
      warmup: true,
      reps: block.reps,
      durationSeconds: block.durationSeconds,
    })),
    ...Array.from({ length: exercise.sets }, (_, index) => ({
      setNumber: index + 1,
      warmup: false,
      reps: exercise.reps,
      durationSeconds: exercise.durationSeconds,
    })),
  ];
}

/** "8-10", ou só "12" quando a faixa é um número só. */
export const repsText = (reps: { min: number; max: number }) =>
  reps.min === reps.max ? String(reps.min) : `${reps.min}-${reps.max}`;

const prescriptionOf = (exercise: StrengthExercise) =>
  `${exercise.sets} séries · ${
    exercise.reps
      ? `${repsText(exercise.reps)} repetições`
      : durationText(exercise.durationSeconds ?? 0)
  } · descanso ${durationText(exercise.restSeconds)}`;

/**
 * Musculação em andamento, no padrão do check-in de sempre: exercícios recolhidos, só o próximo
 * aberto; cada série com repetições (ou tempo) e carga; "Concluído" risca o exercício e abre o
 * seguinte, "Pular este exercício" tira ele do registro. Grava cada série ao sair do campo.
 */
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
  const api = useTrainingApi();
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      initialSets.map((s) => [
        keyOf(s.exerciseId, s.setNumber),
        {
          reps: s.reps?.toString() ?? '',
          loadKg: s.loadKg?.toString().replace('.', ',') ?? '',
          durationSeconds: s.durationSeconds?.toString() ?? '',
        },
      ]),
    ),
  );
  // Já preenchido (reabrir a página no meio do treino) conta como concluído.
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        exercises
          .filter((exercise) =>
            setsOf(exercise).every((set) =>
              initialSets.some(
                (s) =>
                  s.exerciseId === exercise.exerciseId &&
                  s.setNumber === set.setNumber &&
                  s.completed,
              ),
            ),
          )
          .map((exercise) => exercise.exerciseId),
      ),
  );
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<ReadonlySet<string>>(() => {
    const next = exercises.find((exercise) => !confirmed.has(exercise.exerciseId));
    return new Set(next ? [next.exerciseId] : []);
  });
  const [error, setError] = useState('');

  function rowOf(exercise: StrengthExercise, setNumber: number, draft: Draft): ExecutionSet {
    return {
      exerciseId: exercise.exerciseId,
      setNumber,
      reps: parseNumber(draft.reps),
      loadKg: parseNumber(draft.loadKg),
      durationSeconds: parseNumber(draft.durationSeconds),
      rir: exercise.rir ?? null,
      completed: isDone(draft),
    };
  }

  async function persist(rows: ExecutionSet[]): Promise<boolean> {
    if (rows.length === 0) return true;
    setError('');
    try {
      onSaved(await api.saveSets(executionId, { sets: rows }));
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar a série.');
      return false;
    }
  }

  function edit(id: string, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [id]: { ...EMPTY, ...current[id], ...patch } }));
  }

  function toggle(exerciseId: string, isOpen: boolean) {
    setOpen((current) => {
      const next = new Set(current);
      if (isOpen) next.add(exerciseId);
      else next.delete(exerciseId);
      return next;
    });
  }

  /** Recolhe o exercício e abre o próximo ainda não concluído. */
  function advance(exerciseId: string) {
    setOpen((current) => {
      const next = new Set(current);
      next.delete(exerciseId);
      const index = exercises.findIndex((item) => item.exerciseId === exerciseId);
      const following = exercises
        .slice(index + 1)
        .find((item) => !confirmed.has(item.exerciseId) && !skipped.has(item.exerciseId));
      if (following) next.add(following.exerciseId);
      return next;
    });
  }

  async function skip(exercise: StrengthExercise, value: boolean) {
    setSkipped((current) => {
      const next = new Set(current);
      if (value) next.add(exercise.exerciseId);
      else next.delete(exercise.exerciseId);
      return next;
    });
    if (!value) return;
    setConfirmed((current) => {
      const next = new Set(current);
      next.delete(exercise.exerciseId);
      return next;
    });
    const rows = setsOf(exercise).map((set) => {
      const id = keyOf(exercise.exerciseId, set.setNumber);
      edit(id, EMPTY);
      return rowOf(exercise, set.setNumber, EMPTY);
    });
    if (await persist(rows)) advance(exercise.exerciseId);
  }

  /** "Concluído": grava só o que foi digitado; sem nenhuma série feita, o exercício é pulado. */
  async function complete(exercise: StrengthExercise) {
    const rows = setsOf(exercise).map((set) =>
      rowOf(exercise, set.setNumber, drafts[keyOf(exercise.exerciseId, set.setNumber)] ?? EMPTY),
    );
    if (!rows.some((row) => row.completed)) {
      await skip(exercise, true);
      return;
    }
    if (await persist(rows)) {
      setConfirmed((current) => new Set(current).add(exercise.exerciseId));
      advance(exercise.exerciseId);
    }
  }

  return (
    <div>
      {error ? (
        <div className="px-4 pt-4">
          <StudentAlert>{error}</StudentAlert>
        </div>
      ) : null}
      <div className="divide-y divide-border">
        {exercises.map((exercise) => {
          const isSkipped = skipped.has(exercise.exerciseId);
          const isConfirmed = confirmed.has(exercise.exerciseId);
          return (
            <details
              key={exercise.exerciseId}
              open={open.has(exercise.exerciseId)}
              onToggle={(event) => toggle(exercise.exerciseId, event.currentTarget.open)}
              className="group px-4 py-4"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                <div className="min-w-0">
                  <h4
                    className={`text-h3 font-extrabold ${isConfirmed || isSkipped ? 'text-muted-foreground line-through decoration-2' : 'text-foreground'}`}
                  >
                    {exercise.name}
                  </h4>
                  <p className="mt-1 text-label text-muted-foreground">
                    {prescriptionOf(exercise)}
                  </p>
                </div>
                <ChevronDown
                  aria-hidden="true"
                  className="shrink-0 text-muted-foreground transition group-open:rotate-180"
                />
              </summary>

              {isSkipped ? (
                <div className="mt-5 rounded-2xl bg-muted p-4 text-label text-muted-foreground">
                  Este exercício foi marcado como pulado e não entrará como realizado.
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  {setsOf(exercise).map((set) => {
                    const id = keyOf(exercise.exerciseId, set.setNumber);
                    const draft = drafts[id] ?? EMPTY;
                    const name = set.warmup ? 'do aquecimento' : `da série ${set.setNumber}`;
                    const save = () => void persist([rowOf(exercise, set.setNumber, draft)]);
                    return (
                      <div
                        key={set.setNumber}
                        className="grid grid-cols-[2rem_1fr_1fr] items-end gap-2"
                      >
                        <span className="pb-3 text-center font-bold text-foreground">
                          {set.warmup ? 'Aq' : set.setNumber}
                        </span>
                        {set.reps ? (
                          <label className="text-label text-muted-foreground">
                            Reps {repsText(set.reps)}
                            <input
                              inputMode="numeric"
                              aria-label={`Repetições ${name}`}
                              value={draft.reps}
                              placeholder="—"
                              onChange={(event) => edit(id, { reps: event.target.value })}
                              onBlur={save}
                              className={INPUT_CLASS}
                            />
                          </label>
                        ) : (
                          <label className="text-label text-muted-foreground">
                            {set.warmup && set.durationSeconds
                              ? `Aq · ${durationText(set.durationSeconds)}`
                              : `Tempo (s)${set.durationSeconds ? ` · ${durationText(set.durationSeconds)}` : ''}`}
                            <input
                              inputMode="numeric"
                              aria-label={`Tempo ${name} em segundos`}
                              value={draft.durationSeconds}
                              placeholder="—"
                              onChange={(event) =>
                                edit(id, { durationSeconds: event.target.value })
                              }
                              onBlur={save}
                              className={INPUT_CLASS}
                            />
                          </label>
                        )}
                        <label className="text-label text-muted-foreground">
                          Carga (kg)
                          <input
                            inputMode="decimal"
                            aria-label={`Carga ${name} em quilos`}
                            value={draft.loadKg}
                            placeholder="—"
                            onChange={(event) => edit(id, { loadKg: event.target.value })}
                            onBlur={save}
                            className={INPUT_CLASS}
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>
              )}

              {isSkipped ? (
                <button
                  type="button"
                  onClick={() => void skip(exercise, false)}
                  className="mt-4 min-h-11 w-full rounded-xl border border-verde-pulso px-4 text-label font-bold text-petroleo"
                >
                  Incluir exercício novamente
                </button>
              ) : (
                <div className="mt-4 flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => void skip(exercise, true)}
                    className="min-h-11 w-full rounded-xl border border-verde-pulso px-4 text-label font-bold text-muted-foreground"
                  >
                    Pular este exercício
                  </button>
                  <button
                    type="button"
                    onClick={() => void complete(exercise)}
                    className="min-h-11 w-full rounded-xl bg-petroleo px-4 text-label font-bold text-white"
                  >
                    Concluído
                  </button>
                </div>
              )}
            </details>
          );
        })}
      </div>
    </div>
  );
}

/** Quantos exercícios têm ao menos uma série feita (para sugerir "fiz tudo" ou "uma parte"). */
export function strengthProgress(exercises: StrengthExercise[], sets: ExecutionSet[]) {
  const done = exercises.filter((exercise) =>
    sets.some((s) => s.exerciseId === exercise.exerciseId && s.setNumber >= 1 && s.completed),
  ).length;
  return { done, total: exercises.length };
}
