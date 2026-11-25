'use client';

import { useState } from 'react';

import type { DailyCheckIn } from '@movivo/shared';

import { CHECK_IN_KEYS, CheckInFields, EMPTY_CHECK_IN } from './check-in-fields';
import { StudentAlert } from './student-nav';
import { useTrainingApi } from './training-api-context';

/**
 * Etapa 2 do check-in diário: antes do treino (ou no dia de descanso), as perguntas de disposição
 * e do dia. Uma vez por dia; os especialistas leem assim que chega e o treino do dia já considera.
 */
export function DailyCheckInStep({
  training,
  onDone,
  onSkip,
}: {
  /** Há treino hoje: o botão leva ao treino; sem treino, só registra o dia. */
  training: boolean;
  onDone: () => void;
  onSkip: () => void;
}) {
  const api = useTrainingApi();
  const [value, setValue] = useState<DailyCheckIn>(EMPTY_CHECK_IN);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const missing = CHECK_IN_KEYS.filter((key) => value[key] === null || value[key] === undefined);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.saveCheckIn(value);
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível registrar agora.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-3xl bg-card p-6 shadow-sm sm:p-8">
      <p className="text-label font-bold tracking-widest text-muted-foreground uppercase">
        Check-in do dia
      </p>
      <h2 className="mt-2 text-h2 font-extrabold text-foreground">Como você está hoje?</h2>
      <p className="mt-1 text-label text-muted-foreground">
        {training
          ? 'Antes do treino: leva segundos e ajuda a ajustar o que vem pela frente.'
          : 'Leva segundos e ajuda a cuidar da sua recuperação.'}
      </p>
      <div className="mt-6">
        <CheckInFields value={value} onChange={setValue} />
      </div>
      {error ? (
        <div className="mt-4">
          <StudentAlert>{error}</StudentAlert>
        </div>
      ) : null}
      <button
        type="submit"
        disabled={busy || missing.length > 0}
        className="mt-8 min-h-14 w-full rounded-2xl bg-petroleo font-extrabold text-white transition-colors hover:bg-petroleo/85 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
      >
        {busy ? 'Salvando...' : training ? 'Continuar para o treino' : 'Enviar'}
      </button>
      {missing.length > 0 ? (
        <p role="status" className="mt-2 text-center text-label text-muted-foreground">
          Responda as {CHECK_IN_KEYS.length} perguntas para continuar.
        </p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={onSkip}
        className="mt-3 min-h-12 w-full rounded-2xl text-label font-bold text-muted-foreground transition-colors hover:bg-muted"
      >
        Responder depois
      </button>
    </form>
  );
}
