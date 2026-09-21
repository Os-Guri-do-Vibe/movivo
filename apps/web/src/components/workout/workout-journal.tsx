'use client';

import type { WorkoutJournal, WorkoutSetInput } from '@movivo/shared';
import { ChevronDown, ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

// Biblioteca anatômica e exportador só entram após o treino ser concluído.
const WorkoutShareCardPanel = dynamic(
  () => import('./share-card/WorkoutShareCardPanel').then((module) => module.WorkoutShareCardPanel),
  { ssr: false },
);

const DAY_LABELS: Readonly<Record<string, string>> = {
  SUN: 'Dom',
  MON: 'Seg',
  TUE: 'Ter',
  WED: 'Qua',
  THU: 'Qui',
  FRI: 'Sex',
  SAT: 'Sáb',
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

/**
 * Segundos -> unidade legivel (h/min/s), com espaço entre número e símbolo (SI).
 * Nunca combina mais de dois níveis (ex.: "1 h 15 min", nunca "1 h 15 min 30 s").
 */
function formatDurationLabel(totalSeconds: number) {
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
 * Campo numérico digitado -> número ou null. Aceita vírgula como separador
 * decimal (teclado numérico de celular em pt-BR usa vírgula, não ponto) e nunca
 * devolve NaN — achado 2026-09-04: `Number("24,5")` é NaN, e como `?? ''` só
 * cobre null/undefined, o campo travava mostrando "NaN" e o usuário não
 * conseguia mais digitar (todo dígito novo formava outra string não numérica).
 */
function parseNumberInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

type ProtocolExercise = NonNullable<WorkoutJournal['workout']>['prescription']['exercises'][number];

/**
 * Aquecimento tem reps/duração próprios, diferentes das séries válidas. As séries
 * de aquecimento são numeradas em ordem crescente terminando em 0 (achado
 * 2026-09-04) — esta função reconstitui a qual `warmupBlocks[i]` uma série
 * `setNumber <= 0` pertence, na mesma ordem em que o backend as gerou.
 */
function warmupBlockForSet(exercise: ProtocolExercise, setNumber: number) {
  const blocks = exercise.warmupBlocks ?? [];
  const warmupCount = blocks.reduce((sum, block) => sum + block.sets, 0);
  if (warmupCount === 0 || setNumber > 0) return undefined;
  const index = setNumber + warmupCount - 1;
  let cursor = 0;
  for (const block of blocks) {
    if (index < cursor + block.sets) return block;
    cursor += block.sets;
  }
  return undefined;
}

/**
 * Todas as séries do exercício (aquecimento incluído) com reps/tempo E carga
 * preenchidos — mais estrito que `entry.completed` (que basta um campo). Pulado
 * não conta como preenchido: o exercício some dos campos de entrada.
 *
 * Cardio (`isCardio`, achado 2026-09-04) não tem campo nenhum pra preencher —
 * "feito" é decidido só pelo clique em "Concluído" (`completeCardioExercise`),
 * que já marca `completed: true` direto, sem depender de reps/carga digitados.
 */
/** "A" / "A e B" / "A, B e C" — junção natural em pt-BR para nomes selecionados. */
function joinNatural(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

function isExerciseFilled(exercise: ProtocolExercise, exerciseSets: WorkoutSetInput[]): boolean {
  if (exerciseSets.length === 0) return false;
  if (exerciseSets.every((entry) => entry.skipped)) return false;
  if (exercise.isCardio) return exerciseSets.every((entry) => entry.completed);
  return exerciseSets.every(
    (entry) =>
      (exercise.reps ? entry.reps != null : entry.durationSeconds != null) &&
      entry.loadValue != null,
  );
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
  return `${Math.abs(offset)} semanas atrás`;
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
    throw new Error(payload?.message ?? 'Não foi possível concluir.');
  }
  return response;
}

function LogoBand() {
  return (
    <header className="flex w-full justify-center bg-petroleo px-6 py-6" aria-label="MOVIVO">
      <Image
        src="/brand/movivo-logo-horizontal.svg"
        alt="MOVIVO"
        width={176}
        height={46}
        className="h-auto w-[154px] sm:w-44"
      />
    </header>
  );
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
  const [painExerciseIds, setPainExerciseIds] = useState<string[]>([]);
  const [painNotes, setPainNotes] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [openExercises, setOpenExercises] = useState<ReadonlySet<string>>(new Set());
  const [confirmedExercises, setConfirmedExercises] = useState<ReadonlySet<string>>(new Set());
  // Texto bruto por campo (chave "exercicio:serie:campo") enquanto o usuário digita —
  // achado 2026-09-04: sem isso, cada tecla reformata o valor a partir do número já
  // convertido, e "20,5" vira "205" (a vírgula/ponto intermediário some no re-render
  // antes do próximo dígito chegar). Some do mapa no blur, quando o valor se normaliza.
  const [rawInputs, setRawInputs] = useState<Readonly<Record<string, string>>>({});

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
      if (!response.ok) throw new Error('Não foi possível carregar seu treino.');
      const value = (await response.json()) as WorkoutJournal;
      setJournal(value);
      setSets(value.workout?.sets.map(({ previous: _previous, ...entry }) => entry) ?? []);

      // Exercícios já preenchidos (dado estável vindo do servidor, nunca digitação ao
      // vivo) contam como concluídos de cara — cobre reabrir a página no meio do treino.
      const exercises = value.workout?.prescription.exercises ?? [];
      const savedSets = value.workout?.sets ?? [];
      const confirmed = new Set(
        exercises
          .filter((exercise) =>
            isExerciseFilled(
              exercise,
              savedSets.filter((entry) => entry.exerciseId === exercise.exerciseId),
            ),
          )
          .map((exercise) => exercise.exerciseId),
      );
      setConfirmedExercises(confirmed);

      // Todos os exercícios vêm recolhidos; só o primeiro ainda não concluído abre
      // sozinho quando o treino está em andamento (início ou reabertura da página).
      const nextToOpenId =
        value.workout?.status === 'IN_PROGRESS'
          ? exercises.find((exercise) => !confirmed.has(exercise.exerciseId))?.exerciseId
          : undefined;
      setOpenExercises(nextToOpenId ? new Set([nextToOpenId]) : new Set());
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
  const navigationLocked = workout?.status === 'IN_PROGRESS';

  // Ao confirmar um exercício (clique explícito em "Concluído" — nunca reativo à
  // digitação, achado 2026-09-04: preencher o último dígito da carga já disparava
  // a conclusão sozinho): recolhe, marca como concluído e abre o próximo.
  function confirmExerciseDone(exerciseId: string) {
    setConfirmedExercises((current) => new Set(current).add(exerciseId));
    setOpenExercises((current) => {
      const next = new Set(current);
      next.delete(exerciseId);
      const exercises = workout?.prescription.exercises ?? [];
      const index = exercises.findIndex((item) => item.exerciseId === exerciseId);
      const following = exercises[index + 1];
      if (following) next.add(following.exerciseId);
      return next;
    });
  }

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

  function numberFieldProps(
    key: string,
    numericValue: number | null | undefined,
    onValue: (parsed: number | null) => void,
  ) {
    return {
      value: rawInputs[key] ?? (Number.isFinite(numericValue) ? String(numericValue) : ''),
      onChange: (event: { target: { value: string } }) => {
        const raw = event.target.value;
        setRawInputs((current) => ({ ...current, [key]: raw }));
        const parsed = parseNumberInput(raw);
        // Uma letra digitada sem querer no meio de um número (ex.: "24a") não pode
        // apagar o valor já válido — só propaga quando o texto vira um número de
        // verdade, ou quando o campo foi limpo de propósito (texto vazio).
        if (parsed !== null || raw.trim() === '') onValue(parsed);
      },
      onBlur: () => {
        setRawInputs((current) => {
          if (!(key in current)) return current;
          const next = { ...current };
          delete next[key];
          return next;
        });
        void save();
      },
    };
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

  // Cardio não tem campo pra digitar (achado 2026-09-04) — "Concluído" marca a
  // série como feita direto, com o tempo prescrito como padrão, e já confirma.
  async function completeCardioExercise(exercise: ProtocolExercise) {
    const next = sets.map((entry) =>
      entry.exerciseId !== exercise.exerciseId
        ? entry
        : {
            ...entry,
            durationSeconds: entry.durationSeconds ?? exercise.durationSeconds ?? null,
            completed: true,
            skipped: false,
          },
    );
    setSets(next);
    try {
      await save(next);
      confirmExerciseDone(exercise.exerciseId);
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
          painExerciseIds,
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
      <main className="protocolo-light grid min-h-dvh grid-rows-[auto_1fr] bg-background text-foreground">
        <LogoBand />
        <div className="grid place-items-center">
          <p>{error || 'Preparando seu treino...'}</p>
        </div>
      </main>
    );

  if (feedback && workout) {
    return (
      <main className="protocolo-light min-h-dvh bg-background text-foreground">
        <LogoBand />
        <div className="px-4 py-6">
          <section className="mx-auto max-w-xl rounded-3xl bg-card p-6 shadow-sm sm:p-8">
            <p className="text-label font-bold tracking-widest text-muted-foreground uppercase">
              Treino concluído
            </p>
            <h1 className="mt-2 text-h1 font-extrabold text-foreground">Como foi para você?</h1>
            <label className="mt-8 block font-bold">
              Percepção de esforço: <span className="text-h3">{effort}/10</span>
            </label>
            <input
              aria-label="Percepção de esforço"
              type="range"
              min="1"
              max="10"
              value={effort}
              onChange={(event) => setEffort(Number(event.target.value))}
              className="mt-3 w-full accent-verde-pulso"
            />
            <div className="mt-1 flex justify-between text-label text-muted-foreground">
              <span>Muito fácil</span>
              <span>Moderado</span>
              <span>Muito difícil</span>
            </div>
            <label className="mt-7 block font-bold" htmlFor="feeling">
              Como você se sentiu?
            </label>
            <textarea
              id="feeling"
              value={feelingNotes}
              onChange={(event) => setFeelingNotes(event.target.value)}
              maxLength={1000}
              className="mt-2 min-h-28 w-full rounded-xl border border-input p-3"
              placeholder="Conte o que foi leve, difícil ou diferente hoje."
            />
            <p className="mt-7 font-bold">Sentiu dor durante o treino?</p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <button
                type="button"
                aria-pressed={!painReported}
                onClick={() => {
                  setPainReported(false);
                  setPainExerciseIds([]);
                  setPainNotes('');
                }}
                className={`min-h-12 rounded-xl bg-destructive font-bold text-destructive-foreground transition-shadow ${!painReported ? 'ring-2 ring-offset-2 ring-destructive' : ''}`}
              >
                Não
              </button>
              <button
                type="button"
                aria-pressed={painReported}
                onClick={() => setPainReported(true)}
                className={`min-h-12 rounded-xl bg-primary font-bold text-primary-foreground transition-shadow ${painReported ? 'ring-2 ring-offset-2 ring-primary' : ''}`}
              >
                Sim
              </button>
            </div>
            {painReported ? (
              <div className="mt-4 space-y-3 rounded-2xl border-2 border-destructive p-4">
                <p className="font-bold">Isso gera um alerta para o profissional CREF.</p>
                <details className="group rounded-xl border border-input bg-card">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-3">
                    <span className={painExerciseIds.length === 0 ? 'text-muted-foreground' : ''}>
                      {painExerciseIds.length === 0
                        ? 'Selecione os exercícios'
                        : joinNatural(
                            workout.prescription.exercises
                              .filter((exercise) => painExerciseIds.includes(exercise.exerciseId))
                              .map((exercise) => exercise.name),
                          )}
                    </span>
                    <ChevronDown className="shrink-0 transition group-open:rotate-180" size={18} />
                  </summary>
                  <div className="space-y-1 border-t border-input p-2">
                    {workout.prescription.exercises.map((exercise) => {
                      const checked = painExerciseIds.includes(exercise.exerciseId);
                      return (
                        <label
                          key={exercise.exerciseId}
                          className="flex min-h-11 items-center gap-3 rounded-lg px-2"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setPainExerciseIds((current) =>
                                checked
                                  ? current.filter((id) => id !== exercise.exerciseId)
                                  : [...current, exercise.exerciseId],
                              )
                            }
                            className="size-5 accent-destructive"
                          />
                          {exercise.name}
                        </label>
                      );
                    })}
                  </div>
                </details>
                <textarea
                  aria-label="Descrição da dor"
                  value={painNotes}
                  onChange={(event) => setPainNotes(event.target.value)}
                  className="min-h-24 w-full rounded-xl border border-input p-3"
                  placeholder="Conte onde doeu, em qual momento e qual a sensação"
                />
              </div>
            ) : null}
            {error ? (
              <p
                role="alert"
                className="mt-4 rounded-xl border border-destructive bg-destructive/10 p-3 text-label text-petroleo"
              >
                {error}
              </p>
            ) : null}
            <button
              type="button"
              disabled={
                busy ||
                (painReported && (painExerciseIds.length === 0 || painNotes.trim().length < 3))
              }
              onClick={finish}
              className="mt-8 min-h-14 w-full rounded-2xl bg-petroleo font-extrabold text-white transition-colors hover:bg-petroleo/85 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
            >
              {busy ? 'Salvando...' : 'Enviar e finalizar'}
            </button>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="protocolo-light min-h-dvh bg-background pb-28 text-foreground">
      <LogoBand />
      <div className="mx-auto max-w-2xl px-4 pt-6">
        <h1 className="text-h1 font-extrabold text-foreground">
          <span className="font-normal text-muted-foreground">Olá, </span>
          {journal.firstName}
        </h1>
      </div>
      <div className="mx-auto max-w-2xl px-4">
        <section className="mt-4">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Semana anterior"
              disabled={navigationLocked}
              onClick={() => void load(addDays(journal.selectedDate, -7))}
              className="grid size-9 shrink-0 place-items-center text-verde-pulso disabled:text-muted-foreground disabled:opacity-40"
            >
              <ChevronLeft size={22} />
            </button>
            <div className="grid flex-1 grid-cols-7 gap-1" aria-label="Dias da semana">
              {journal.week.map((day) => {
                const selected = day.date === journal.selectedDate;
                const today = day.date === journal.today;
                return (
                  <button
                    key={day.date}
                    type="button"
                    disabled={day.state === 'FUTURE' || navigationLocked}
                    onClick={() => void load(day.date)}
                    aria-label={`${DAY_LABELS[day.weekday]}, ${day.date}`}
                    aria-current={selected ? 'date' : undefined}
                    className="mx-auto flex min-w-9 flex-col items-center gap-1.5 disabled:opacity-35"
                  >
                    <span
                      className={`grid size-9 place-items-center rounded-full text-label font-extrabold ${today ? 'bg-primary text-primary-foreground' : selected ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-muted-foreground'}`}
                    >
                      {Number(day.date.slice(-2))}
                    </span>
                    <span className="text-[0.68rem] font-bold text-muted-foreground uppercase">
                      {DAY_LABELS[day.weekday]}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              aria-label="Proxima semana"
              disabled={addDays(journal.selectedDate, 7) > journal.today || navigationLocked}
              onClick={() => void load(addDays(journal.selectedDate, 7))}
              className="grid size-9 shrink-0 place-items-center text-verde-pulso disabled:text-muted-foreground disabled:opacity-40"
            >
              <ChevronRight size={22} />
            </button>
          </div>
          <p className="mt-3 text-center text-label font-bold text-foreground">
            {selectedDateLabel(journal.selectedDate)}
          </p>
          {weekContext(journal.selectedDate, journal.today) !== 'Semana atual' ? (
            <button
              type="button"
              disabled={navigationLocked}
              onClick={() => void load(journal.today)}
              className="mx-auto mt-3 block rounded-full bg-petroleo px-4 py-2 text-label font-bold text-white disabled:opacity-40"
            >
              Voltar para hoje
            </button>
          ) : null}
        </section>
        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-destructive bg-destructive/10 p-3 text-label text-petroleo"
          >
            {error}
          </p>
        ) : null}
        {!workout ? (
          <section className="mt-5 rounded-3xl bg-card p-8 text-center">
            <p className="text-h2">🌿</p>
            <h2 className="mt-3 text-h3 font-extrabold">Dia de recuperação</h2>
            <p className="mt-2 text-muted-foreground">Não há treino prescrito para este dia.</p>
          </section>
        ) : workout.status === 'COMPLETED' ? (
          <section className="mt-5 rounded-3xl bg-card p-8 text-center">
            <p className="text-h2">✓</p>
            <h2 className="mt-3 text-h2 font-extrabold">Treino concluído</h2>
            <p className="mt-2 text-muted-foreground">
              Tempo total: {formatTimer(workout.durationSeconds ?? 0)} · Esforço{' '}
              {workout.perceivedEffort}/10
            </p>
            {workout.shareCard ? (
              <WorkoutShareCardPanel key={workout.id} data={workout.shareCard} />
            ) : null}
          </section>
        ) : (
          <>
            <section className="mt-5 overflow-hidden rounded-3xl bg-card shadow-sm">
              <div className="flex items-center justify-between bg-petroleo px-4 py-4">
                <h2 className="text-h3 font-bold text-white">{workout.prescription.dayLabel}</h2>
                {workout.status === 'IN_PROGRESS' ? (
                  <div className="flex items-center gap-2 font-mono font-bold text-white">
                    <Clock3 size={18} />
                    {formatTimer(elapsed)}
                  </div>
                ) : journal.selectedDate === journal.today ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={start}
                    className="min-h-12 rounded-xl bg-primary px-5 font-extrabold text-primary-foreground transition-colors hover:bg-primary/85"
                  >
                    Iniciar treino
                  </button>
                ) : (
                  // Achado 2026-09-10 (pedido do fundador): dia passado é só consulta —
                  // protocolo e carga/repetições ficam visíveis, mas nunca dá pra "iniciar"
                  // um treino retroativo (o backend também recusa, ver `journal()`/`start`).
                  <span className="text-label font-semibold text-white/70">Dia encerrado</span>
                )}
              </div>
              <div className="divide-y divide-border">
                {workout.prescription.exercises.map((exercise) => {
                  const exerciseSets = sets.filter(
                    (entry) => entry.exerciseId === exercise.exerciseId,
                  );
                  const exerciseSkipped =
                    exerciseSets.length > 0 && exerciseSets.every((entry) => entry.skipped);
                  const exerciseFilled = isExerciseFilled(exercise, exerciseSets);
                  const exerciseConfirmed = confirmedExercises.has(exercise.exerciseId);
                  return (
                    <details
                      key={exercise.exerciseId}
                      open={openExercises.has(exercise.exerciseId)}
                      onToggle={(event) => {
                        const isOpen = event.currentTarget.open;
                        setOpenExercises((current) => {
                          const next = new Set(current);
                          if (isOpen) next.add(exercise.exerciseId);
                          else next.delete(exercise.exerciseId);
                          return next;
                        });
                      }}
                      className="group px-4 py-4"
                    >
                      <summary className="flex cursor-pointer list-none items-center justify-between">
                        <div>
                          <h3
                            className={`text-h3 font-extrabold ${exerciseConfirmed ? 'text-muted-foreground line-through decoration-2' : ''}`}
                          >
                            {exercise.name}
                          </h3>
                          <p className="mt-1 text-label text-muted-foreground">
                            {exercise.sets} séries ·{' '}
                            {exercise.reps
                              ? `${exercise.reps.min}-${exercise.reps.max} repetições`
                              : formatDurationLabel(exercise.durationSeconds ?? 0)}{' '}
                            · descanso {formatDurationLabel(exercise.restSeconds)}
                          </p>
                        </div>
                        <ChevronDown className="transition group-open:rotate-180" />
                      </summary>
                      {exerciseSkipped ? (
                        <div className="mt-5 rounded-2xl bg-muted p-4 text-label text-muted-foreground">
                          Este exercício foi marcado como pulado e não entrará como realizado.
                        </div>
                      ) : exercise.isCardio ? null : (
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
                            const warmupBlock =
                              entry.setNumber <= 0
                                ? warmupBlockForSet(exercise, entry.setNumber)
                                : undefined;
                            return (
                              <div
                                key={entry.setNumber}
                                className="grid grid-cols-[2rem_1fr_1fr] items-end gap-2"
                              >
                                <span className="pb-3 text-center font-bold">
                                  {entry.setNumber <= 0 ? 'Aq' : entry.setNumber}
                                </span>
                                {exercise.reps ? (
                                  <label className="text-label text-muted-foreground">
                                    {warmupBlock?.reps
                                      ? `Reps ${warmupBlock.reps.min}-${warmupBlock.reps.max}`
                                      : `Reps ${exercise.reps.min}-${exercise.reps.max}`}
                                    <input
                                      inputMode="numeric"
                                      {...numberFieldProps(
                                        `${entry.exerciseId}:${entry.setNumber}:reps`,
                                        entry.reps,
                                        (reps) => updateSet(index, { reps }),
                                      )}
                                      placeholder={
                                        previous?.reps != null
                                          ? `Treino passado: ${previous.reps}`
                                          : '—'
                                      }
                                      className="mt-1 min-h-11 w-full rounded-xl border border-verde-pulso px-3 text-body text-foreground"
                                    />
                                  </label>
                                ) : (
                                  <label className="text-label text-muted-foreground">
                                    {warmupBlock?.durationSeconds != null
                                      ? `Aq · ${formatDurationLabel(warmupBlock.durationSeconds)}`
                                      : 'Tempo'}
                                    <input
                                      inputMode="numeric"
                                      {...numberFieldProps(
                                        `${entry.exerciseId}:${entry.setNumber}:durationSeconds`,
                                        entry.durationSeconds,
                                        (durationSeconds) => updateSet(index, { durationSeconds }),
                                      )}
                                      placeholder={
                                        previous?.durationSeconds != null
                                          ? `Treino passado: ${formatDurationLabel(previous.durationSeconds)}`
                                          : '—'
                                      }
                                      className="mt-1 min-h-11 w-full rounded-xl border border-verde-pulso px-3 text-body text-foreground"
                                    />
                                  </label>
                                )}
                                <label className="text-label text-muted-foreground">
                                  Carga (kg)
                                  <span
                                    className={`ml-1 font-bold ${delta && delta > 0 ? 'text-emerald-700' : 'text-muted-foreground'}`}
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
                                    {...numberFieldProps(
                                      `${entry.exerciseId}:${entry.setNumber}:loadValue`,
                                      entry.loadValue,
                                      (loadValue) => updateSet(index, { loadValue }),
                                    )}
                                    placeholder={
                                      previous?.loadValue != null
                                        ? `Treino passado: ${previous.loadValue}`
                                        : '—'
                                    }
                                    className="mt-1 min-h-11 w-full rounded-xl border border-verde-pulso px-3 text-body text-foreground"
                                  />
                                </label>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {exerciseSkipped ? (
                        <button
                          type="button"
                          onClick={() => void toggleExerciseSkipped(exercise.exerciseId)}
                          aria-pressed={exerciseSkipped}
                          className="mt-4 min-h-11 w-full rounded-xl border border-verde-pulso px-4 text-label font-bold text-petroleo"
                        >
                          Incluir exercício novamente
                        </button>
                      ) : exerciseFilled ? (
                        <button
                          type="button"
                          onClick={() => confirmExerciseDone(exercise.exerciseId)}
                          className="mt-4 min-h-11 w-full rounded-xl bg-petroleo px-4 text-label font-bold text-white"
                        >
                          Concluído
                        </button>
                      ) : exercise.isCardio ? (
                        <div className="mt-4 flex flex-col gap-3">
                          <button
                            type="button"
                            onClick={() => void toggleExerciseSkipped(exercise.exerciseId)}
                            className="min-h-11 w-full rounded-xl border border-verde-pulso px-4 text-label font-bold text-muted-foreground"
                          >
                            Pular este exercício
                          </button>
                          <button
                            type="button"
                            onClick={() => void completeCardioExercise(exercise)}
                            className="min-h-11 w-full rounded-xl bg-petroleo px-4 text-label font-bold text-white"
                          >
                            Concluído
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void toggleExerciseSkipped(exercise.exerciseId)}
                          className="mt-4 min-h-11 w-full rounded-xl border border-verde-pulso px-4 text-label font-bold text-muted-foreground"
                        >
                          Pular este exercício
                        </button>
                      )}
                    </details>
                  );
                })}
              </div>
            </section>
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
                className="mt-6 min-h-14 w-full rounded-2xl bg-petroleo font-extrabold text-white transition-colors hover:bg-petroleo/85"
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
