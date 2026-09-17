'use client';

import * as React from 'react';
import type { CheckinWeeklySubmit } from '@movivo/shared';

import { CheckinWeeklyApiError, submitCheckinWeekly } from '@/lib/checkin-weekly-api';
import { WeeklyCheckinForm } from './weekly-checkin-form';
import { WeeklyCheckinSuccessScreen } from './success-screen';

const GENERIC_SAVE_ERROR = 'Não conseguimos enviar suas respostas. Tente de novo em instantes.';

export function WeeklyCheckinClient({
  token,
  firstName,
}: {
  token: string;
  firstName: string | null;
}) {
  const [saving, setSaving] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(payload: CheckinWeeklySubmit) {
    setSaving(true);
    setError(null);
    try {
      await submitCheckinWeekly(token, payload);
      setSubmitted(true);
    } catch (err) {
      if (err instanceof CheckinWeeklyApiError) {
        if (err.status === 410) {
          setError(
            'Este check-in expirou. Fale com a gente pelo WhatsApp para pedir um novo link.',
          );
        } else if (err.status === 409) {
          setError(
            'Este check-in já tinha sido enviado. Recarregue a página para ver o status atual.',
          );
        } else if (err.status === 400 && err.issues[0]) {
          setError(err.issues[0]);
        } else {
          setError(GENERIC_SAVE_ERROR);
        }
      } else {
        setError(GENERIC_SAVE_ERROR);
      }
    } finally {
      setSaving(false);
    }
  }

  if (submitted) {
    return <WeeklyCheckinSuccessScreen name={firstName?.trim() || 'você'} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-destructive bg-destructive/10 p-3 text-label text-petroleo"
        >
          {error}
        </p>
      )}
      <WeeklyCheckinForm onSubmit={handleSubmit} saving={saving} />
    </div>
  );
}
