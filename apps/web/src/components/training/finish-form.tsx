'use client';

import { useState } from 'react';

import type {
  EnduranceMetrics,
  ExecutionView,
  FinishExecutionRequest,
  PainReport,
  TrainingDaySession,
} from '@movivo/shared';

import { CHOICE_CLASS, choiceState } from './check-in-fields';
import { paceLabel } from './format';
import { INPUT_CLASS, NEUTRAL_INPUT_CLASS, strengthProgress } from './strength-session';
import { StudentAlert } from './student-nav';
import { useTrainingApi } from './training-api-context';

/** Campo de seleção no padrão do check-in (mesma altura e borda dos campos de número). */
const SELECT_CLASS =
  'mt-1 min-h-12 w-full rounded-xl border border-input bg-card px-3 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const REGIONS = [
  'ombro',
  'joelho',
  'lombar',
  'quadril',
  'tornozelo',
  'punho',
  'cotovelo',
  'pescoço',
  'outra',
];

const CHARACTERS: ReadonlyArray<{ value: NonNullable<PainReport['character']>; label: string }> = [
  { value: 'MUSCLE', label: 'Muscular (cansaço do treino)' },
  { value: 'JOINT', label: 'Na articulação' },
  { value: 'SHARP', label: 'Pontada' },
  { value: 'BURNING', label: 'Queimação' },
  { value: 'OTHER', label: 'Outra' },
];

type Outcome = FinishExecutionRequest['status'];

const OUTCOMES: ReadonlyArray<{ value: Outcome; label: string }> = [
  { value: 'COMPLETED', label: 'Fiz tudo' },
  { value: 'PARTIAL', label: 'Fiz uma parte' },
  { value: 'ABANDONED', label: 'Não consegui' },
];

/** "28:14", "1:05:30" ou "01:05:30" → segundos; `null` se o formato não for reconhecido. */
export function parseClock(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const numbers = parts.map((part) => (/^\d{1,2}$/.test(part) ? Number(part) : NaN));
  if (numbers.some((n) => !Number.isFinite(n))) return null;
  if (numbers.slice(1).some((n) => n >= 60)) return null;
  return numbers.reduce((total, n) => total * 60 + n, 0);
}

/** 2_745 → "00:45:45" (o formato do campo de tempo total). */
function clockText(seconds: number | undefined): string {
  if (seconds === undefined) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const total = Math.round(seconds);
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/** Minutos desde o "Iniciar" (o cronômetro do treino), nunca menos de 1. */
export function elapsedMinutes(
  startedAt: string | null | undefined,
  now = Date.now(),
): number | null {
  if (!startedAt) return null;
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return null;
  return Math.max(1, Math.round((now - started) / 60_000));
}

interface Numbers {
  clock: string;
  distanceKm: string;
  pace: string;
  avgHeartRate: string;
  maxHeartRate: string;
}

function numbersFrom(metrics: EnduranceMetrics | null): Numbers {
  return {
    clock: clockText(metrics?.movingSeconds ?? metrics?.elapsedSeconds),
    distanceKm:
      metrics?.distanceMeters !== undefined
        ? (metrics.distanceMeters / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })
        : '',
    pace: metrics?.avgPaceSecondsPerKm ? paceLabel(metrics.avgPaceSecondsPerKm) : '',
    avgHeartRate: metrics?.avgHeartRate?.toString() ?? '',
    maxHeartRate: metrics?.maxHeartRate?.toString() ?? '',
  };
}

/**
 * Lê os números digitados. Devolve as métricas (mantendo o que veio do arquivo e não aparece
 * aqui, como parciais e estações) ou a mensagem do primeiro campo inválido.
 */
