'use client';

import { Hourglass, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ExceptionListItem } from '@movivo/shared';

import { releaseCountdown } from '@/lib/exception-copy';

import { StatusBadge } from './control-center-table';

/** Relógio que se atualiza sozinho, para a contagem regressiva não ficar parada na tela. */
function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Etiqueta da urgência da revisão: obrigatória (sem envio automático) ou opcional (com prazo). */
export function ReviewUrgencyBadge({
  reviewUrgency,
  autoReleaseAt,
}: Pick<ExceptionListItem, 'reviewUrgency' | 'autoReleaseAt'>) {
  const now = useNow();
  if (reviewUrgency === 'MANDATORY') {
    return (
      <StatusBadge
        tone="attention"
        title="O aluno só recebe o protocolo depois que um profissional revisar e liberar."
      >
        Revisão obrigatória
      </StatusBadge>
    );
  }
  if (reviewUrgency === 'OPTIONAL' && autoReleaseAt) {
    return (
      <StatusBadge
        tone="neutral"
        title="Se ninguém revisar, o protocolo é enviado ao aluno automaticamente ao fim da janela."
      >
        Envio automático {releaseCountdown(autoReleaseAt, now)}
      </StatusBadge>
    );
  }
  return null;
}

/** Explica o que a urgência significa, no topo do caso de protocolo. */
export function ReviewUrgencyNotice({
  reviewUrgency,
  autoReleaseAt,
}: Pick<ExceptionListItem, 'reviewUrgency' | 'autoReleaseAt'>) {
  const now = useNow();
  if (reviewUrgency === 'MANDATORY') {
    return (
      <p
        role="note"
        className="flex items-start gap-2 rounded-xl border border-border bg-card p-4 text-label"
      >
        <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>
          <strong className="font-semibold">Revisão obrigatória.</strong> O aluno só recebe este
          protocolo no WhatsApp depois que você revisar, ajustar se precisar e liberar.
        </span>
      </p>
    );
  }
  if (reviewUrgency === 'OPTIONAL' && autoReleaseAt) {
    return (
      <p
        role="note"
        className="flex items-start gap-2 rounded-xl border border-border bg-card p-4 text-label"
      >
        <Hourglass aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>
          <strong className="font-semibold">Revisão opcional.</strong> Se ninguém liberar antes, o
          protocolo é enviado ao aluno automaticamente {releaseCountdown(autoReleaseAt, now)}. Com
          esta tela aberta, o envio espera você terminar.
        </span>
      </p>
    );
  }
  return null;
}
