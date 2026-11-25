'use client';

import { useState } from 'react';

import {
  SESSION_MODALITY_LABELS,
  type LogExternalRequest,
  type SessionModality,
} from '@movivo/shared';

import { useTrainingApi } from './training-api-context';

import { NEUTRAL_INPUT_CLASS as FIELD_CLASS } from './strength-session';
import { StudentAlert } from './student-nav';

/** Treino fora do plano (outro esporte, sessão avulsa): esforço e minutos bastam. */
export function ExternalLogForm({ today, onLogged }: { today: string; onLogged: () => void }) {
  const api = useTrainingApi();
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
      await api.logExternal(request);
      setMinutes('');
      onLogged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível registrar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-3xl bg-card p-6 shadow-sm sm:p-8">
      <p className="text-label font-bold tracking-widest text-muted-foreground uppercase">
        Fora do plano
      </p>
      <h3 className="mt-2 text-h2 font-extrabold text-foreground">Registrar outro treino</h3>
      <div className="mt-6 grid grid-cols-2 gap-3">
        <label className="col-span-2 text-label text-muted-foreground">
          Tipo
          <select
            value={modality}
            onChange={(e) => setModality(e.target.value as SessionModality)}
            className={FIELD_CLASS}
          >
            {(Object.keys(SESSION_MODALITY_LABELS) as SessionModality[]).map((m) => (
              <option key={m} value={m}>
                {SESSION_MODALITY_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 text-label text-muted-foreground">
          Dia
          <input
            type="date"
            max={today}
            value={performedOn}
            onChange={(e) => setPerformedOn(e.target.value)}
            className={FIELD_CLASS}
          />
        </label>
        <label className="text-label text-muted-foreground">
          Esforço (0–10)
          <input
            type="number"
            min={0}
            max={10}
            value={rpe}
            onChange={(e) => setRpe(e.target.value)}
            className={FIELD_CLASS}
          />
        </label>
        <label className="text-label text-muted-foreground">
          Minutos
          <input
            inputMode="numeric"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className={FIELD_CLASS}
          />
        </label>
      </div>
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
        Registrar
      </button>
    </form>
  );
}
