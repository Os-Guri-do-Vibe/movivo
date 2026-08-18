'use client';

import {
  Activity,
  Bot,
  Cable,
  Calculator,
  ChevronDown,
  CircleGauge,
  ClipboardCheck,
  Coins,
  FlaskConical,
  Handshake,
  Landmark,
  LockKeyhole,
  Megaphone,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Repeat,
  ScrollText,
  ServerCog,
  Settings,
  Target,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ThemeToggle } from '@/components/theme-toggle';
import {
  hasAllCapabilities,
  ROLE_LABELS,
  type DashboardCapability,
  type DashboardRole,
} from '@/lib/control-center-access';
import { cn } from '@/lib/utils';

import { LogoutButton } from './logout-button';

export interface DashboardNavigationItem {
  label: string;
  icon: LucideIcon;
  /** Ausente quando a tela ainda não existe — o item vira roadmap, não link. */
  href?: string;
  capabilities?: readonly DashboardCapability[];
  /** Quando a tela chega. Exibido no lugar do link; o fundador vê o roadmap dentro do produto. */
  soon?: string;
}

export interface DashboardNavigationPillar {
  label: string | null;
  items: readonly DashboardNavigationItem[];
}

/**
 * Menu de 5 pilares de decisão + Visão Geral na raiz (US-7.1). Os pilares espelham a
 * pergunta que o fundador faz ao entrar ("quanto entra?", "esse aluno vai cancelar?",
 * "a IA está falando certo?"), não o organograma de quem executa.
 *
 * "Ficha do aluno" não é item de menu: depende de um id e é aberta a partir da Base de
 * alunos (`/dashboard/alunos/[id]`).
 */
const PILLARS: readonly DashboardNavigationPillar[] = [
  {
    label: null,
    items: [
      {
        href: '/dashboard',
        label: 'Visão Geral',
        icon: CircleGauge,
        capabilities: ['control_center.overview.read'],
      },
    ],
  },
  {
    label: 'Alunos',
    items: [
      {
        href: '/dashboard/alunos',
        label: 'Base de Alunos',
        icon: UsersRound,
        capabilities: ['control_center.students.read'],
      },
      {
        // Ex-"Educação Física". Revisão, assinatura, handoff SAFETY e PAR-Q bloqueado
        // são leitura de saúde — por isso exige também `students.health.read`.
        href: '/dashboard/educacao-fisica',
        label: 'Fila do Profissional',
        icon: ClipboardCheck,
        capabilities: ['control_center.students.read', 'control_center.students.health.read'],
      },
      {
        // US-8.3 entregou entryCohorts/trialConversion; a tabela vive dentro de
        // Financeiro (mesmo dado de coorte de receita), não numa tela própria.
        href: '/dashboard/financeiro#coortes',
        label: 'Coortes & Retenção',
        icon: Repeat,
        capabilities: ['control_center.finance.read'],
      },
    ],
  },
  {
    label: 'Financeiro',
    items: [
      {
        href: '/dashboard/financeiro',
        label: 'Receita & Assinaturas',
        icon: Landmark,
        capabilities: ['control_center.finance.read'],
      },
      {
        // US-8.4 entregou costByCategory/costByMonth; a seção vive dentro da
        // mesma tela de Financeiro, não numa rota própria.
        href: '/dashboard/financeiro#custos',
        label: 'Custos',
        icon: Coins,
        capabilities: ['control_center.finance.read'],
      },
      {
        href: '/dashboard/projecao',
        label: 'Resultado & Projeção',
        icon: Calculator,
        capabilities: ['control_center.finance.read'],
      },
      {
        // Cap table e distribuição não são do setor financeiro: exigem
        // `partners.read`, exclusiva do ADMIN. Quem é FINANCE não vê o item.
        href: '/dashboard/socios',
        label: 'Sócios & Distribuição',
        icon: Handshake,
        capabilities: ['control_center.partners.read'],
      },
    ],
  },
  {
    label: 'Marketing',
    items: [
      {
        // US-8.8: aquisição por canal, CAC, ROAS e LTV/CAC viraram número na US-8.6 e
        // saem na mesma tela do funil de conversão — os dois itens viraram um só, com
        // link, no lugar de um item de roadmap ao lado de outro já entregue.
        href: '/dashboard/analytics',
        label: 'Aquisição & Canais',
        icon: Megaphone,
        capabilities: ['control_center.marketing.read'],
      },
      {
        // "Público agregado" (segments por objetivo/local/período/faixa etária) já
        // existe desde a Sprint 7 na mesma tela de Aquisição & Canais.
        href: '/dashboard/analytics#publico-agregado',
        label: 'Perfil de Clientes',
        icon: Target,
        capabilities: ['control_center.marketing.read'],
      },
      {
        href: '/dashboard/campanhas',
        label: 'Campanhas & Experimentos',
        icon: FlaskConical,
        capabilities: ['control_center.marketing.read'],
      },
    ],
  },
  {
    label: 'IA',
    items: [
      {
        // Persona, Regras invioláveis, Conhecimento (RAG) e FAQ viraram etapas de um
        // único painel — cada etapa continua publicando e auditando sua própria
        // configuração, só a navegação foi unificada.
        href: '/dashboard/ia/agente',
        label: 'Agente',
        icon: Bot,
        capabilities: ['control_center.ai.config.read'],
      },
    ],
  },
  {
    label: 'Sistema',
    items: [
      {
        href: '/dashboard/sistema',
        label: 'Saúde & Disponibilidade',
        icon: ServerCog,
        capabilities: ['control_center.system.read'],
      },
      {
        // A tela de operações inclui replay de conversa do aluno, então continua sob
        // `students.read` até a US-7.5 separar a visão puramente de fila/job.
        href: '/dashboard/operacoes',
        label: 'Filas & Jobs',
        icon: Activity,
        capabilities: ['control_center.students.read'],
      },
      {
        href: '/dashboard/compliance',
        label: 'Compliance & Privacidade',
        icon: LockKeyhole,
        capabilities: ['control_center.compliance.read', 'control_center.audit.read'],
      },
      {
        href: '/dashboard/sistema/auditoria',
        label: 'Auditoria',
        icon: ScrollText,
        capabilities: ['control_center.audit.read'],
      },
      {
        // Ferramenta INTERNA de teste do fluxo de WhatsApp via EvolutionAPI (QR Code) —
        // não é o canal de produção dos usuários finais. Reusa `system.read` (mesma
        // capability da "Saúde & Disponibilidade", ao lado): é literalmente uma operação
        // de sistema, não uma capacidade própria.
        href: '/dashboard/sistema/integracao',
        label: 'Integração',
        icon: Cable,
        capabilities: ['control_center.system.read'],
      },
      {
        href: '/dashboard/administracao',
        label: 'Administração',
        icon: Settings,
        capabilities: ['control_center.admin.destructive.request'],
      },
    ],
  },
];

