'use client';

import { useState } from 'react';

import {
  SESSION_MODALITY_LABELS,
  type LogExternalRequest,
  type SessionModality,
} from '@movivo/shared';

import { Button } from '@/components/ui/button';
import { logExternal } from '@/lib/training-api';

/** Treino fora do plano (outro esporte, sessão avulsa): esforço e minutos bastam. */
export function ExternalLogForm({ today, onLogged }: { today: string; onLogged: () => void }) {
  const [modality, setModality] = useState<SessionModality>('EXTERNAL_SPORT');
  const [performedOn, setPerformedOn] = useState(today);
  const [rpe, setRpe] = useState('6');
  const [minutes, setMinutes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const durationMinutes = Number(minutes);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1) {
      setError('Informe a duração em minutos.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const request: LogExternalRequest = {
        modality,
        performedOn,
        rpe: Number(rpe),
        durationMinutes,
        painReports: [],
      };
      await logExternal(request);
      setMinutes('');
      onLogged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível registrar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border border-border p-4">
      <h3 className="font-semibold">Registrar outro treino</h3>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-label">
          Tipo
          <select
            value={modality}
            onChange={(e) => setModality(e.target.value as SessionModality)}
            className="h-11 rounded-lg border border-border bg-card px-3 text-body"
          >
            {(Object.keys(SESSION_MODALITY_LABELS) as SessionModality[]).map((m) => (
              <option key={m} value={m}>
                {SESSION_MODALITY_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-label">
          Dia
          <input
            type="date"
            max={today}
            value={performedOn}
            onChange={(e) => setPerformedOn(e.target.value)}
            className="h-11 rounded-lg border border-border bg-card px-3 text-body"
          />
        </label>
        <label className="flex flex-col gap-1 text-label">
          Esforço (0–10)
          <input
            type="number"
            min={0}
            max={10}
            value={rpe}
            onChange={(e) => setRpe(e.target.value)}
            className="h-11 w-24 rounded-lg border border-border bg-card px-3 text-body"
          />
        </label>
        <label className="flex flex-col gap-1 text-label">
          Minutos
          <input
            inputMode="numeric"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className="h-11 w-24 rounded-lg border border-border bg-card px-3 text-body"
          />
        </label>
        <Button type="submit" disabled={busy}>
          Registrar
        </Button>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive bg-destructive/10 p-3 text-label"
        >
          {error}
        </p>
      )}
    </form>
  );
}
