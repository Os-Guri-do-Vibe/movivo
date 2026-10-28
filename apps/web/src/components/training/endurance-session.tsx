'use client';

import { useRef, useState } from 'react';

import type { EnduranceMetrics, ExecutionView, SessionContent } from '@movivo/shared';

import { Button } from '@/components/ui/button';
import { saveMetrics, uploadActivityFile } from '@/lib/training-api';

import { durationLabel, enduranceLines, paceLabel } from './format';

/** "28:14" ou "1:05:30" → segundos; `null` se o formato não for reconhecido. */
export function parseClock(text: string): number | null {
  const parts = text.trim().split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !Number.isFinite(p) || p < 0)) {
    return null;
  }
  return parts.reduce((total, p) => total * 60 + p, 0);
}

export function MetricsSummary({ metrics }: { metrics: EnduranceMetrics }) {
  const rows: [string, string][] = [];
  if (metrics.distanceMeters !== undefined) {
    rows.push([
      'Distância',
      `${(metrics.distanceMeters / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km`,
    ]);
  }
  const seconds = metrics.movingSeconds ?? metrics.elapsedSeconds;
  if (seconds !== undefined) rows.push(['Tempo', durationLabel(seconds)]);
  if (metrics.avgPaceSecondsPerKm !== undefined) {
    rows.push(['Ritmo médio', `${paceLabel(metrics.avgPaceSecondsPerKm)} /km`]);
  }
  if (metrics.avgHeartRate !== undefined) rows.push(['FC média', `${metrics.avgHeartRate} bpm`]);
  if (metrics.elevationGainMeters !== undefined) {
    rows.push(['Subida', `${metrics.elevationGainMeters} m`]);
  }
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-body">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Corrida e HYROX: prescrição, números (à mão, por arquivo) e confirmação. */
export function EnduranceSession({
  executionId,
  content,
  metrics,
  confirmed,
  onChange,
}: {
  executionId: string;
  content: SessionContent;
  metrics: EnduranceMetrics | null;
  confirmed: boolean;
  onChange: (view: ExecutionView) => void;
}) {
  const [distanceKm, setDistanceKm] = useState('');
  const [clock, setClock] = useState('');
  const [heartRate, setHeartRate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function run(action: () => Promise<ExecutionView>) {
    setBusy(true);
    setError('');
    try {
      onChange(await action());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível concluir.');
    } finally {
      setBusy(false);
    }
  }

  function manual() {
    const seconds = parseClock(clock);
    const km = Number(distanceKm.replace(',', '.'));
    if (!Number.isFinite(km) || km <= 0 || seconds === null) {
      setError('Informe a distância em km e o tempo no formato mm:ss ou h:mm:ss.');
      return;
    }
    const hr = heartRate.trim() === '' ? undefined : Number(heartRate);
    void run(() =>
      saveMetrics(executionId, {
        confirmed: true,
        metrics: {
          distanceMeters: Math.round(km * 1000),
          movingSeconds: seconds,
          ...(hr && Number.isInteger(hr) ? { avgHeartRate: hr } : {}),
        },
      }),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="list-disc pl-5 text-body">
        {enduranceLines(content).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      {metrics ? (
        <div className="rounded-xl border border-border p-4">
          <h4 className="mb-2 font-semibold">
            {confirmed ? 'Números confirmados' : 'Números lidos do arquivo'}
          </h4>
          <MetricsSummary metrics={metrics} />
          {!confirmed && (
            <div className="mt-3 flex gap-3">
              <Button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(() => saveMetrics(executionId, { metrics, confirmed: true }))
                }
              >
                Está certo
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                Enviar outro arquivo
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
          <h4 className="font-semibold">Registre os números</h4>
          <p className="text-label text-muted-foreground">
            Envie o arquivo do relógio (.fit ou .gpx) ou digite os números.
          </p>
          <div>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              Enviar arquivo .fit ou .gpx
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-label">
              Distância (km)
              <input
                inputMode="decimal"
                value={distanceKm}
                onChange={(e) => setDistanceKm(e.target.value)}
                className="h-11 w-28 rounded-lg border border-border bg-card px-3 text-body"
              />
            </label>
            <label className="flex flex-col gap-1 text-label">
              Tempo (mm:ss)
              <input
                value={clock}
                onChange={(e) => setClock(e.target.value)}
                placeholder="28:14"
                className="h-11 w-28 rounded-lg border border-border bg-card px-3 text-body"
              />
            </label>
            <label className="flex flex-col gap-1 text-label">
              FC média (opcional)
              <input
                inputMode="numeric"
                value={heartRate}
                onChange={(e) => setHeartRate(e.target.value)}
                className="h-11 w-28 rounded-lg border border-border bg-card px-3 text-body"
              />
            </label>
            <Button type="button" disabled={busy} onClick={manual}>
              Salvar números
            </Button>
          </div>
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept=".fit,.gpx"
        className="sr-only"
        aria-label="Arquivo da atividade"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void run(() => uploadActivityFile(executionId, file));
          event.target.value = '';
        }}
      />
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive bg-destructive/10 p-3 text-label"
        >
          {error}
        </p>
      )}
    </div>
  );
}