const NAVIGATION: readonly DashboardNavigationItem[] = PILLARS.flatMap((pillar) => pillar.items);

function isAllowed(
  item: DashboardNavigationItem,
  capabilities: readonly DashboardCapability[],
): boolean {
  return !item.capabilities || hasAllCapabilities(capabilities, ...item.capabilities);
}

export function navigationFor(
  capabilities: readonly DashboardCapability[],
): DashboardNavigationItem[] {
  return NAVIGATION.filter((item) => isAllowed(item, capabilities));
}

/** Pilar sem nenhum item autorizado não renderiza nem o próprio título. */
export function navigationGroupsFor(capabilities: readonly DashboardCapability[]) {
  return PILLARS.map((pillar) => ({
    label: pillar.label,
    items: pillar.items.filter((item) => isAllowed(item, capabilities)),
  })).filter((pillar) => pillar.items.length > 0);
}

function isCurrent(pathname: string, href: string): boolean {
  return href === '/dashboard' ? pathname === href : pathname.startsWith(href);
}

function activeItemFor(pathname: string): DashboardNavigationItem | undefined {
  // O item mais específico vence: /dashboard/operacoes antes de /dashboard.
  return NAVIGATION.filter(
    (item): item is DashboardNavigationItem & { href: string } => item.href !== undefined,
  )
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => isCurrent(pathname, item.href));
}

/** Rótulo do pilar (grupo com nome) que contém a rota atual, para abrir a categoria certa. */
function activeGroupFor(pathname: string): string | null {
  const active = activeItemFor(pathname);
  if (!active) return null;
  const pillar = PILLARS.find((p) => p.items.some((item) => item.label === active.label));
  return pillar?.label ?? null;
}

