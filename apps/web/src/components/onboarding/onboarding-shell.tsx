import Image from 'next/image';

/** Casca clara do onboarding: faixa petróleo com a marca, coluna de 640px e crédito Icons8. */
export function OnboardingShell({ children }: { children: React.ReactNode }) {
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
