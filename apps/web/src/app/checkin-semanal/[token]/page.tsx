import type { Metadata } from 'next';
import Image from 'next/image';

import { WeeklyCheckinClient } from '@/components/checkin-weekly/weekly-checkin-client';
import { WeeklyCheckinSuccessScreen } from '@/components/checkin-weekly/success-screen';
import { getCheckinWeeklySession, type CheckinWeeklySessionView } from '@/lib/checkin-weekly-api';

/**
 * Formulário de check-in semanal (achado 2026-09-13) — RSC que busca a sessão no servidor,
 * mesmo padrão de `/mesociclo/[token]`. Diferente da renovação, não há retomada por etapa:
 * o formulário é respondido numa única visita e enviado de uma vez.
 */
export const metadata: Metadata = {
  title: { absolute: 'Movivo - Check-in Semanal' },
  robots: { index: false },
};

async function fetchSession(token: string): Promise<CheckinWeeklySessionView | null> {
  try {
    return await getCheckinWeeklySession(token);
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

function NotFoundScreen() {
  return (
    <div className="flex flex-1 flex-col justify-center gap-4">
      <p className="font-mono text-label text-muted-foreground">link indisponível</p>
      <h1 className="text-h1 font-bold">Não encontramos este check-in</h1>
      <p className="max-w-prose text-body text-muted-foreground">
        O link pode estar incorreto. Abra o link mais recente enviado no seu WhatsApp, ou fale com a
        gente por lá para pedir um novo.
      </p>
    </div>
  );
}

function ExpiredScreen() {
  return (
    <div className="flex flex-1 flex-col justify-center gap-4">
      <p className="font-mono text-label text-muted-foreground">link expirado</p>
      <h1 className="text-h1 font-bold">Este check-in expirou</h1>
      <p className="max-w-prose text-body text-muted-foreground">
        O prazo deste link já passou. Fale com a gente pelo WhatsApp da MOVIVO para receber um novo
        link de check-in semanal.
      </p>
    </div>
  );
}

export default async function CheckinSemanalTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const session = await fetchSession(token);

  if (!session) {
    return (
      <Shell>
        <NotFoundScreen />
      </Shell>
    );
  }

  if (session.status === 'EXPIRED') {
    return (
      <Shell>
        <ExpiredScreen />
      </Shell>
    );
  }

  if (session.status === 'SUBMITTED') {
    return (
      <Shell>
        <WeeklyCheckinSuccessScreen name={session.firstName?.trim() || 'você'} />
      </Shell>
    );
  }

  return (
    <Shell>
      <WeeklyCheckinClient token={token} firstName={session.firstName} />
    </Shell>
  );
}
