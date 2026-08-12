import type { Metadata } from 'next';
import Image from 'next/image';

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
    <div className="onboarding-light flex min-h-dvh w-full flex-col overflow-x-hidden bg-white text-foreground">
      <header className="w-full bg-petroleo" aria-label="MOVIVO">
        <div className="mx-auto flex h-[72px] w-full max-w-[640px] items-center justify-center px-5 sm:h-20 sm:px-8">
          <Image
            src="/brand/movivo-logo-horizontal.svg"
            alt="MOVIVO"
            width={176}
            height={46}
            preload
            unoptimized
            className="h-auto w-[154px] sm:w-44"
          />
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-[640px] flex-1 flex-col px-5 pb-6 pt-6 sm:px-8 sm:pb-8 sm:pt-8">
        <main id="conteudo" className="flex flex-1 flex-col">
          {children}
        </main>
        <footer className="mt-8 border-t border-border pt-4 text-center">
          <a
            href="https://icons8.com"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground underline decoration-transparent underline-offset-4 transition-colors hover:text-petroleo hover:decoration-current focus-visible:text-petroleo focus-visible:decoration-current"
          >
            Ícones por Icons8
          </a>
        </footer>
      </div>
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