export function metricsFrom(
  numbers: Numbers,
  base: EnduranceMetrics | null,
): { metrics: EnduranceMetrics | null } | { error: string } {
  const blank = (value: string) => value.trim() === '';
  if (Object.values(numbers).every(blank)) return { metrics: null };
  const seconds = blank(numbers.clock) ? null : parseClock(numbers.clock);
  if (!blank(numbers.clock) && (seconds === null || seconds <= 0)) {
    return { error: 'Informe o tempo total como 00:45:00 (horas:minutos:segundos).' };
  }
  const km = blank(numbers.distanceKm) ? null : Number(numbers.distanceKm.replace(',', '.'));
  if (km !== null && (!Number.isFinite(km) || km <= 0 || km > 300)) {
    return { error: 'Informe a distância em km, por exemplo 5,2.' };
  }
  const typedPace = blank(numbers.pace) ? null : parseClock(numbers.pace);
  if (!blank(numbers.pace) && (typedPace === null || typedPace < 100 || typedPace > 1_800)) {
    return { error: 'Informe o ritmo médio por km como 5:30 (minutos:segundos).' };
  }
  const heart = (value: string, label: string) => {
    if (blank(value)) return { value: null };
    const n = Number(value);
    return Number.isInteger(n) && n >= 30 && n <= 240
      ? { value: n }
      : { error: `Informe a ${label} em batimentos por minuto (entre 30 e 240).` };
  };
  const avg = heart(numbers.avgHeartRate, 'FC média');
  if ('error' in avg) return { error: avg.error as string };
  const max = heart(numbers.maxHeartRate, 'FC máxima');
  if ('error' in max) return { error: max.error as string };
  if (avg.value !== null && max.value !== null && avg.value > max.value) {
    return { error: 'A FC média não pode ser maior que a FC máxima.' };
  }
  // Sem ritmo digitado, ele sai da distância e do tempo.
  const pace = typedPace ?? (seconds !== null && km !== null ? Math.round(seconds / km) : null);
  return {
    metrics: {
      ...base,
      ...(seconds !== null ? { movingSeconds: seconds } : {}),
      ...(km !== null ? { distanceMeters: Math.round(km * 1000) } : {}),
      ...(pace !== null && pace >= 100 && pace <= 1_800 ? { avgPaceSecondsPerKm: pace } : {}),
      ...(avg.value !== null ? { avgHeartRate: avg.value } : {}),
      ...(max.value !== null ? { maxHeartRate: max.value } : {}),
    },
  };
}

/**
 * Questionário pós-treino, uma tela só: como foi o treino, os números (corrida e HYROX), o esforço
 * percebido (PSE), o que o aluno sentiu, em texto, e se sentiu dor. "Enviar e finalizar" fecha o
 * treino e leva à tela de conclusão com o cartão para o Story.
 */
