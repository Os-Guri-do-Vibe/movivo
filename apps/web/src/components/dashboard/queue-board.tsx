'use client';

import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { captureDashboardEvent, getQueue } from '@/lib/dashboard-api';
import type { QueueItem, QueueResponse, QueueSeverity } from '@/lib/dashboard-types';
import { cn } from '@/lib/utils';

const PRIORITY: Record<QueueSeverity, number> = { SAFETY: 0, ALERT: 1, ROUTINE: 2 };
const FALLBACK_INTERVAL_MS = 30_000;
const LABELS = {
  SAFETY: { label: 'Segurança · ação prioritária', icon: ShieldAlert },
  ALERT: { label: 'Atenção', icon: AlertTriangle },
  ROUTINE: { label: 'Revisão de rotina', icon: Clock3 },
} as const;

export function sortQueue(items: QueueItem[]): QueueItem[] {
  return [...items].sort(
    (a, b) => PRIORITY[a.severity] - PRIORITY[b.severity] || b.ageMinutes - a.ageMinutes,
  );
}

function formatAge(minutes: number): string {
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${Math.floor(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.floor(hours / 24)} d`;
}

function QueueCard({ item }: { item: QueueItem }) {
  const { label, icon: Icon } = LABELS[item.severity];
  return (
    <li>
      <Link
        href={`/dashboard/fila/${item.kind.toLowerCase()}/${encodeURIComponent(item.id)}`}
        onClick={() =>
          captureDashboardEvent('cref_queue_item_opened', {
            kind: item.kind,
            severity: item.severity,
          })
        }
        className={cn(
          'group block rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring sm:p-5',
          item.severity === 'SAFETY' ? 'border-coral border-l-4' : 'border-border',
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
                  item.severity === 'SAFETY'
                    ? 'bg-destructive text-destructive-foreground'
                    : item.severity === 'ALERT'
                      ? 'bg-secondary text-secondary-foreground'
                      : 'bg-accent text-accent-foreground',
                )}
              >
                <Icon aria-hidden="true" className="size-4" />
                {label}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {formatAge(item.ageMinutes)}
              </span>
            </div>
            <h2 className="text-h3 font-semibold group-hover:underline group-hover:underline-offset-4">
              {item.title}
            </h2>
            {item.summary ? (
              <p className="mt-1 max-w-3xl text-body text-muted-foreground">{item.summary}</p>
            ) : null}
          </div>
          <span className="rounded-md border border-border px-2 py-1 font-mono text-xs text-muted-foreground">
            {item.status}
          </span>
        </div>
      </Link>
    </li>
  );
}

export function QueueBoard() {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [liveStatus, setLiveStatus] = useState<'CONNECTING' | 'CONNECTED' | 'DEGRADED'>(
    'CONNECTING',
  );
  const knownIds = useRef(new Set<string>());

  const load = useCallback(async (initial = false, signal?: AbortSignal) => {
    if (!initial) setRefreshing(true);
    setError('');
    try {
      const next = await getQueue(signal);
      const newItems = next.items.filter((item) => !knownIds.current.has(item.id));
      if (knownIds.current.size > 0 && newItems.length > 0) {
        const safety = newItems.filter((item) => item.severity === 'SAFETY').length;
        setAnnouncement(
          safety > 0
            ? `${newItems.length} novo(s) item(ns), ${safety} de segurança prioritária.`
            : `${newItems.length} novo(s) item(ns) na fila.`,
        );
      }
      knownIds.current = new Set(next.items.map((item) => item.id));
      setData(next);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar a fila.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let fallbackInterval: number | undefined;
    let events: EventSource | undefined;
    let disposed = false;

    const pollWhenVisible = () => {
      if (document.visibilityState === 'visible') void load(false);
    };
    const startFallback = () => {
      if (disposed) return;
      setLiveStatus('DEGRADED');
      fallbackInterval ??= window.setInterval(pollWhenVisible, FALLBACK_INTERVAL_MS);
    };
    const stopFallback = () => {
      if (fallbackInterval !== undefined) window.clearInterval(fallbackInterval);
      fallbackInterval = undefined;
    };

    void load(true, controller.signal);

    if (typeof EventSource === 'undefined') {
      startFallback();
    } else {
      events = new EventSource('/api/dashboard/queue/events');
      events.onopen = () => {
        if (disposed) return;
        stopFallback();
        setLiveStatus('CONNECTED');
      };
      events.addEventListener('queue.updated', pollWhenVisible);
      events.onerror = startFallback;
    }

    document.addEventListener('visibilitychange', pollWhenVisible);
    return () => {
      disposed = true;
      controller.abort();
      events?.close();
      stopFallback();
      document.removeEventListener('visibilitychange', pollWhenVisible);
    };
  }, [load]);

  const items = data ? sortQueue(data.items) : [];

  if (!data && !error) {
    return (
      <div role="status" aria-label="Carregando fila" className="space-y-3">
        {[0, 1, 2].map((key) => (
          <div key={key} className="h-32 animate-pulse rounded-xl border border-border bg-card" />
        ))}
      </div>
    );
  }

  if (!data && error) {
    return (
      <section role="alert" className="rounded-xl border border-coral bg-card p-6">
        <h2 className="text-h3 font-semibold">A fila não carregou</h2>
        <p className="mt-2 text-body text-muted-foreground">{error}</p>
        <Button className="mt-4" type="button" onClick={() => void load(true)}>
          <RefreshCw aria-hidden="true" /> Tentar novamente
        </Button>
      </section>
    );
  }

  return (
    <section aria-labelledby="queue-title">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 id="queue-title" className="text-h1 font-bold">
              Fila de supervisão
            </h1>
            <span className="rounded-full bg-petroleo px-2.5 py-1 font-mono text-xs text-nevoa">
              {items.length}
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-body text-muted-foreground">
            Casos de segurança aparecem primeiro. Revise o contexto antes de editar, assinar ou
            liberar.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={refreshing}>
          <RefreshCw aria-hidden="true" className={refreshing ? 'animate-spin' : undefined} />
          {refreshing ? 'Atualizando…' : 'Atualizar fila'}
        </Button>
      </div>

      <p
        className="mb-4 flex items-center gap-2 text-xs text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        <CheckCircle2 aria-hidden="true" className="size-4" />
        {liveStatus === 'CONNECTED'
          ? 'Atualização em tempo real ativa.'
          : liveStatus === 'CONNECTING'
            ? 'Conectando à atualização em tempo real.'
            : 'Tempo real em reconexão. Contingência a cada 30 segundos enquanto esta aba está visível.'}
      </p>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-destructive p-3 text-label text-destructive-foreground"
        >
          A última atualização falhou: {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-input bg-card px-6 py-12 text-center">
          <CheckCircle2 aria-hidden="true" className="mx-auto size-10 text-muted-foreground" />
          <h2 className="mt-4 text-h3 font-semibold">Fila em dia</h2>
          <p className="mt-2 text-body text-muted-foreground">
            Não há revisões, handoffs ou liberações PAR-Q pendentes agora.
          </p>
        </div>
      ) : (
        <ol className="space-y-3" aria-label="Itens pendentes por prioridade">
          {items.map((item) => (
            <QueueCard key={`${item.kind}:${item.id}`} item={item} />
          ))}
        </ol>
      )}
    </section>
  );
}
