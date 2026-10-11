'use client';

import { useEffect } from 'react';

/** Renova a trava bem antes de ela expirar no servidor (120 s), mesmo com a aba estrangulada. */
export const REVIEW_HOLD_HEARTBEAT_MS = 30_000;

/** O que tem envio automático e pode ser segurado pela tela de revisão. */
export type ReviewHoldKind = 'PROTOCOL' | 'SUBSTITUTION';

const RESOURCE: Record<ReviewHoldKind, string> = {
  PROTOCOL: 'protocols',
  SUBSTITUTION: 'substitutions',
};

const holdUrl = (kind: ReviewHoldKind, id: string) =>
  `/api/dashboard/${RESOURCE[kind]}/${encodeURIComponent(id)}/review-hold`;

/**
 * Enquanto a tela de revisão/edição de um protocolo ou de uma troca de exercício está aberta,
 * avisa o servidor para NÃO disparar a liberação automática ao WhatsApp, mesmo que o prazo
 * (1h protocolo, 30 min troca) venza. Ao sair da tela (navegar de volta à fila, fechar a
 * aba), solta a trava e o servidor envia na hora o que venceu nesse meio-tempo.
 *
 * Melhor esforço: se o aviso falhar, a trava expira sozinha em 2 min e o envio segue — nunca
 * trava o profissional nem o aluno.
 */
export function useReviewHold(kind: ReviewHoldKind, id: string, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const url = holdUrl(kind, id);
    let released = false;

    const send = (active: boolean) =>
      fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        // Sobrevive à navegação/fechamento: o aviso de saída precisa terminar depois da tela.
        keepalive: true,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      }).catch(() => undefined);

    void send(true);
    const timer = window.setInterval(() => void send(true), REVIEW_HOLD_HEARTBEAT_MS);

    const release = () => {
      if (released) return;
      released = true;
      window.clearInterval(timer);
      const beacon = new Blob([JSON.stringify({ active: false })], { type: 'application/json' });
      if (!navigator.sendBeacon?.(url, beacon)) void send(false);
    };

    // Fechar a aba ou recarregar não desmonta o React: `pagehide` cobre esses casos.
    window.addEventListener('pagehide', release);
    return () => {
      window.removeEventListener('pagehide', release);
      release();
    };
  }, [kind, id, enabled]);
}
