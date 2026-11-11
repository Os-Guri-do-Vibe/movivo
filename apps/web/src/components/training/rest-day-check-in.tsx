'use client';

import { useState } from 'react';

import type { DailyCheckIn } from '@movivo/shared';

import { Button } from '@/components/ui/button';
import { saveCheckIn } from '@/lib/training-api';

import { CheckInFields, EMPTY_CHECK_IN } from './check-in-fields';

/** Dia sem treino: o mesmo check-in do fechamento, em segundos, para os agentes acompanharem a recuperação. */
export function RestDayCheckIn() {
  const [value, setValue] = useState<DailyCheckIn>(EMPTY_CHECK_IN);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const answered = Object.values(value).some((answer) => answer !== null && answer !== undefined);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await saveCheckIn(value);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível registrar agora.');
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <p role="status" className="rounded-xl border border-border p-4 text-body">
        Obrigado! Já levamos isso em conta no seu acompanhamento.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl border border-border p-4">
      <h3 className="text-label font-semibold">
        Como você está hoje?{' '}
        <span className="font-normal text-muted-foreground">
          (leva segundos e ajuda a cuidar da sua recuperação)
        </span>
      </h3>
      <CheckInFields value={value} onChange={setValue} />
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive bg-destructive/10 p-3 text-label"
        >
          {error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={busy || !answered}>
          Enviar
        </Button>
      </div>
    </form>
  );
}
