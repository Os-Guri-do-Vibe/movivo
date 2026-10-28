'use client';

/**
 * Contagem de casos abertos da fila de exceções (sino do cabeçalho e selo do menu). Um só
 * `fetch` periódico alimenta os dois; falha de rede mantém o último número (nunca zera).
 */
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ExceptionsSummary } from '@movivo/shared';

import { getExceptionsSummary } from '@/lib/control-center-api';

const POLL_MS = 60_000;
const EMPTY: ExceptionsSummary = { open: 0, urgent: 0 };
const Context = createContext<ExceptionsSummary>(EMPTY);

export function ExceptionsSummaryProvider({ children }: { children: ReactNode }) {
  const [summary, setSummary] = useState<ExceptionsSummary>(EMPTY);

  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      getExceptionsSummary(controller.signal)
        .then(setSummary)
        .catch(() => undefined);
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  const value = useMemo(() => summary, [summary]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useExceptionsSummary(): ExceptionsSummary {
  return useContext(Context);
}

export function ExceptionsBell() {
  const { open, urgent } = useExceptionsSummary();
  const label =
    open === 0
      ? 'Fila de exceções, nenhum caso aberto'
      : `Fila de exceções, ${open} caso${open === 1 ? '' : 's'} aberto${open === 1 ? '' : 's'}${urgent > 0 ? `, ${urgent} urgente${urgent === 1 ? '' : 's'}` : ''}`;
  return (
    <Link
      href="/dashboard/fila"
      aria-label={label}
      className="relative flex size-11 items-center justify-center rounded-lg text-foreground hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none lg:size-10"
    >
      <Bell aria-hidden="true" className="size-5" />
      {open > 0 ? (
        <span
          aria-hidden="true"
          className={`absolute top-1 right-1 min-w-5 rounded-full px-1 text-center text-xs font-semibold ${urgent > 0 ? 'bg-coral text-white' : 'bg-accent text-accent-foreground'}`}
        >
          {open > 99 ? '99+' : open}
        </span>
      ) : null}
    </Link>
  );
}
