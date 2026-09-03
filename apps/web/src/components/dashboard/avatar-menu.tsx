'use client';

import { CircleUserRound, MoonIcon, SunIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import * as React from 'react';

import { ROLE_LABELS, type DashboardRole } from '@/lib/control-center-access';
import { cn } from '@/lib/utils';

/** Mesmo aviso que antes acompanhava o badge de papel removido do cabeçalho. */
const ACCESS_NOTICE =
  'Cada setor mostra somente os dados necessários para este papel. Ações e leituras sensíveis são auditadas pelo servidor.';

/**
 * Menu expansível da esfera de avatar do cabeçalho do dashboard: papel, nome da conta,
 * link para "Minha conta" e o alternador de tema (que antes vivia solto no cabeçalho).
 *
 * Não usa `role="menu"`/`menuitem`: o painel mistura texto estático (papel, nome) com
 * ações (link, alternador), o que violaria a semântica ARIA de menu (todo filho
 * precisaria ser um item acionável). Em vez disso é um popover rotulado — trigger com
 * `aria-haspopup`/`aria-expanded`/`aria-controls`, painel navegável por Tab, fecha com
 * Esc ou clique fora e devolve o foco ao gatilho.
 */
export function AvatarMenu({
  role,
  name,
  avatarUrl,
}: {
  role: DashboardRole;
  name: string | null;
  avatarUrl: string | null;
}) {
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelId = React.useId();

  React.useEffect(() => setMounted(true), []);

  const close = React.useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  React.useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') close();
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  const roleLabel = ROLE_LABELS[role];
  const isDark = resolvedTheme === 'dark';
  const themeLabel = mounted ? (isDark ? 'Escuro' : 'Claro') : '—';
  const initials = (name?.trim() || roleLabel).slice(0, 2).toUpperCase();

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        ref={triggerRef}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Menu da conta — ${roleLabel}`}
        title={roleLabel}
        onClick={() => setOpen((value) => !value)}
        className="group -mx-2 -my-1.5 flex items-center gap-3 rounded-full px-2 py-1.5 transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
      >
        <span className="hidden text-label font-semibold whitespace-nowrap text-foreground group-hover:text-accent-foreground sm:inline">
          {name ?? 'Sem nome cadastrado'}
        </span>
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-verde-pulso text-label font-semibold text-petroleo"
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- vem de outra origem (API), fora do domínio otimizado pelo next/image.
            <img src={avatarUrl} alt="" className="size-full object-cover" />
          ) : (
            initials
          )}
        </span>
      </button>

      {open ? (
        <div
          id={panelId}
          aria-label="Menu da conta"
          className="absolute top-[calc(100%+0.5rem)] right-0 z-30 w-64 rounded-lg border border-border bg-card p-1 shadow-lg"
        >
          <div className="px-3 py-2" title={ACCESS_NOTICE}>
            <p className="text-xs font-medium text-muted-foreground">Papel</p>
            <p className="truncate text-label font-semibold text-foreground">{roleLabel}</p>
          </div>
          <div className="px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground">Nome</p>
            <p className="truncate text-label font-semibold text-foreground">
              {name ?? 'Sem nome cadastrado'}
            </p>
          </div>
          <div className="my-1 border-t border-border" />
          <Link
            href="/dashboard/conta"
            onClick={() => setOpen(false)}
            className="flex w-full items-center justify-between rounded-md px-3 py-2.5 text-body font-semibold text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
          >
            <span>Minha conta</span>
            <CircleUserRound aria-hidden="true" className="size-5" />
          </Link>
          <button
            type="button"
            disabled={!mounted}
            aria-label={
              mounted ? (isDark ? 'Ativar tema claro' : 'Ativar tema escuro') : 'Alternar tema'
            }
            aria-pressed={mounted ? isDark : undefined}
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className={cn(
              'flex w-full items-center justify-between rounded-md px-3 py-2.5 text-body font-semibold text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none',
              !mounted && 'opacity-50',
            )}
          >
            <span>Tema: {themeLabel}</span>
            {mounted && isDark ? (
              <SunIcon aria-hidden="true" className="size-5" />
            ) : (
              <MoonIcon aria-hidden="true" className="size-5" />
            )}
          </button>
        </div>
      ) : null}
    </div>
  );
}
