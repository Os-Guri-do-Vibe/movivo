'use client';

import { AlertTriangle, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

export function ConfirmAction({
  triggerLabel,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive = false,
  disabled = false,
  triggerVariant,
  triggerSize = 'lg',
}: {
  triggerLabel: string;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  destructive?: boolean;
  disabled?: boolean;
  /**
   * Variante do GATILHO, quando ela precisa divergir da variante do botão de confirmação.
   * "Descartar alterações" no cartão do agente é um exemplo: a ação é destrutiva (e o
   * botão dentro do diálogo é vermelho), mas o gatilho divide a linha com a ação primária
   * da página — dois botões sólidos ali competiriam pelo mesmo olhar.
   */
  triggerVariant?: 'default' | 'outline' | 'destructive' | 'ghost';
  triggerSize?: 'default' | 'sm' | 'lg';
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
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
        size={triggerSize}
        variant={triggerVariant ?? (destructive ? 'destructive' : 'default')}
        disabled={disabled}
        onClick={() => dialogRef.current?.showModal()}
      >
        {triggerLabel}
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
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
          <h2 id={titleId} className="mt-4 text-h2 font-bold">
            {title}
          </h2>
          <p id={descriptionId} className="mt-2 text-body text-muted-foreground">
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
