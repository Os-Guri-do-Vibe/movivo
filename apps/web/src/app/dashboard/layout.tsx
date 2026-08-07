import { ChartNoAxesCombined, ListChecks, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { LogoutButton } from '@/components/dashboard/logout-button';

import { requireDashboardRole } from './_lib/session';

export const metadata: Metadata = {
  title: 'Supervisão CREF',
  robots: { index: false, follow: false, nocache: true },
};

const NAVIGATION = [
  { href: '/dashboard', label: 'Fila de supervisão', icon: ListChecks },
  { href: '/dashboard/operacoes', label: 'Operações', icon: ChartNoAxesCombined },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireDashboardRole();

  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#conteudo-dashboard"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:ring-[3px] focus:ring-ring"
      >
        Pular para o conteúdo
      </a>
      <header className="border-b border-border bg-petroleo text-nevoa">
        <div className="mx-auto flex max-w-[96rem] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-verde-pulso text-petroleo"
            >
              <ShieldCheck className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-label font-semibold tracking-wide">movivo · operações</p>
              <p className="truncate font-mono text-xs text-nevoa/80">
                Área profissional CREF · Profissional
              </p>
            </div>
          </div>
          <LogoutButton />
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[96rem] md:grid-cols-[16rem_minmax(0,1fr)]">
        <nav
          aria-label="Navegação do dashboard"
          className="border-b border-border bg-card px-3 py-3 md:min-h-[calc(100dvh-65px)] md:border-r md:border-b-0 md:px-4 md:py-6"
        >
          <ul className="flex gap-2 overflow-x-auto md:flex-col">
            {NAVIGATION.map(({ href, label, icon: Icon }) => (
              <li key={href} className="shrink-0 md:w-full">
                <Link
                  href={href}
                  className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-label font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
                >
                  <Icon aria-hidden="true" className="size-5" />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-6 hidden rounded-lg border border-border bg-background p-3 md:block">
            <p className="text-label font-semibold">Supervisão humana ativa</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              O profissional CREF decide liberações e mudanças. A IA atua como ferramenta de apoio.
            </p>
          </div>
        </nav>
        <main id="conteudo-dashboard" className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
