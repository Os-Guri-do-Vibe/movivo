'use client';

import * as React from 'react';

import { subscriptionPlanIdSchema } from '@movivo/shared';

import {
  AnamnesisApiError,
  getSession,
  startAnamnesis,
  type SessionEntry,
} from '@/lib/anamnesis-api';
import { captureFirstTouch } from '@/lib/first-touch';

import { OnboardingShell } from './onboarding-shell';
import { OnboardingWizard } from './onboarding-wizard';

/**
 * `?plano=ID` = clique num CTA da landing → cadastro novo, como antes. Sem ele (F5,
 * voltar/avançar) → retoma a sessão do cookie. Sessão inexistente (404) ou expirada
 * recomeça; falha de rede/5xx propaga — não descarta progresso.
 */
async function resolveEntry(planParam: string | null): Promise<SessionEntry> {
  if (planParam) return startAnamnesis(subscriptionPlanIdSchema.catch('MONTHLY').parse(planParam));
  try {
    const resumed = await getSession();
    if (resumed.session.status !== 'EXPIRED') return resumed;
  } catch (error) {
    if (!(error instanceof AnamnesisApiError) || error.status >= 500) throw error;
  }
  return startAnamnesis('MONTHLY');
}

/**
 * Entrada do onboarding (US-6.10): a URL é sempre `/anamnese` e o token da sessão não
 * passa por este código — fica no cookie httpOnly do BFF (`app/api/anamnesis`).
 */
export function AnamneseEntry() {
  const [state, setState] = React.useState<SessionEntry | 'error' | null>(null);
  // Uma sessão por montagem: o Strict Mode roda o efeito duas vezes, e dois `start`
  // deixariam o cookie numa sessão e a aba na outra.
  const pending = React.useRef<Promise<SessionEntry> | null>(null);

  React.useEffect(() => {
    // Cobre quem chega direto em `/anamnese?utm_source=...` sem passar pela landing.
    captureFirstTouch();
    let cancelled = false;
    pending.current ??= resolveEntry(new URLSearchParams(window.location.search).get('plano'));
    pending.current
      .then((entry) => {
        if (cancelled) return;
        // Sem `?plano`, o F5 retoma esta sessão em vez de abrir outra.
        window.history.replaceState(null, '', window.location.pathname);
        setState(entry);
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state && state !== 'error') {
    return (
      <OnboardingShell>
        <OnboardingWizard sessionRef={state.ref} initial={state.session} />
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        {state === 'error' ? (
          <>
            <h1 className="text-h2 font-semibold">Não conseguimos começar agora</h1>
            <p className="text-body text-muted-foreground">
              Tente novamente em instantes, ou fale com a gente pelo WhatsApp da MOVIVO.
            </p>
          </>
        ) : (
          <p className="text-body text-muted-foreground" role="status">
            Preparando seu cadastro…
          </p>
        )}
      </div>
    </OnboardingShell>
  );
}
