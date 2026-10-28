'use client';

import * as React from 'react';

import { resumeComplementary, type SessionEntry } from '@/lib/anamnesis-api';

import { OnboardingShell } from './onboarding-shell';
import { OnboardingWizard } from './onboarding-wizard';

type State = SessionEntry | 'error' | 'invalid' | null;

/**
 * Entrada da anamnese complementar (aluno que já existia). O token chega no FRAGMENTO da URL
 * (`#token=…`), que não vai para logs nem para o servidor; aqui ele é entregue ao BFF, que o
 * guarda em cookie httpOnly, e some da barra de endereço.
 */
export function ComplementaryEntry() {
  const [state, setState] = React.useState<State>(null);
  // O Strict Mode roda o efeito duas vezes e o fragmento só existe na primeira.
  const pending = React.useRef<Promise<SessionEntry> | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
    if (!pending.current) {
      if (!/^[0-9a-f]{64}$/.test(token)) {
        setState('invalid');
        return;
      }
      pending.current = resumeComplementary(token);
      window.history.replaceState(null, '', window.location.pathname);
    }
    pending.current
      .then((entry) => {
        if (!cancelled) setState(entry);
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state && state !== 'error' && state !== 'invalid') {
    return (
      <OnboardingShell>
        <OnboardingWizard sessionRef={state.ref} initial={state.session} />
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        {state === null ? (
          <p role="status" className="text-body text-muted-foreground">
            Abrindo seu formulário…
          </p>
        ) : (
          <>
            <h1 className="text-h2 font-semibold">
              {state === 'invalid'
                ? 'Este link não está completo'
                : 'Não conseguimos abrir seu formulário'}
            </h1>
            <p className="text-body text-muted-foreground">
              {state === 'invalid'
                ? 'Abra o link pelo WhatsApp, do jeito que enviamos, ou peça um novo por lá.'
                : 'O link pode ter expirado. Peça um novo pelo WhatsApp da MOVIVO e tente de novo.'}
            </p>
          </>
        )}
      </div>
    </OnboardingShell>
  );
}
