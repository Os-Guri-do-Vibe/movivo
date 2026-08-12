'use client';

import {
  BarChart3,
  CircleGauge,
  ClipboardCheck,
  Headphones,
  Landmark,
  LockKeyhole,
  ServerCog,
  Settings,
  ShieldCheck,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  hasAllCapabilities,
  ROLE_LABELS,
  type DashboardCapability,
  type DashboardRole,
} from '@/lib/control-center-access';
import { cn } from '@/lib/utils';

import { LogoutButton } from './logout-button';

export interface DashboardNavigationItem {
  href: string;
  label: string;
  icon: LucideIcon;
  capabilities?: readonly DashboardCapability[];
}

const NAVIGATION: readonly DashboardNavigationItem[] = [
  {
    href: '/dashboard',
    label: 'Visão geral',
    icon: CircleGauge,
    capabilities: ['control_center.overview.read'],
  },
  {
    href: '/dashboard/analytics',
    label: 'Analytics',
    icon: BarChart3,
    capabilities: ['control_center.marketing.read'],
  },
  {
    href: '/dashboard/alunos',
    label: 'Alunos',
    icon: UsersRound,
    capabilities: ['control_center.students.read'],
  },
  {
    href: '/dashboard/educacao-fisica',
    label: 'Educação Física',
    icon: ClipboardCheck,
    capabilities: ['control_center.students.read'],
  },
  {
    href: '/dashboard/sistema',
    label: 'Sistema',
    icon: ServerCog,
    capabilities: ['control_center.system.read'],
  },
  {
    href: '/dashboard/financeiro',
    label: 'Financeiro',
    icon: Landmark,
    capabilities: ['control_center.finance.read'],
  },
  {
    href: '/dashboard/suporte',
    label: 'Suporte',
    icon: Headphones,
    capabilities: ['control_center.support.read'],
  },
  {
    href: '/dashboard/compliance',
    label: 'Compliance',
    icon: LockKeyhole,
    capabilities: ['control_center.compliance.read', 'control_center.audit.read'],
  },
  {
    href: '/dashboard/administracao',
    label: 'Administração',
    icon: Settings,
    capabilities: ['control_center.admin.destructive.request'],
  },
];

export function navigationFor(
  capabilities: readonly DashboardCapability[],
): DashboardNavigationItem[] {
  return NAVIGATION.filter(
    (item) => !item.capabilities || hasAllCapabilities(capabilities, ...item.capabilities),
  );
}

function DashboardNavigation({ capabilities }: { capabilities: readonly DashboardCapability[] }) {
  const pathname = usePathname();
  const items = navigationFor(capabilities);
  return (
    <ul className="grid gap-1.5">
      {items.map(({ href, label, icon: Icon }) => {
        const current = href === '/dashboard' ? pathname === href : pathname.startsWith(href);
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={current ? 'page' : undefined}
              className={cn(
                'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring',
                current
                  ? 'bg-petroleo text-nevoa'
                  : 'text-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <Icon aria-hidden="true" className="size-5" />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function DashboardShell({
  role,
  capabilities,
  children,
}: {
  role: DashboardRole;
  capabilities: readonly DashboardCapability[];
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#conteudo-dashboard"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:ring-[3px] focus:ring-ring"
      >
        Pular para o conteúdo
      </a>
      <header className="border-b border-nevoa/20 bg-petroleo text-nevoa">
        <div className="mx-auto flex max-w-[100rem] items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-verde-pulso text-petroleo"
            >
              <ShieldCheck className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-label font-semibold tracking-wide">
                movivo · control center
              </p>
              <p className="truncate text-xs text-nevoa/80">{ROLE_LABELS[role]}</p>
            </div>
          </div>
          <LogoutButton />
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[100rem] md:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="border-b border-border bg-card md:min-h-[calc(100dvh-65px)] md:border-r md:border-b-0">
          <details className="group md:hidden">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-label font-semibold focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              Acessar setores
              <span aria-hidden="true" className="transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <nav aria-label="Setores do Control Center" className="border-t border-border p-3">
              <DashboardNavigation capabilities={capabilities} />
            </nav>
          </details>
          <nav
            aria-label="Setores do Control Center"
            className="sticky top-0 hidden p-4 md:block md:py-6"
          >
            <DashboardNavigation capabilities={capabilities} />
            <div className="mt-6 rounded-xl border border-border bg-background p-3">
              <p className="text-label font-semibold">Acesso por responsabilidade</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Cada setor mostra somente os dados necessários para este papel. Ações e leituras
                sensíveis são auditadas pelo servidor.
              </p>
            </div>
          </nav>
        </aside>
        <main id="conteudo-dashboard" className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
