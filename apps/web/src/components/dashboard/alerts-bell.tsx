'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { alertCopyFor } from '@/lib/alert-copy';
import { getAlerts, getAlertsSummary, getQueue } from '@/lib/dashboard-api';
import type { DashboardAlert, QueueItem } from '@/lib/dashboard-types';
import { cn } from '@/lib/utils';

const REFRESH_INTERVAL_MS = 30_000;

type Notification = {
  id: string;
  title: string;
  detail: string;
  href: string;
  createdAt: string;
};

function queueNotification(item: QueueItem): Notification {
  return {
    id: `queue-${item.kind}-${item.id}`,
    title: item.title,
    detail: item.summary === 'PENDING_SIGNATURE' ? 'Fila do profissional' : item.summary,
    href: `/dashboard/fila/${item.kind.toLowerCase()}/${encodeURIComponent(item.id)}`,
    createdAt: item.createdAt,
  };
}

function alertNotification(alert: DashboardAlert): Notification {
  return {
    id: `alert-${alert.id}`,
    title: alertCopyFor(alert).title,
    detail: `${alert.studentName ?? 'Aluno'} · ${alertCopyFor(alert).detail}`,
    href: `/dashboard/alertas/${encodeURIComponent(alert.id)}`,
    createdAt: alert.createdAt,
  };
}

/** Conta pendências compartilhadas do CREF, não notificações pessoais não lidas. */
export function AlertsBell() {
  const [open, setOpen] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const [alerts, queue] = await Promise.all([getAlertsSummary(signal), getQueue(signal)]);
      setOpen(alerts.open + queue.counts.total);
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
    void Promise.all([getAlerts(), getQueue()])
      .then(([alerts, queue]) => {
        const queueItems = [
          ...queue.mandatory,
          ...queue.optional,
          ...queue.substitutionMandatory,
          ...queue.substitutionOptional,
        ];
        setNotifications(
          [...alerts.open.map(alertNotification), ...queueItems.map(queueNotification)]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 5),
        );
      })
      .catch(() => setNotifications([]));
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
    open === 0
      ? 'Notificações: nenhuma pendente'
      : `Notificações: ${open} pendência${open === 1 ? '' : 's'}`;
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
                  ? 'Nenhuma pendência'
                  : `${open} pendência${open === 1 ? '' : 's'} para acompanhar`}
              </p>
            </div>
          </div>
          {notifications.length === 0 ? (
            <p className="px-3 py-5 text-center text-label text-muted-foreground">
              Nenhuma notificação pendente.
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <Link
                    href={notification.href}
                    onClick={() => setPanelOpen(false)}
                    className="block rounded-lg px-3 py-2.5 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <p className="text-label font-semibold text-foreground">{notification.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {notification.detail}
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
