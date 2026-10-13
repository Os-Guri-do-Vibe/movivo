'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { getAlertsSummary } from '@/lib/dashboard-api';
import { cn } from '@/lib/utils';

const REFRESH_INTERVAL_MS = 30_000;

/** Conta pendências, não "lidas", pois a supervisão é compartilhada entre a equipe. */
export function AlertsBell() {
  const [open, setOpen] = useState(0);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      setOpen((await getAlertsSummary(signal)).open);
    } catch {
      // O link continua permitindo abrir a aba e tentar novamente; não inventa uma contagem.
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const events = new EventSource('/api/dashboard/queue/events');
    events.addEventListener('queue.updated', () => void refresh());
    const interval = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
      controller.abort();
      events.close();
      window.clearInterval(interval);
    };
  }, [refresh]);

  const label =
    open === 0 ? 'Alertas: nenhum pendente' : `Alertas: ${open} pendente${open === 1 ? '' : 's'}`;
  return (
    <Link
      href="/dashboard/alertas"
      aria-label={label}
      title={label}
      className="relative flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
    >
      <Bell aria-hidden="true" className="size-5" />
      {open > 0 ? (
        <span
          aria-hidden="true"
          className={cn(
            'absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[0.625rem] font-bold text-destructive-foreground',
            open > 99 && 'min-w-6',
          )}
        >
          {open > 99 ? '99+' : open}
        </span>
      ) : null}
    </Link>
  );
}
