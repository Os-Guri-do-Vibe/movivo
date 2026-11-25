'use client';

import { useRef, useState } from 'react';

import type { EnduranceMetrics, ExecutionView, SessionContent } from '@movivo/shared';

import { useTrainingApi } from './training-api-context';

import { durationLabel, enduranceLines, paceLabel } from './format';
import { StudentAlert } from './student-nav';

/** Ação secundária (contorno verde) no padrão do check-in. */
const SECONDARY =
  'min-h-11 rounded-xl border border-verde-pulso bg-card px-4 text-label font-bold text-petroleo transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50';

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
  if (metrics.maxHeartRate !== undefined) rows.push(['FC máxima', `${metrics.maxHeartRate} bpm`]);
  if (metrics.elevationGainMeters !== undefined) {
    rows.push(['Subida', `${metrics.elevationGainMeters} m`]);
  }
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-label text-muted-foreground">{label}</dt>
          <dd className="font-mono text-h3 font-extrabold text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A prescrição de corrida e HYROX, trecho a trecho, como linhas numeradas do cartão. */
export function EnduranceLines({ content }: { content: SessionContent }) {
  return (
    <ol className="divide-y divide-border">
      {enduranceLines(content).map((line, index) => (
        <li key={`${index}-${line}`} className="flex gap-3 px-4 py-3 text-body text-foreground">
          <span
            aria-hidden="true"
            className="w-5 shrink-0 pt-0.5 text-center text-label font-bold text-muted-foreground"
          >
            {index + 1}
          </span>
          <span className="min-w-0">{line}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Corrida e HYROX em andamento: a prescrição trecho a trecho e, para quem usa relógio, o envio do
 * arquivo (.fit/.gpx) ou de um print. Os números lidos entram já preenchidos no fechamento, onde
 * o aluno confere ou digita tudo à mão.
 */
export function EnduranceSession({
  executionId,
  content,
  metrics,
  onChange,
}: {
  executionId: string;
  content: SessionContent;
  metrics: EnduranceMetrics | null;
  onChange: (view: ExecutionView) => void;
}) {
  const api = useTrainingApi();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  async function run(action: () => Promise<ExecutionView>) {
    setBusy(true);
    setError('');
    try {
      onChange(await action());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível ler o arquivo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <EnduranceLines content={content} />

      <div className="border-t border-border px-4 py-5">
        <div className="rounded-2xl bg-muted p-4">
          {metrics ? (
            <>
              <h4 className="mb-3 font-extrabold text-foreground">Números lidos do relógio</h4>
              <MetricsSummary metrics={metrics} />
              <p className="mt-3 text-label text-muted-foreground">
                Você confere (e corrige, se precisar) ao finalizar o treino.
              </p>
            </>
          ) : (
            <>
              <h4 className="font-extrabold text-foreground">Usou relógio ou app?</h4>
              <p className="mt-1 text-label text-muted-foreground">
                Envie o arquivo ou um print e os números entram sozinhos no fechamento. Sem relógio,
                é só digitar no final.
              </p>
            </>
          )}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
              className={SECONDARY}
            >
              {metrics ? 'Enviar outro arquivo' : 'Enviar arquivo .fit ou .gpx'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => imageInput.current?.click()}
              className={SECONDARY}
            >
              Enviar print do relógio
            </button>
          </div>
          {busy ? (
            <p role="status" className="mt-3 text-label text-muted-foreground">
              Lendo os números…
            </p>
          ) : null}
        </div>
        {error ? (
          <div className="mt-4">
            <StudentAlert>{error}</StudentAlert>
          </div>
        ) : null}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".fit,.gpx"
        className="sr-only"
        aria-label="Arquivo da atividade"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void run(() => api.uploadActivityFile(executionId, file));
          event.target.value = '';
        }}
      />
      <input
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        aria-label="Print do relógio ou do aplicativo"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void run(() => api.uploadScreenshot(executionId, file));
          event.target.value = '';
        }}
      />
    </div>
  );
}
