import type { Metadata } from 'next';

import { ThemeToggle } from '@/components/theme-toggle';
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard';
import { getSession, type SessionView } from '@/lib/anamnesis-api';

/**
 * Wizard de onboarding v2 (US-6.10/US-6.11) — RSC que busca a sessão no servidor
 * (mesmo padrão de `/protocolo/[token]`) e hidrata o wizard client-side com o estado
 * inicial, para retomada funcionar mesmo após reload.
 */
export const metadata: Metadata = {
  title: 'Seu cadastro · MOVIVO',
  robots: { index: false },
};

async function fetchSession(token: string): Promise<SessionView | null> {
  try {
    return await getSession(token);
  } catch {
    return null;
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-8 px-6 py-8">
      <header className="flex items-center justify-between gap-4">
        <p className="flex items-center gap-2 font-mono text-label tracking-wide text-muted-foreground">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-primary" />
          movivo
        </p>
        <ThemeToggle />
      </header>
      <main id="conteudo" className="flex flex-1 flex-col">
        {children}
      </main>
    </div>
  );
}

export default async function AnamneseTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await fetchSession(token);

  if (!session || session.status === 'EXPIRED') {
    return (
      <Shell>
        <div className="flex flex-1 flex-col justify-center gap-4">
          <p className="font-mono text-label text-muted-foreground">link indisponível</p>
          <h1 className="text-h1 font-bold">Não encontramos este cadastro</h1>
          <p className="max-w-prose text-body text-muted-foreground">
            O link pode ter expirado ou estar incorreto. Comece um novo cadastro para continuar.
          </p>
          <a href="/anamnese" className="text-body font-semibold text-foreground underline">
            Começar um novo cadastro
          </a>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <OnboardingWizard token={token} initial={session} />
    </Shell>
  );
}