function DashboardNavigation({
  capabilities,
  collapsed,
  onNavigate,
}: {
  capabilities: readonly DashboardCapability[];
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const activeGroup = activeGroupFor(pathname);
  // Só a categoria da rota atual começa aberta — evita que a barra precise de
  // scroll com os 5 pilares + Visão Geral abertos ao mesmo tempo.
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(
    () => new Set(activeGroup ? [activeGroup] : []),
  );
  useEffect(() => {
    if (activeGroup) setOpenGroups((prev) => new Set(prev).add(activeGroup));
  }, [activeGroup]);
  const toggleGroup = useCallback((label: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  return (
    <div className="grid gap-1">
      {navigationGroupsFor(capabilities).map((group, index) => {
        const groupLabel = group.label;
        const isOpen = !groupLabel || collapsed || openGroups.has(groupLabel);
        return (
          <div key={groupLabel ?? 'principal'}>
            {groupLabel ? (
              collapsed ? (
                <hr
                  aria-hidden="true"
                  className="mx-2 my-3 border-t border-[var(--petroleo-borda)]/40"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => toggleGroup(groupLabel)}
                  aria-expanded={isOpen}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-3 py-1.5 text-[0.6875rem] font-semibold tracking-[0.14em] uppercase text-[var(--nevoa-suave)] transition-colors hover:text-nevoa focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none',
                    index > 0 && 'mt-4',
                  )}
                >
                  {groupLabel}
                  <ChevronDown
                    aria-hidden="true"
                    className={cn('size-3.5 shrink-0 transition-transform', isOpen && 'rotate-180')}
                  />
                </button>
              )
            ) : null}
            {isOpen ? (
              <ul className={cn('grid gap-1.5', groupLabel && !collapsed && 'mt-1')}>
                {group.items.map(({ href, label, icon: Icon, soon }) => {
                  if (!href) {
                    // Roadmap: item presente, sem link e sem controle desabilitado.
                    return (
                      <li key={label}>
                        <div
                          className={cn(
                            'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-label text-[var(--nevoa-suave)]/70',
                            collapsed && 'justify-center px-0',
                          )}
                        >
                          <Icon aria-hidden="true" className="size-5 shrink-0" />
                          <span className={collapsed ? 'sr-only' : undefined}>{label}</span>
                          <span
                            className={cn(
                              'ml-auto rounded-full border border-[var(--petroleo-borda)] px-2 py-0.5 text-[0.625rem] font-semibold whitespace-nowrap',
                              collapsed && 'sr-only',
                            )}
                          >
                            Em breve · {soon}
                          </span>
                        </div>
                      </li>
                    );
                  }
                  const current = isCurrent(pathname, href);
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        aria-current={current ? 'page' : undefined}
                        aria-label={label}
                        onClick={onNavigate}
                        className={cn(
                          'flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-label font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none',
                          collapsed && 'justify-center px-0',
                          current
                            ? 'bg-[var(--petroleo-superficie)] font-semibold text-verde-pulso'
                            : 'text-[var(--nevoa-suave)] hover:bg-[var(--petroleo-superficie)] hover:text-nevoa',
                        )}
                      >
                        <Icon aria-hidden="true" className="size-5 shrink-0" />
                        <span className={collapsed ? 'sr-only' : undefined}>{label}</span>
                        {soon && !collapsed ? (
                          // Tela existe, mas só explica o que virá — o roadmap continua visível.
                          <span className="ml-auto rounded-full border border-[var(--petroleo-borda)] px-2 py-0.5 text-[0.625rem] font-semibold whitespace-nowrap">
                            Em breve · {soon}
                          </span>
                        ) : current && !collapsed ? (
                          <span
                            aria-hidden="true"
                            className="ml-auto size-1.5 rounded-full bg-verde-pulso"
                          />
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

const ACCESS_NOTICE =
  'Cada setor mostra somente os dados necessários para este papel. Ações e leituras sensíveis são auditadas pelo servidor.';

function PulsoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn('size-9 shrink-0', className)}>
      <rect width="64" height="64" rx="14" fill="#06302A" />
      <path
        d="M11 38 L19 30 L26 41 L36 17 L43 27"
        fill="none"
        stroke="#25E27E"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="51" cy="22" r="4.5" fill="#25E27E" />
    </svg>
  );
}

function SidebarBody({
  capabilities,
  collapsed,
  onToggleCollapse,
  onNavigate,
}: {
  capabilities: readonly DashboardCapability[];
  collapsed: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div
        className={cn(
          'flex h-16 shrink-0 items-center justify-center gap-3 border-b border-[var(--petroleo-borda)]/40 p-4',
          collapsed && 'px-0',
        )}
      >
        {collapsed ? (
          <PulsoMark />
        ) : (
          <Image
            src="/brand/movivo-logo-horizontal.svg"
            alt="MOVIVO"
            width={176}
            height={46}
            unoptimized
            className="h-auto w-36"
          />
        )}
      </div>
      <nav
        aria-label="Setores do Control Center"
        className="sidebar-scrollbar flex-1 overflow-y-auto px-3 pt-3 pb-4"
      >
        <DashboardNavigation
          capabilities={capabilities}
          collapsed={collapsed}
          onNavigate={onNavigate}
        />
      </nav>
      <div className="mt-auto border-t border-[var(--petroleo-borda)]/40 p-3">
        {onToggleCollapse ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-pressed={collapsed}
            aria-label={collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
            className={cn(
              'mt-1 flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-label font-medium text-[var(--nevoa-suave)] transition-colors hover:bg-[var(--petroleo-superficie)] hover:text-nevoa focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none',
              collapsed && 'justify-center px-0',
            )}
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" className="size-5 shrink-0" />
            ) : (
              <PanelLeftClose aria-hidden="true" className="size-5 shrink-0" />
            )}
            {collapsed ? null : 'Recolher'}
          </button>
        ) : null}
      </div>
    </>
  );
}

const COLLAPSE_KEY = 'movivo.sidebar.collapsed';

function useCollapsedSidebar() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      // Armazenamento indisponível (modo privativo): a barra fica expandida.
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((previous) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, previous ? '0' : '1');
      } catch {
        // Sem persistência: o estado ainda vale para esta sessão.
      }
      return !previous;
    });
  }, []);

  return { collapsed, toggle };
}

function MobileDrawer({
  capabilities,
  open,
  onClose,
}: {
  capabilities: readonly DashboardCapability[];
  open: boolean;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('a, button')?.focus();
  }, [open]);

  function trapFocus(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panel.current) return;
    const focusable = panel.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !panel.current.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!open) return null;

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label="Fechar menu"
        onClick={onClose}
        className="fixed inset-0 z-30 bg-petroleo/60"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Setores do Control Center"
        onKeyDown={trapFocus}
        className="fixed inset-y-0 left-0 z-40 flex w-[min(85vw,17rem)] flex-col bg-petroleo text-nevoa transition-transform duration-200 ease-out"
      >
        <div className="flex justify-end p-2">
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={onClose}
            className="flex size-11 items-center justify-center rounded-lg text-[var(--nevoa-suave)] hover:bg-[var(--petroleo-superficie)] hover:text-nevoa focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        <SidebarBody capabilities={capabilities} collapsed={false} onNavigate={onClose} />
      </div>
    </div>
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
  const pathname = usePathname();
  const { collapsed, toggle } = useCollapsedSidebar();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const active = activeItemFor(pathname);
  const ActiveIcon = active?.icon;

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    menuButton.current?.focus();
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#conteudo-dashboard"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:ring-[3px] focus:ring-ring"
      >
        Pular para o conteúdo
      </a>

      <div className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-[var(--petroleo-borda)]/40 bg-petroleo px-3 md:hidden">
        <button
          type="button"
          ref={menuButton}
          aria-label="Abrir menu"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
          className="flex size-11 items-center justify-center rounded-lg text-nevoa hover:bg-[var(--petroleo-superficie)] focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none"
        >
          <Menu aria-hidden="true" className="size-5" />
        </button>
        <PulsoMark className="size-8" />
        <ThemeToggle />
      </div>
      <MobileDrawer capabilities={capabilities} open={drawerOpen} onClose={closeDrawer} />

      <aside
        className={cn(
          'hidden border-r border-[var(--petroleo-borda)]/40 bg-petroleo text-nevoa transition-[width] duration-200 md:fixed md:inset-y-0 md:left-0 md:z-30 md:flex md:h-dvh md:flex-col',
          collapsed ? 'md:w-18' : 'md:w-68',
        )}
      >
        <SidebarBody capabilities={capabilities} collapsed={collapsed} onToggleCollapse={toggle} />
      </aside>

      <div
        className={cn(
          'flex min-w-0 flex-col transition-[margin] duration-200',
          collapsed ? 'md:ml-18' : 'md:ml-68',
        )}
      >
        <header className="sticky top-14 z-20 flex h-16 items-center justify-between gap-3 border-b border-border bg-background/80 px-4 backdrop-blur md:top-0 lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            {ActiveIcon ? (
              <ActiveIcon aria-hidden="true" className="size-5 text-verde-pulso" />
            ) : null}
            <p className="truncate text-h3 font-bold text-foreground">
              {active?.label ?? 'Control Center'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              title={ACCESS_NOTICE}
              className="hidden rounded-full border border-verde-pulso/40 bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground sm:inline"
            >
              {ROLE_LABELS[role]}
            </span>
            <div className="hidden md:block">
              <ThemeToggle />
            </div>
            <span
              aria-hidden="true"
              title={ROLE_LABELS[role]}
              className="flex size-9 items-center justify-center rounded-full bg-verde-pulso text-label font-semibold text-petroleo"
            >
              {role.slice(0, 2)}
            </span>
            <LogoutButton />
          </div>
        </header>
        <main id="conteudo-dashboard" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
