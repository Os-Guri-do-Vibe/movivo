'use client';

import { AlertTriangle, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

export function ConfirmAction({
  triggerLabel,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive = false,
  disabled = false,
}: {
  triggerLabel: string;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function confirm() {
    setPending(true);
    setError('');
    try {
      await onConfirm();
      dialogRef.current?.close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível concluir a ação.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        size="lg"
        variant={destructive ? 'destructive' : 'default'}
        disabled={disabled}
        onClick={() => dialogRef.current?.showModal()}
      >
        {triggerLabel}
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby="confirm-action-title"
        aria-describedby="confirm-action-description"
        className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-xl border border-border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-petroleo/70"
        onClose={() => setError('')}
      >
        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <span
              aria-hidden="true"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
            >
              <AlertTriangle />
            </span>
            <form method="dialog">
              <Button type="submit" variant="ghost" size="icon" aria-label="Fechar confirmação">
                <X aria-hidden="true" />
              </Button>
            </form>
          </div>
          <h2 id="confirm-action-title" className="mt-4 text-h2 font-bold">
            {title}
          </h2>
          <p id="confirm-action-description" className="mt-2 text-body text-muted-foreground">
            {description}
          </p>
          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-destructive p-3 text-label text-destructive-foreground"
            >
              {error}
            </p>
          ) : null}
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <form method="dialog">
              <Button
                type="submit"
                variant="outline"
                size="lg"
                className="w-full sm:w-auto"
                disabled={pending}
              >
                Voltar e revisar
              </Button>
            </form>
            <Button
              type="button"
              size="lg"
              variant={destructive ? 'destructive' : 'default'}
              disabled={pending}
              onClick={() => void confirm()}
            >
              {pending ? 'Registrando…' : confirmLabel}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
