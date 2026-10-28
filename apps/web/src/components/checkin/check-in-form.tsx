'use client';

import { useEffect, useState } from 'react';

import type { CheckInAnswers } from '@movivo/shared';

import { StudentNav } from '@/components/training/student-nav';
import { Button } from '@/components/ui/button';
import { answerCheckIn, getCurrentCheckIn, type CurrentCheckIn } from '@/lib/checkin-api';
import { TrainingApiError } from '@/lib/training-api';

/** Check-in da semana: só as perguntas que podem mudar a próxima decisão. */
export function CheckInForm() {
  const [checkIn, setCheckIn] = useState<CurrentCheckIn | null | undefined>(undefined);
  const [answers, setAnswers] = useState<CheckInAnswers>({});
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getCurrentCheckIn()
      .then(setCheckIn)
      .catch((caught: unknown) => {
        setError(
          caught instanceof TrainingApiError && caught.status === 401
            ? 'Abra o link mais recente enviado no seu WhatsApp.'
            : 'Não foi possível carregar o check-in agora.',
        );
      });
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!checkIn) return;
    setBusy(true);
    setError('');
    try {
      await answerCheckIn(checkIn.id, answers);
      setDone(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível enviar.');
    } finally {
      setBusy(false);
    }
  }

  const set = (key: string, value: number | boolean | string) =>
    setAnswers((prev) => ({ ...prev, [key]: value }));

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-8">
      <StudentNav current="/hoje" />
      <h1 className="text-h2 font-semibold">Check-in da semana</h1>
      {error && (
        <p role="alert" className="rounded-xl border border-destructive bg-destructive/10 p-4">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="rounded-xl border border-primary p-4">
          Obrigado. A gente usa o que você contou para ajustar a sua semana.
        </p>
      )}
      {checkIn === undefined && !error && <p className="text-muted-foreground">Carregando…</p>}
      {checkIn === null && !done && (
        <p className="text-body text-muted-foreground">
          Não há check-in aberto agora. A gente avisa no WhatsApp quando for a hora.
        </p>
      )}
      {checkIn && !done && (
        <form onSubmit={submit} className="flex flex-col gap-6">
          {checkIn.questions.map((q) => (
            <fieldset key={q.key} className="flex flex-col gap-2">
              <legend className="text-body font-semibold">{q.prompt}</legend>
              {q.type === 'SCALE_1_5' && (
                <div className="flex gap-2" role="radiogroup" aria-label={q.prompt}>
                  {[1, 2, 3, 4, 5].map((v) => (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={answers[q.key] === v}
                      onClick={() => set(q.key, v)}
                      className={`size-11 rounded-lg border font-semibold ${answers[q.key] === v ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card'}`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              )}
              {q.type === 'YES_NO' && (
                <div className="flex gap-2" role="radiogroup" aria-label={q.prompt}>
                  {[
                    ['Sim', true],
                    ['Não', false],
                  ].map(([label, value]) => (
                    <button
                      key={String(label)}
                      type="button"
                      role="radio"
                      aria-checked={answers[q.key] === value}
                      onClick={() => set(q.key, value as boolean)}
                      className={`h-11 rounded-lg border px-5 font-semibold ${answers[q.key] === value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card'}`}
                    >
                      {String(label)}
                    </button>
                  ))}
                </div>
              )}
              {q.type === 'CHOICE' && (
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={q.prompt}>
                  {q.options?.map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={answers[q.key] === option}
                      onClick={() => set(q.key, option)}
                      className={`h-11 rounded-lg border px-4 ${answers[q.key] === option ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card'}`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
              {q.type === 'NUMBER' && (
                <input
                  inputMode="decimal"
                  aria-label={q.prompt}
                  className="h-11 w-32 rounded-lg border border-border bg-card px-3"
                  onChange={(e) => {
                    const value = Number(e.target.value.replace(',', '.'));
                    setAnswers((prev) => {
                      const next = { ...prev };
                      if (e.target.value.trim() === '' || !Number.isFinite(value))
                        delete next[q.key];
                      else next[q.key] = value;
                      return next;
                    });
                  }}
                />
              )}
              {q.type === 'TEXT' && (
                <textarea
                  aria-label={q.prompt}
                  maxLength={1000}
                  className="rounded-lg border border-border bg-card p-3"
                  onChange={(e) => set(q.key, e.target.value)}
                />
              )}
            </fieldset>
          ))}
          <div>
            <Button type="submit" disabled={busy}>
              Enviar
            </Button>
          </div>
        </form>
      )}
    </main>
  );
}
