'use client';

import {
  HYROX_STATION_LABELS,
  MEASUREMENT_LABELS,
  MEASUREMENT_UNITS,
  type MeasurementKind,
  type PredictionConfidence,
  type StreakDayState,
  type StudentPredictions,
  type StudentProgress,
} from '@movivo/shared';
import {
  Activity,
  CalendarDays,
  Check,
  ChevronDown,
  Dumbbell,
  Footprints,
  Gauge,
  Moon,
  Ruler,
  Timer,
  Trophy,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { StudentAlert, StudentGreeting, StudentShell } from '@/components/training/student-nav';
import { useTrainingApi } from '@/components/training/training-api-context';
import { Button } from '@/components/ui/button';
import type { EvolutionView as Evolution } from '@/lib/checkin-api';
import { TrainingApiError } from '@/lib/training-api';

const FORMAT = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'UTC',
});
const shortDate = (iso: string) => FORMAT.format(new Date(`${iso}T00:00:00Z`));
const number = (n: number, digits = 1) =>
  n.toLocaleString('pt-BR', { maximumFractionDigits: digits });

/** 330 → "5:30"; 3_909 → "1:05:09". */
function clock(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** "+10 kg", "−35 s": a diferença com sinal (o "melhor" decide a cor). */
function Delta({ value, unit, better }: { value: number; unit: string; better: 'up' | 'down' }) {
  if (Math.abs(value) < 0.05) return <span className="text-muted-foreground">mantido</span>;
  const good = better === 'up' ? value > 0 : value < 0;
  return (
    <span className={`font-bold ${good ? 'text-emerald-700' : 'text-destructive'}`}>
      {value > 0 ? '+' : '−'}
      {number(Math.abs(value))} {unit}
    </span>
  );
}

const MEASURE_KINDS: MeasurementKind[] = ['WEIGHT', 'WAIST', 'HIP', 'ARM', 'THIGH'];

/**
 * Linha de tendência pequena, com o último ponto em destaque. A linha estica com a largura; o
 * ponto é um elemento à parte, para continuar redondo em qualquer tela.
 */
function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const height = 32;
  const points = values.map((v, i) => [
    (i / (values.length - 1)) * 100,
    height - 4 - ((v - min) / span) * (height - 8),
  ]);
  const last = points[points.length - 1] ?? [0, 0];
  return (
    <div role="img" aria-label={label} className="relative h-10 w-full">
      <svg
        aria-hidden="true"
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full overflow-visible"
      >
        <polyline
          points={points.map(([x, y]) => `${x},${y}`).join(' ')}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className="text-verde-pulso"
        />
      </svg>
      <span
        aria-hidden="true"
        className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-petroleo ring-2 ring-card"
        style={{ left: `${last[0]}%`, top: `${((last[1] ?? 0) / height) * 100}%` }}
      />
    </div>
  );
}

function Card({
  label,
  title,
  icon,
  children,
}: {
  label: string;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-4 rounded-3xl bg-card p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-h3 font-extrabold text-foreground">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Número de destaque em bloco: todos do mesmo tamanho, centralizados e sem quebrar a linha. */
function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex min-w-0 flex-col items-center justify-center rounded-2xl bg-muted px-2 py-3 text-center">
      <p className="w-full truncate text-[0.7rem] font-bold tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-lg font-extrabold whitespace-nowrap text-foreground tabular-nums sm:text-h3">
        {value}
        {unit ? (
          <span className="ml-0.5 text-label font-bold text-muted-foreground">{unit}</span>
        ) : null}
      </p>
    </div>
  );
}

const STREAK_DAY: Record<
  StreakDayState,
  { label: string; className: string; icon: ReactNode | null }
> = {
  DONE: {
    label: 'treinou',
    className: 'bg-verde-pulso text-petroleo',
    icon: <Check size={14} strokeWidth={3} aria-hidden="true" />,
  },
  REST: {
    label: 'descanso',
    className: 'bg-white/10 text-white/60',
    icon: <Moon size={12} aria-hidden="true" />,
  },
  MISSED: {
    label: 'treino não feito',
    className: 'border border-destructive/80 text-destructive',
    icon: <X size={12} aria-hidden="true" />,
  },
  PENDING: {
    label: 'hoje, em aberto',
    className: 'border-2 border-dashed border-verde-pulso text-verde-pulso',
    icon: null,
  },
  FUTURE: { label: 'ainda não chegou', className: 'bg-white/5 text-white/25', icon: null },
};

