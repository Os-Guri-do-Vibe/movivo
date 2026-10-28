'use client';

import { MEASUREMENT_LABELS, type MeasurementKind } from '@movivo/shared';
import { useEffect, useState } from 'react';

import { StudentNav } from '@/components/training/student-nav';
import { Button } from '@/components/ui/button';
import { addMeasurements, getEvolution, type EvolutionView as Evolution } from '@/lib/checkin-api';
import { TrainingApiError } from '@/lib/training-api';

const FORMAT = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'UTC',
});
const shortDate = (iso: string) => FORMAT.format(new Date(`${iso}T00:00:00Z`));

const MEASURE_KINDS: MeasurementKind[] = ['WEIGHT', 'WAIST', 'HIP', 'ARM', 'THIGH'];

/** Metas, treinos das últimas semanas e medidas (opcionais, mas ajudam muito). */
export function EvolutionView() {
  const [data, setData] = useState<Evolution | null>(null);
  const [error, setError] = useState('');
  const [kind, setKind] = useState<MeasurementKind>('WAIST');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setData(await getEvolution());
      setError('');
    } catch (caught) {
      setError(
        caught instanceof TrainingApiError && caught.status === 401
          ? 'Abra o link mais recente enviado no seu WhatsApp.'
          : 'Não foi possível carregar sua evolução agora.',
      );
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const number = Number(value.replace(',', '.'));
    if (!Number.isFinite(number)) return;
    setBusy(true);
    try {
      await addMeasurements([
        {
          kind,
          value: number,
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
      <main className="mx-auto max-w-3xl px-6 py-10">
        <p role="alert" className="rounded-xl border border-destructive bg-destructive/10 p-4">
          {error}
        </p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10" aria-busy="true">
        <p className="text-muted-foreground">Carregando sua evolução…</p>
      </main>
    );
  }

  const maxSessions = Math.max(1, ...data.weeks.map((w) => w.sessions));
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-8">
      <StudentNav current="/evolucao" />
      <section className="flex flex-col gap-2">
        <h1 className="text-h2 font-semibold">
          {data.firstName ? `${data.firstName}, sua evolução` : 'Sua evolução'}
        </h1>
        <p className="text-body text-muted-foreground">
          {data.strategyTitle ?? 'Estamos montando a sua estratégia.'} A régua é você: o quanto
          avançou desde o seu ponto de partida.
        </p>
      </section>

      <section aria-label="Treinos por semana" className="flex flex-col gap-3">
        <h2 className="text-h3 font-semibold">Treinos nas últimas semanas</h2>
        <ul className="flex items-end gap-2" aria-label="Treinos concluídos por semana">
          {data.weeks.map((w) => (
            <li key={w.weekStart} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t bg-primary"
                style={{ height: `${Math.max(4, (w.sessions / maxSessions) * 80)}px` }}
                role="img"
                aria-label={`${w.sessions} treino(s) na semana de ${shortDate(w.weekStart)}`}
              />
              <span className="text-label text-muted-foreground">{shortDate(w.weekStart)}</span>
            </li>
          ))}
        </ul>
      </section>

      {(data.milestones.length > 0 || data.tasks.length > 0) && (
        <section aria-label="Metas" className="flex flex-col gap-2">
          <h2 className="text-h3 font-semibold">Metas</h2>
          <ul className="flex flex-col gap-2">
            {data.tasks.map((t) => (
              <li key={`${t.title}-${t.windowEnd}`} className="rounded-xl border border-border p-3">
                {t.title}{' '}
                <span className="text-label text-muted-foreground">
                  {t.progress}/{t.target}
                </span>
              </li>
            ))}
            {data.milestones.map((m) => (
              <li key={m.milestone.description} className="rounded-xl border border-border p-3">
                {m.milestone.description}{' '}
                <span className="text-label text-muted-foreground">até {shortDate(m.dueOn)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Medidas" className="flex flex-col gap-3">
        <h2 className="text-h3 font-semibold">Medidas</h2>
        {Object.keys(data.measurements).length === 0 && (
          <p className="text-body text-muted-foreground">
            Opcional, mas ajuda muito: medir de tempos em tempos mostra o que a balança não conta.
          </p>
        )}
        {Object.entries(data.measurements).map(([k, points]) => {
          const first = points[0];
          const last = points[points.length - 1];
          return (
            <p key={k} className="text-body">
              <strong>{MEASUREMENT_LABELS[k as MeasurementKind] ?? k}:</strong> {last?.value}
              {first && last && points.length > 1
                ? ` (${last.value - first.value > 0 ? '+' : ''}${(last.value - first.value).toFixed(1)} desde ${shortDate(first.on)})`
                : ''}
            </p>
          );
        })}
        <form onSubmit={save} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-label">
            Medida
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as MeasurementKind)}
              className="h-11 rounded-lg border border-border bg-card px-3 text-body"
            >
              {MEASURE_KINDS.map((m) => (
                <option key={m} value={m}>
                  {MEASUREMENT_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-label">
            Valor ({kind === 'WEIGHT' ? 'kg' : 'cm'})
            <input
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="h-11 w-28 rounded-lg border border-border bg-card px-3 text-body"
            />
          </label>
          <Button type="submit" disabled={busy || value.trim() === ''}>
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
      </section>
    </main>
  );
}
