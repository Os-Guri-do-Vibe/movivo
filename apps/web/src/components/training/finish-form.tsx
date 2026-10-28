'use client';

import { useState } from 'react';

import type { ExecutionView, FinishExecutionRequest } from '@movivo/shared';

import { Button } from '@/components/ui/button';

const REGIONS = ['ombro', 'joelho', 'lombar', 'quadril', 'tornozelo', 'punho', 'cotovelo', 'outra'];

/**
 * Fechamento da sessão: como foi (esforço de 0 a 10), quanto durou, se doeu e se gostou.
 * O texto é de acompanhamento, sem cobrança: o aluno pode concluir, fazer só parte ou desistir.
 */
export function FinishForm({
  defaultMinutes,
  needsConfirmation,
  onFinish,
}: {
  defaultMinutes: number | null;
  /** Há números lidos de arquivo/print ainda sem confirmação: bloqueia o "Concluí". */
  needsConfirmation: boolean;
  onFinish: (request: FinishExecutionRequest) => Promise<ExecutionView | void>;
}) {
  const [rpe, setRpe] = useState<number | null>(null);
  const [minutes, setMinutes] = useState(defaultMinutes ? String(defaultMinutes) : '');
  const [enjoyment, setEnjoyment] = useState<number | null>(null);
  const [hadPain, setHadPain] = useState(false);
  const [region, setRegion] = useState(REGIONS[0] ?? 'outra');
  const [intensity, setIntensity] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(status: FinishExecutionRequest['status']) {
    const parsedMinutes = minutes.trim() === '' ? null : Number(minutes);
    if (status !== 'ABANDONED' && (rpe === null || parsedMinutes === null)) {
      setError('Conte o esforço e quantos minutos durou para concluir.');
      return;
    }
    if (parsedMinutes !== null && (!Number.isInteger(parsedMinutes) || parsedMinutes < 1)) {
      setError('Informe os minutos como um número inteiro.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onFinish({
        status,
        rpe,
        durationMinutes: parsedMinutes,
        enjoyment,
        painReports: hadPain ? [{ region, intensity, during: 'DURING' }] : [],
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível registrar agora.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit('COMPLETED');
      }}
    >
      <fieldset>
        <legend className="text-label font-semibold">
          Qual foi o esforço? (0 = nenhum, 10 = máximo)
        </legend>
        <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Esforço percebido">
          {Array.from({ length: 11 }, (_, value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={rpe === value}
              onClick={() => setRpe(value)}
              className={`size-10 rounded-lg border text-label font-semibold ${rpe === value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card'}`}
            >
              {value}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1 text-label font-semibold">
        Quantos minutos durou?
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={600}
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
          className="h-11 w-32 rounded-lg border border-border bg-card px-3 text-body font-normal"
        />
      </label>

      <fieldset>
        <legend className="text-label font-semibold">Gostou da sessão?</legend>
        <div className="mt-2 flex gap-2" role="radiogroup" aria-label="Quanto gostou">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={enjoyment === value}
              onClick={() => setEnjoyment(value)}
              className={`size-10 rounded-lg border text-label font-semibold ${enjoyment === value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card'}`}
            >
              {value}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-label font-semibold">Sentiu dor durante a sessão?</legend>
        <label className="flex items-center gap-2 text-body">
          <input
            type="checkbox"
            checked={hadPain}
            onChange={(event) => setHadPain(event.target.checked)}
          />
          Sim, senti dor
        </label>
        {hadPain && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-label">
              Onde
              <select
                value={region}
                onChange={(event) => setRegion(event.target.value)}
                className="h-11 rounded-lg border border-border bg-card px-3 text-body"
              >
                {REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-label">
              Intensidade (0–10)
              <input
                type="number"
                min={0}
                max={10}
                value={intensity}
                onChange={(event) => setIntensity(Number(event.target.value))}
                className="h-11 w-24 rounded-lg border border-border bg-card px-3 text-body"
              />
            </label>
          </div>
        )}
      </fieldset>

      {needsConfirmation && (
        <p role="status" className="text-label text-muted-foreground">
          Confirme os números lidos do arquivo antes de concluir.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive bg-destructive/10 p-3 text-label"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy || needsConfirmation}>
          Concluí
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || needsConfirmation}
          onClick={() => void submit('PARTIAL')}
        >
          Fiz só uma parte
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => void submit('ABANDONED')}
        >
          Hoje não deu
        </Button>
      </div>
    </form>
  );
}