const WEEKDAYS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];

/** Constância: dias ativos seguidos; o descanso do plano não quebra a sequência. */
function StreakCard({ streak }: { streak: StudentProgress['streak'] }) {
  const today = streak.days.find((d) => d.state === 'PENDING' || d.state === 'FUTURE');
  const restToday =
    !streak.activeToday && streak.days.filter((d) => d.state !== 'FUTURE').at(-1)?.state === 'REST';
  const message = streak.activeToday
    ? 'Constância de hoje garantida. Bora manter!'
    : restToday
      ? 'Hoje é dia de descanso: sua constância está protegida.'
      : today?.state === 'PENDING'
        ? 'Treine hoje para a sua constância seguir crescendo.'
        : 'Cada treino feito acende um dia.';
  return (
    <section
      aria-label="Constância"
      className="overflow-hidden rounded-3xl bg-petroleo text-white shadow-sm"
    >
      <div className="flex items-center gap-4 px-5 pt-5">
        <div className="grid size-16 shrink-0 place-items-center rounded-2xl bg-verde-pulso/15 text-verde-pulso">
          <Activity size={36} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-label font-bold tracking-widest text-verde-pulso uppercase">
            Constância
          </p>
          <p className="text-[2.5rem] leading-none font-extrabold tabular-nums">
            {streak.current}{' '}
            <span className="font-sans text-body font-normal text-white/70">
              {streak.current === 1 ? 'dia ativo' : 'dias ativos'}
            </span>
          </p>
          <p className="mt-1 text-label text-white/70">Recorde: {streak.best} dias</p>
        </div>
      </div>
      <p className="px-5 pt-4 text-label font-bold">{message}</p>
      <div className="px-5 pt-4 pb-5">
        <div className="mx-auto w-full max-w-[22rem]">
          <div className="grid grid-cols-7 gap-1.5 text-center" aria-hidden="true">
            {WEEKDAYS.map((d, i) => (
              <span key={i} className="text-[0.68rem] font-bold text-white/50">
                {d}
              </span>
            ))}
          </div>
          <ol aria-label="Dias das últimas 4 semanas" className="mt-1.5 grid grid-cols-7 gap-1.5">
            {streak.days.map((day) => {
              const style = STREAK_DAY[day.state];
              return (
                <li
                  key={day.date}
                  title={`${shortDate(day.date)}: ${style.label}`}
                  aria-label={`${shortDate(day.date)}: ${style.label}`}
                  className={`grid aspect-square place-items-center rounded-full ${style.className}`}
                >
                  {style.icon}
                </li>
              );
            })}
          </ol>
        </div>
        <p className="mt-4 text-label text-white/70">
          Dias de descanso do seu plano não quebram a sua constância. Só um treino previsto e não
          feito zera a contagem.
        </p>
      </div>
    </section>
  );
}