export function FinishForm({
  session,
  execution,
  onBack,
  onFinished,
}: {
  session: TrainingDaySession;
  execution: ExecutionView;
  onBack: () => void;
  onFinished: (view: ExecutionView) => void;
}) {
  const api = useTrainingApi();
  const content = session.content;
  const endurance = content.modality === 'RUNNING' || content.modality === 'HYROX';
  const progress =
    content.modality === 'STRENGTH' ? strengthProgress(content.exercises, execution.sets) : null;
  const [outcome, setOutcome] = useState<Outcome>(
    progress && progress.done < progress.total ? 'PARTIAL' : 'COMPLETED',
  );
  const [numbers, setNumbers] = useState<Numbers>(() => numbersFrom(execution.metrics));
  const [minutes, setMinutes] = useState(
    String(elapsedMinutes(execution.startedAt) ?? session.estimatedMinutes),
  );
  const [effort, setEffort] = useState(5);
  const [feedback, setFeedback] = useState('');
  const [hadPain, setHadPain] = useState(false);
  const [region, setRegion] = useState(REGIONS[0] ?? 'outra');
  const [intensity, setIntensity] = useState(3);
  const [character, setCharacter] = useState<PainReport['character']>('MUSCLE');
  const [limits, setLimits] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const abandoned = outcome === 'ABANDONED';
  const setNumber = (key: keyof Numbers) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setNumbers((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    let durationMinutes: number | null = null;
    let metrics: EnduranceMetrics | null = null;
    if (!abandoned) {
      if (endurance) {
        const read = metricsFrom(numbers, execution.metrics);
        if ('error' in read) return setError(read.error);
        metrics = read.metrics;
      }
      if (content.modality === 'EXTERNAL_SPORT') {
        const typed = Number(minutes);
        if (!Number.isInteger(typed) || typed < 1 || typed > 600) {
          return setError('Informe quantos minutos durou, em número inteiro.');
        }
        durationMinutes = typed;
      } else if (metrics?.movingSeconds) {
        durationMinutes = Math.max(1, Math.round(metrics.movingSeconds / 60));
      } else {
        durationMinutes = elapsedMinutes(execution.startedAt) ?? session.estimatedMinutes;
      }
    }
    setBusy(true);
    try {
      // Os números digitados (ou conferidos) valem como confirmados pelo aluno.
      if (metrics) await api.saveMetrics(execution.id, { metrics, confirmed: true });
      const view = await api.finishExecution(execution.id, {
        status: outcome,
        rpe: abandoned ? null : effort,
        durationMinutes: Math.min(600, durationMinutes ?? 0) || null,
        enjoyment: null,
        painReports: hadPain
          ? [{ region, intensity, during: 'DURING', character, limitsMovement: limits }]
          : [],
        ...(feedback.trim() ? { feedback: feedback.trim() } : {}),
      });
      onFinished(view);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível registrar agora.');
      setBusy(false);
    }
  }

  const derivedPace = (() => {
    if (numbers.pace.trim()) return null;
    const read = metricsFrom({ ...numbers, avgHeartRate: '', maxHeartRate: '' }, null);
    return 'metrics' in read && read.metrics?.avgPaceSecondsPerKm
      ? paceLabel(read.metrics.avgPaceSecondsPerKm)
      : null;
  })();

  return (
    <form onSubmit={submit} className="rounded-3xl bg-card p-6 shadow-sm sm:p-8">
      <p className="text-label font-bold tracking-widest text-muted-foreground uppercase">
        Treino concluído
      </p>
      <h1 className="mt-2 text-h1 font-extrabold text-foreground">Como foi para você?</h1>
      <p className="mt-1 text-label text-muted-foreground">{session.title}</p>

      <fieldset className="mt-7">
        <legend className="font-bold text-foreground">Você fez o treino?</legend>
        <div
          className="mt-2 grid grid-cols-3 gap-2"
          role="radiogroup"
          aria-label="Você fez o treino?"
        >
          {OUTCOMES.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={outcome === option.value}
              onClick={() => setOutcome(option.value)}
              className={`${CHOICE_CLASS} px-1 leading-tight ${choiceState(outcome === option.value)}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      {!abandoned && endurance ? (
        <fieldset className="mt-7">
          <legend className="font-bold text-foreground">Seus números</legend>
          <p className="mt-0.5 text-label text-muted-foreground">
            {execution.metrics
              ? 'Lidos do relógio: confira e corrija se precisar.'
              : 'Do relógio ou do app. Preencha o que tiver.'}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-label text-muted-foreground">
              Tempo total
              <input
                inputMode="numeric"
                placeholder="00:45:00"
                value={numbers.clock}
                onChange={setNumber('clock')}
                className={INPUT_CLASS}
              />
            </label>
            <label className="text-label text-muted-foreground">
              Distância (km)
              <input
                inputMode="decimal"
                placeholder="7,5"
                value={numbers.distanceKm}
                onChange={setNumber('distanceKm')}
                className={INPUT_CLASS}
              />
            </label>
            <label className="col-span-2 text-label text-muted-foreground">
              Ritmo médio (min/km)
              <input
                inputMode="numeric"
                placeholder={derivedPace ?? '5:30'}
                value={numbers.pace}
                onChange={setNumber('pace')}
                className={INPUT_CLASS}
              />
              {derivedPace ? (
                <span className="mt-1 block text-label">
                  Pela distância e o tempo: {derivedPace} /km.
                </span>
              ) : null}
            </label>
            <label className="text-label text-muted-foreground">
              FC média (bpm)
              <input
                inputMode="numeric"
                placeholder="—"
                value={numbers.avgHeartRate}
                onChange={setNumber('avgHeartRate')}
                className={INPUT_CLASS}
              />
            </label>
            <label className="text-label text-muted-foreground">
              FC máxima (bpm)
              <input
                inputMode="numeric"
                placeholder="—"
                value={numbers.maxHeartRate}
                onChange={setNumber('maxHeartRate')}
                className={INPUT_CLASS}
              />
            </label>
          </div>
        </fieldset>
      ) : null}

      {!abandoned && content.modality === 'EXTERNAL_SPORT' ? (
        <label className="mt-7 block font-bold text-foreground">
          Quantos minutos durou?
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={600}
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
            className={`${INPUT_CLASS} max-w-40 font-normal`}
          />
        </label>
      ) : null}

      {!abandoned ? (
        <>
          <label className="mt-8 block font-bold text-foreground" htmlFor="effort">
            Percepção de esforço: <span className="text-h3">{effort}/10</span>
          </label>
          <input
            id="effort"
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
        </>
      ) : null}

      <label className="mt-7 block font-bold text-foreground" htmlFor="feeling">
        Como você se sentiu?
      </label>
      <textarea
        id="feeling"
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
        maxLength={1000}
        className="mt-2 min-h-28 w-full rounded-xl border border-input bg-card p-3 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        placeholder={
          abandoned
            ? 'Conte o que aconteceu, para ajustarmos a semana.'
            : 'Conte o que foi leve, difícil ou diferente hoje.'
        }
      />

      <p className="mt-7 font-bold text-foreground">Sentiu dor durante o treino?</p>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <button
          type="button"
          aria-pressed={!hadPain}
          onClick={() => setHadPain(false)}
          className={`min-h-12 rounded-xl bg-destructive font-bold text-destructive-foreground transition-shadow ${!hadPain ? 'ring-2 ring-destructive ring-offset-2' : ''}`}
        >
          Não
        </button>
        <button
          type="button"
          aria-pressed={hadPain}
          onClick={() => setHadPain(true)}
          className={`min-h-12 rounded-xl bg-primary font-bold text-primary-foreground transition-shadow ${hadPain ? 'ring-2 ring-primary ring-offset-2' : ''}`}
        >
          Sim
        </button>
      </div>
      {hadPain ? (
        <div className="mt-4 space-y-4 rounded-2xl border-2 border-destructive p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-label text-muted-foreground">
              Onde
              <select
                value={region}
                onChange={(event) => setRegion(event.target.value)}
                className={SELECT_CLASS}
              >
                {REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-label text-muted-foreground">
              Intensidade (0–10)
              <input
                type="number"
                min={0}
                max={10}
                value={intensity}
                onChange={(event) => setIntensity(Number(event.target.value))}
                className={NEUTRAL_INPUT_CLASS}
              />
            </label>
          </div>
          <label className="block text-label text-muted-foreground">
            Como é a dor
            <select
              value={character}
              onChange={(event) => setCharacter(event.target.value as PainReport['character'])}
              className={SELECT_CLASS}
            >
              {CHARACTERS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 font-bold text-foreground">
            <input
              type="checkbox"
              checked={limits}
              onChange={(event) => setLimits(event.target.checked)}
              className="size-5 accent-destructive"
            />
            Atrapalha o movimento
          </label>
          <p className="text-label text-muted-foreground">
            Depois de enviar, a gente te responde no WhatsApp com a orientação e o que muda nos
            próximos treinos.
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="mt-4">
          <StudentAlert>{error}</StudentAlert>
        </div>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="mt-8 min-h-14 w-full rounded-2xl bg-petroleo font-extrabold text-white transition-colors hover:bg-petroleo/85 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
      >
        {busy ? 'Salvando...' : 'Enviar e finalizar'}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onBack}
        className="mt-3 min-h-12 w-full rounded-2xl text-label font-bold text-muted-foreground transition-colors hover:bg-muted"
      >
        Voltar ao treino
      </button>
    </form>
  );
}
