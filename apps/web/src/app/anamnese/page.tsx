'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import { startAnamnesis } from '@/lib/anamnesis-api';

/**
 * Bootstrap do onboarding (US-6.10): cria a sessão e redireciona para o link
 * resumível `/anamnese/[token]` — mesmo padrão de rota dinâmica por token opaco de
 * `/protocolo/[token]`, `/assinar/[token]` e `/conta/[token]` (ADR-006).
 */
export default function AnamneseBootstrapPage() {
  const router = useRouter();
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void startAnamnesis()
      .then(({ token }) => {
        if (!cancelled) router.replace(`/anamnese/${token}`);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="onboarding-light mx-auto flex min-h-dvh w-full max-w-none flex-col items-center justify-center gap-4 bg-white px-6 text-center text-foreground">
      {error ? (
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
    </main>
  );
}