function StrengthCard({ strength }: { strength: StudentProgress['strength'] }) {
  return (
    <Card
      label="Força"
      title="Força"
      icon={<Dumbbell size={20} className="text-verde-pulso" aria-hidden="true" />}
    >
      <p className="-mt-2 text-label text-muted-foreground">
        A série mais pesada de cada treino e o 1RM estimado (a carga que você levantaria uma vez).
      </p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {strength.map((exercise) => {
          const first = exercise.points[0];
          const last = exercise.points[exercise.points.length - 1];
          const e1rm = exercise.points.map((p) => p.e1rmKg).filter((v): v is number => v !== null);
          return (
            <li
              key={exercise.exerciseId}
              className="flex flex-col gap-1.5 rounded-2xl border border-border p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="min-w-0 font-extrabold text-foreground">{exercise.name}</h3>
                <span className="shrink-0 text-label text-muted-foreground">
                  {exercise.sessions} treinos
                </span>
              </div>
              {first?.topLoadKg && last?.topLoadKg ? (
                <p className="text-label text-foreground">
                  Carga: {number(first.topLoadKg)} → <strong>{number(last.topLoadKg)} kg</strong>
                  {last.reps ? ` × ${last.reps}` : ''} (
                  <Delta value={last.topLoadKg - first.topLoadKg} unit="kg" better="up" />)
                </p>
              ) : null}
              {e1rm.length > 1 ? (
                <p className="text-label text-muted-foreground">
                  1RM estimado: {number(e1rm[0] ?? 0)} → {number(e1rm[e1rm.length - 1] ?? 0)} kg
                </p>
              ) : null}
              <Sparkline
                values={e1rm.length > 1 ? e1rm : exercise.points.map((p) => p.topLoadKg ?? 0)}
                label={`Evolução de ${exercise.name}`}
              />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function RunningCard({ running }: { running: NonNullable<StudentProgress['running']> }) {
  const paces = running.points
    .map((p) => p.paceSecondsPerKm)
    .filter((v): v is number => v !== null);
  const hrs = running.points.map((p) => p.avgHeartRate).filter((v): v is number => v !== null);
  const maxKm = Math.max(1, ...running.weeks.map((w) => w.km));
  return (
    <Card
      label="Corrida"
      title="Corrida"
      icon={<Footprints size={20} className="text-verde-pulso" aria-hidden="true" />}
    >
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Total" value={number(running.totalKm)} unit="km" />
        <Stat label="Mais longa" value={number(running.longestKm)} unit="km" />
        <Stat
          label="Ritmo"
          value={running.bestPaceSecondsPerKm ? clock(running.bestPaceSecondsPerKm) : '—'}
          unit={running.bestPaceSecondsPerKm ? '/km' : undefined}
        />
      </div>
      {paces.length > 1 ? (
        <div>
          <p className="text-label text-foreground">
            Ritmo médio: {clock(paces[0] ?? 0)} →{' '}
            <strong>{clock(paces[paces.length - 1] ?? 0)} /km</strong> (
            <Delta
              value={(paces[paces.length - 1] ?? 0) - (paces[0] ?? 0)}
              unit="s/km"
              better="down"
            />
            )
          </p>
          {/* Ritmo menor é melhor: a linha sobe quando você fica mais rápido. */}
          <Sparkline values={paces.map((p) => -p)} label="Evolução do ritmo médio" />
        </div>
      ) : null}
      {hrs.length > 1 ? (
        <p className="text-label text-muted-foreground">
          FC média nas corridas: {hrs[0]} → {hrs[hrs.length - 1]} bpm. Correr no mesmo ritmo com o
          coração mais calmo é sinal de resistência.
        </p>
      ) : null}
      <div>
        <p className="mb-2 text-label font-bold text-foreground">Quilômetros por semana</p>
        <ul aria-label="Quilômetros por semana" className="flex h-24 items-end gap-1.5">
          {running.weeks.map((w, i) => (
            <li
              key={w.weekStart}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
            >
              <span className="text-[0.68rem] font-bold text-foreground tabular-nums">
                {w.km > 0 ? number(w.km, 0) : ''}
              </span>
              <div
                className={`w-full rounded-t-md ${i === running.weeks.length - 1 ? 'bg-verde-pulso' : 'bg-petroleo/70'}`}
                style={{ height: `${Math.max(3, (w.km / maxKm) * 64)}px` }}
              />
              <span className="text-[0.62rem] text-muted-foreground tabular-nums">
                {shortDate(w.weekStart)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function HyroxCard({ hyrox }: { hyrox: NonNullable<StudentProgress['hyrox']> }) {
  const totals = hyrox.points.map((p) => p.totalSeconds).filter((v): v is number => v !== null);
  return (
    <Card
      label="HYROX"
      title="HYROX"
      icon={<Timer size={20} className="text-verde-pulso" aria-hidden="true" />}
    >
      {totals.length > 1 ? (
        <div>
          <p className="text-label text-foreground">
            Tempo total: {clock(totals[0] ?? 0)} →{' '}
            <strong>{clock(totals[totals.length - 1] ?? 0)}</strong> (
            <Delta
              value={((totals[totals.length - 1] ?? 0) - (totals[0] ?? 0)) / 60}
              unit="min"
              better="down"
            />
            )
          </p>
          <Sparkline values={totals.map((t) => -t)} label="Evolução do tempo total no HYROX" />
        </div>
      ) : (
        <p className="text-label text-muted-foreground">{hyrox.sessions} sessão registrada.</p>
      )}
      {hyrox.stations.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border">
          {hyrox.stations.map((s) => (
            <li key={s.station} className="flex items-baseline justify-between gap-3 py-2">
              <span className="font-bold text-foreground">{HYROX_STATION_LABELS[s.station]}</span>
              <span className="text-label text-muted-foreground tabular-nums">
                {clock(s.firstSeconds)} →{' '}
                <strong className="text-foreground">{clock(s.bestSeconds)}</strong> (
                <Delta value={s.bestSeconds - s.firstSeconds} unit="s" better="down" />)
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

const RACE_LABELS: Record<StudentPredictions['running'][number]['race'], string> = {
  '5K': '5 km',
  '10K': '10 km',
  HALF: 'Meia (21 km)',
  MARATHON: 'Maratona (42 km)',
};

const CONFIDENCE: Record<PredictionConfidence, { label: string; className: string }> = {
  HIGH: { label: 'confiável', className: 'bg-primary/15 text-petroleo' },
  MEDIUM: { label: 'aproximada', className: 'bg-muted text-foreground' },
  LOW: { label: 'só um norte', className: 'bg-destructive/10 text-destructive' },
};

function ConfidenceChip({ value }: { value: PredictionConfidence }) {
  const chip = CONFIDENCE[value];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[0.7rem] font-bold ${chip.className}`}>
      {chip.label}
    </span>
  );
}

/**
 * Previsões de prova a partir dos treinos: corrida pela fórmula de Riegel (o melhor desempenho
 * recente de 3 km para cima) e HYROX somando corrida cansada, estações e trocas.
 */
function PredictionsCard({ predictions }: { predictions: StudentPredictions }) {
  const { basedOn, hyrox } = predictions;
  return (
    <Card
      label="Previsões"
      title="Previsões de prova"
      icon={<Gauge size={20} className="text-verde-pulso" aria-hidden="true" />}
    >
      {basedOn ? (
        <p className="-mt-2 text-label text-muted-foreground">
          Estimativa pelo seu melhor treino recente: {number(basedOn.distanceKm, 2)} km em{' '}
          {clock(basedOn.seconds)} ({shortDate(basedOn.date)}).
        </p>
      ) : null}
      <ul className="grid grid-cols-2 gap-3">
        {predictions.running.map((race) => (
          <li
            key={race.race}
            className="flex min-w-0 flex-col items-center gap-1 rounded-2xl bg-muted px-2 py-3 text-center"
          >
            <span className="text-[0.7rem] font-bold tracking-wide text-muted-foreground uppercase">
              {RACE_LABELS[race.race]}
            </span>
            <span className="text-xl font-extrabold whitespace-nowrap text-petroleo tabular-nums sm:text-h3">
              {clock(race.seconds)}
            </span>
            <span className="text-label text-muted-foreground tabular-nums">
              {clock(race.paceSecondsPerKm)} /km
            </span>
            <ConfidenceChip value={race.confidence} />
          </li>
        ))}
        {hyrox ? (
          <li className="col-span-2 flex flex-col items-center gap-1 rounded-2xl bg-muted px-4 py-3 text-center">
            <span className="text-[0.7rem] font-bold tracking-wide text-muted-foreground uppercase">
              Prova HYROX (Open)
            </span>
            <span className="text-xl font-extrabold whitespace-nowrap text-petroleo tabular-nums sm:text-h3">
              {clock(hyrox.seconds)}
            </span>
            <span className="text-label text-muted-foreground tabular-nums">
              Corrida 8 km {clock(hyrox.runSeconds)} · estações {clock(hyrox.stationsSeconds)} ·
              trocas {clock(hyrox.roxzoneSeconds)}
            </span>
            <ConfidenceChip value={hyrox.confidence} />
            <span className="mt-1 text-label text-muted-foreground">
              {hyrox.measuredStations} de 8 estações medidas nos seus treinos; as outras usam um
              tempo de referência.
            </span>
          </li>
        ) : null}
      </ul>
      <p className="text-label text-muted-foreground">
        É uma estimativa, não uma promessa: treinos leves deixam o número mais conservador e provas
        longas pedem treinos longos. Quanto mais você registra, mais certeira ela fica.
      </p>
    </Card>
  );
}

/** Metas, constância, últimas semanas, progressão nos treinos, recordes e medidas do corpo. */
export function EvolutionView() {
  const api = useTrainingApi();
  const [data, setData] = useState<Evolution | null>(null);
  const [error, setError] = useState('');
  const [kind, setKind] = useState<MeasurementKind>('WAIST');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.getEvolution());
      setError('');
    } catch (caught) {
      setError(
        caught instanceof TrainingApiError && caught.status === 401
          ? 'Abra o link mais recente enviado no seu WhatsApp.'
          : 'Não foi possível carregar sua evolução agora.',
      );
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const parsed = Number(value.replace(',', '.'));
    if (!Number.isFinite(parsed)) return;
    setBusy(true);
    try {
      await api.addMeasurements([
        {
          kind,
          value: parsed,
          method: kind === 'WEIGHT' ? 'SCALE' : 'SELF_TAPE',
          measuredOn: new Date().toISOString().slice(0, 10),
        },
      ]);
      setValue('');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <StudentShell current="/evolucao">
        <StudentAlert>{error}</StudentAlert>
      </StudentShell>
    );
  }
  if (!data) {
    return (
      <StudentShell current="/evolucao" busy>
        <p className="py-10 text-center text-muted-foreground">Carregando sua evolução…</p>
      </StudentShell>
    );
  }

  const progress = data.progress;
  const maxSessions = Math.max(1, ...data.weeks.map((w) => w.sessions));
  const totalSessions = data.weeks.reduce((sum, w) => sum + w.sessions, 0);
  const consistency = progress?.consistency;
  return (
    <StudentShell current="/evolucao">
      <StudentGreeting firstName={data.firstName} title="sua evolução">
        A régua é você: o quanto avançou desde o seu ponto de partida.
      </StudentGreeting>

      {progress ? <StreakCard streak={progress.streak} /> : null}

      <Card
        label="Últimas 4 semanas"
        title="Últimas 4 semanas"
        icon={<CalendarDays size={20} className="text-verde-pulso" aria-hidden="true" />}
      >
        {consistency ? (
          <div className="grid grid-cols-3 gap-2">
            <Stat
              label="Do plano"
              value={consistency.adherencePct === null ? '—' : String(consistency.adherencePct)}
              unit={consistency.adherencePct === null ? undefined : '%'}
            />
            <Stat label="Treinos" value={String(consistency.sessions28d)} />
            <Stat
              label="Tempo"
              value={`${Math.floor(consistency.minutes28d / 60)}h${String(consistency.minutes28d % 60).padStart(2, '0')}`}
            />
          </div>
        ) : null}
        <div aria-label="Treinos por semana" role="region" className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-label font-bold text-foreground">Treinos por semana</p>
            <span className="text-label text-muted-foreground">{totalSessions} no total</span>
          </div>
          <ul className="flex h-28 items-end gap-1.5" aria-label="Treinos concluídos por semana">
            {data.weeks.map((w, index) => (
              <li
                key={w.weekStart}
                className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
              >
                <span className="text-[0.68rem] font-bold text-foreground tabular-nums">
                  {w.sessions}
                </span>
                <div
                  className={`w-full rounded-t-lg ${index === data.weeks.length - 1 ? 'bg-verde-pulso' : 'bg-petroleo/70'}`}
                  style={{ height: `${Math.max(4, (w.sessions / maxSessions) * 72)}px` }}
                  role="img"
                  aria-label={`${w.sessions} treino(s) na semana de ${shortDate(w.weekStart)}`}
                />
                <span className="text-[0.62rem] font-bold text-muted-foreground tabular-nums">
                  {shortDate(w.weekStart)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {progress && progress.records.length > 0 ? (
        <Card
          label="Recordes"
          title="Seus recordes"
          icon={<Trophy size={20} className="text-verde-pulso" aria-hidden="true" />}
        >
          <ul className="grid gap-x-6 sm:grid-cols-2">
            {progress.records.map((record) => (
              <li
                key={record.label}
                className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-b-0 sm:[&:nth-last-child(2):nth-child(odd)]:border-b-0"
              >
                <span className="min-w-0">
                  <span className="block font-bold text-foreground">{record.label}</span>
                  <span className="text-label text-muted-foreground">
                    {record.date ? `em ${shortDate(record.date)}` : ''}
                  </span>
                </span>
                <span className="shrink-0 font-extrabold whitespace-nowrap text-petroleo tabular-nums">
                  {record.value}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {progress?.predictions && progress.predictions.running.length > 0 ? (
        <PredictionsCard predictions={progress.predictions} />
      ) : null}

      {progress && progress.strength.length > 0 ? (
        <StrengthCard strength={progress.strength} />
      ) : null}
      {progress?.running ? <RunningCard running={progress.running} /> : null}
      {progress?.hyrox ? <HyroxCard hyrox={progress.hyrox} /> : null}

      <section aria-label="Estratégia" className="overflow-hidden rounded-3xl bg-card shadow-sm">
        <div className="bg-petroleo px-5 py-5 text-white">
          <p className="text-label font-bold tracking-widest text-verde-pulso uppercase">
            Sua estratégia
          </p>
          <p className="mt-2 text-h3 font-extrabold">
            {data.strategyTitle ?? 'Estamos montando a sua estratégia.'}
          </p>
        </div>
        {data.milestones.length > 0 || data.tasks.length > 0 ? (
          <ul aria-label="Metas" className="flex flex-col divide-y divide-border">
            {data.tasks.map((t) => {
              const done = t.target > 0 && t.progress >= t.target;
              const pct =
                t.target > 0 ? Math.min(100, Math.round((t.progress / t.target) * 100)) : 0;
              return (
                <li key={`${t.title}-${t.windowEnd}`} className="flex flex-col gap-2 px-5 py-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex items-center gap-1.5 font-bold text-foreground">
                      {done ? (
                        <Check size={16} className="text-emerald-700" aria-hidden="true" />
                      ) : null}
                      {t.title}
                    </span>
                    <span className="shrink-0 text-label text-muted-foreground tabular-nums">
                      {t.progress}/{t.target}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
            {data.milestones.map((m) => (
              <li
                key={m.milestone.description}
                className="flex items-start justify-between gap-3 px-5 py-4"
              >
                <span className="text-body text-foreground">{m.milestone.description}</span>
                <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-label font-bold text-petroleo">
                  até {shortDate(m.dueOn)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <Card
        label="Medidas"
        title="Corpo e medidas"
        icon={<Ruler size={20} className="text-verde-pulso" aria-hidden="true" />}
      >
        {Object.keys(data.measurements).length === 0 ? (
          <p className="text-body text-muted-foreground">
            Opcional, mas ajuda muito: medir de tempos em tempos mostra o que a balança não conta.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3">
            {Object.entries(data.measurements).map(([k, points]) => {
              const first = points[0];
              const last = points[points.length - 1];
              const unit = MEASUREMENT_UNITS[k as MeasurementKind] ?? '';
              const delta = first && last && points.length > 1 ? last.value - first.value : null;
              return (
                <li key={k} className="flex flex-col gap-1 rounded-2xl bg-muted p-4">
                  <p className="text-label font-bold text-muted-foreground">
                    {MEASUREMENT_LABELS[k as MeasurementKind] ?? k}
                  </p>
                  <p className="text-h3 font-extrabold text-foreground">
                    {last?.value.toLocaleString('pt-BR')}{' '}
                    <span className="font-sans text-label font-normal">{unit}</span>
                  </p>
                  {delta !== null && first ? (
                    <p className="text-label text-muted-foreground">
                      {`${delta > 0 ? '+' : ''}${delta.toFixed(1)} desde ${shortDate(first.on)}`}
                    </p>
                  ) : null}
                  <Sparkline
                    values={points.map((p) => p.value)}
                    label={`Evolução de ${MEASUREMENT_LABELS[k as MeasurementKind] ?? k}`}
                  />
                </li>
              );
            })}
          </ul>
        )}
        <form
          onSubmit={save}
          className="grid grid-cols-2 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]"
        >
          <label className="flex flex-col gap-1 text-label">
            Medida
            <span className="relative">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as MeasurementKind)}
                className="h-12 w-full appearance-none rounded-xl border border-verde-pulso bg-card pr-10 pl-3 text-body"
              >
                {MEASURE_KINDS.map((m) => (
                  <option key={m} value={m}>
                    {MEASUREMENT_LABELS[m]}
                  </option>
                ))}
              </select>
              <ChevronDown
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2 text-petroleo"
              />
            </span>
          </label>
          <label className="flex flex-col gap-1 text-label">
            Valor ({kind === 'WEIGHT' ? 'kg' : 'cm'})
            <input
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="h-12 w-full rounded-xl border border-verde-pulso bg-card px-3 text-body"
            />
          </label>
          <Button
            type="submit"
            disabled={busy || value.trim() === ''}
            className="col-span-2 h-12 rounded-xl bg-petroleo px-6 font-bold text-white hover:bg-petroleo/85 sm:col-span-1"
          >
            Registrar
          </Button>
        </form>
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-destructive bg-destructive/10 p-3 text-label"
          >
            {error}
          </p>
        )}
      </Card>
    </StudentShell>
  );
}
