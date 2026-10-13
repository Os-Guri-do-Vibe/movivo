'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { alertCopyFor } from '@/lib/alert-copy';
import { getAlerts, getAlertsSummary } from '@/lib/dashboard-api';
import type { DashboardAlert } from '@/lib/dashboard-types';
import { cn } from '@/lib/utils';

const REFRESH_INTERVAL_MS = 30_000;

/** Conta pendências, não "lidas", pois a supervisão é compartilhada entre a equipe. */
export function AlertsBell() {
  const [open, setOpen] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [alerts, setAlerts] = useState<DashboardAlert[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
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

  useEffect(() => {
    if (!panelOpen) return;
    void getAlerts()
      .then((data) => setAlerts(data.open.slice(0, 5)))
      .catch(() => setAlerts([]));
  }, [panelOpen]);

  useEffect(() => {
    if (!panelOpen) return;
    function closeWhenOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setPanelOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setPanelOpen(false);
    }
    document.addEventListener('pointerdown', closeWhenOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeWhenOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [panelOpen]);

  const label =
    open === 0 ? 'Alertas: nenhum pendente' : `Alertas: ${open} pendente${open === 1 ? '' : 's'}`;
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={panelOpen}
        aria-controls={panelId}
        aria-label={label}
        title={label}
        onClick={() => setPanelOpen((value) => !value)}
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
      </button>
      {panelOpen ? (
        <section
          id={panelId}
          role="dialog"
          aria-label="Notificações do AI Coach"
          className="absolute top-[calc(100%+0.5rem)] right-0 z-30 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-2 shadow-lg"
        >
          <div className="flex items-center justify-between px-3 py-2">
            <div>
              <h2 className="text-label font-semibold text-foreground">Notificações</h2>
              <p className="text-xs text-muted-foreground">
                {open === 0
                  ? 'Nenhuma intervenção pendente'
                  : `${open} intervenção${open === 1 ? '' : 'ões'} pendente${open === 1 ? '' : 's'}`}
              </p>
            </div>
          </div>
          {alerts.length === 0 ? (
            <p className="px-3 py-5 text-center text-label text-muted-foreground">
              Nenhuma notificação pendente.
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {alerts.map((alert) => (
                <li key={alert.id}>
                  <Link
                    href={`/dashboard/alertas/${encodeURIComponent(alert.id)}`}
                    onClick={() => setPanelOpen(false)}
                    className="block rounded-lg px-3 py-2.5 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <p className="text-label font-semibold text-foreground">
                      {alertCopyFor(alert).title}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {alert.studentName ?? 'Aluno'} · {alertCopyFor(alert).detail}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/dashboard/alertas"
            onClick={() => setPanelOpen(false)}
            className="mt-1 block rounded-lg border-t border-border px-3 py-2.5 text-center text-label font-semibold text-foreground hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
          >
            Ver todos os alertas
          </Link>
        </section>
      ) : null}
    </div>
  );
}
