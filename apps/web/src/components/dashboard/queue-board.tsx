'use client';

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ClipboardCheck,
  Eye,
  Pencil,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AnamnesisAnswersModal } from '@/components/dashboard/protocol-anamnesis-answers';
import { Button, buttonVariants } from '@/components/ui/button';
import { captureDashboardEvent, getQueue } from '@/lib/dashboard-api';
import type { QueueItem, QueueResponse } from '@/lib/dashboard-types';
import { cn } from '@/lib/utils';

const FALLBACK_INTERVAL_MS = 30_000;
const LABELS = {
  SAFETY: { label: 'Segurança · ação prioritária', icon: ShieldAlert },
  ALERT: { label: 'Atenção', icon: AlertTriangle },
  ROUTINE: { label: 'Revisão de rotina', icon: ClipboardCheck },
} as const;

/** Cada categoria da fila do profissional ordena só por idade — mais antigo primeiro. */
export function sortQueue(items: QueueItem[]): QueueItem[] {
  return [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * `PENDING_SIGNATURE` é o status de praticamente todo item desta fila (é o motivo
 * dele estar aqui) — exibi-lo é ruído, não informação. Outros valores (ex.: o
 * `BLOCKED` do PAR-Q) continuam aparecendo normalmente.
 *
 * Exportada (achado 2026-08-18): `DashboardService.item()` no backend sempre grava
 * `summary = status` — `queue-detail.tsx` reusa o mesmo filtro pro cabeçalho da tela de
 * revisão, que renderizava `item.summary` cru e mostrava "PENDING_SIGNATURE" como se
 * fosse uma descrição do protocolo.
 */
export function meaningfulText(value: string): string {
  return value === 'PENDING_SIGNATURE' ? '' : value;
}

function iconLinkClass(): string {
  return cn(buttonVariants({ variant: 'ghost', size: 'icon' }));
}

/**
 * Protocolo gerado pela IA e ainda não assinado dispara sozinho 1h após criado
 * (`PROTOCOL_OPTIONAL_REVIEW_WINDOW_MS`, `protocol-generation.worker.ts`) — aprovado
 * e enviado ao WhatsApp automaticamente se o CREF não agir antes. Só existe pra
 * protocolos `OPTIONAL` (é o único caso com job de auto-liberação agendado).
 */
function formatAutoRelease(autoReleaseAt: string): string {
  const minutesLeft = Math.round((new Date(autoReleaseAt).getTime() - Date.now()) / 60_000);
  if (minutesLeft <= 0) return 'Disparando automaticamente para o WhatsApp…';
  const when = minutesLeft < 60 ? `${minutesLeft} min` : `${Math.round(minutesLeft / 60)} h`;
  return `Dispara automaticamente pro WhatsApp em ${when} se ninguém agir antes`;
}

function QueueCard({ item }: { item: QueueItem }) {
  const { label, icon: Icon } = LABELS[item.severity];
  const detailHref = `/dashboard/fila/${item.kind.toLowerCase()}/${encodeURIComponent(item.id)}`;
  const status = meaningfulText(item.status);
  const summary = meaningfulText(item.summary);
  const [anamnesisOpen, setAnamnesisOpen] = useState(false);
  // Olho aparece nas duas caixas da fila (achado 2026-08-18) — só não existe pra
  // handoff/check-in, que nem aparecem nesta tela (ver docstring de `queue()` no backend).
  const showEye = item.kind === 'PROTOCOL' || item.kind === 'PARQ';

  function track(view?: 'anamnesis') {
    captureDashboardEvent('cref_queue_item_opened', {
      kind: item.kind,
      severity: item.severity,
      ...(view ? { view } : {}),
    });
  }

  return (
    <li
      className={cn(
        'rounded-xl border bg-card p-3 text-card-foreground shadow-sm sm:p-4',
        item.severity === 'SAFETY' ? 'border-coral border-l-4' : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-full',
              item.severity === 'SAFETY'
                ? 'bg-destructive text-destructive-foreground'
                : item.severity === 'ALERT'
                  ? 'bg-secondary text-secondary-foreground'
                  : 'bg-accent text-accent-foreground',
            )}
          >
            <Icon aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-h3 font-semibold">{item.title}</h3>
              {item.severity !== 'ROUTINE' ? (
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground">
                  {label}
                </span>
              ) : null}
            </div>
            {summary ? (
              <p className="mt-1 max-w-3xl text-body text-muted-foreground">{summary}</p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-mono text-xs text-muted-foreground">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-verde-pulso" />
              {status}
            </span>
          ) : null}
          {showEye ? (
            <button
              type="button"
              onClick={() => {
                track('anamnesis');
                setAnamnesisOpen(true);
              }}
              className={iconLinkClass()}
              aria-label="Ver respostas da anamnese"
              title="Ver respostas da anamnese"
            >
              <Eye aria-hidden="true" />
            </button>
          ) : null}
          <Link
            href={detailHref}
            onClick={() => track()}
            className={iconLinkClass()}
            aria-label={item.kind === 'PROTOCOL' ? 'Abrir protocolo' : 'Abrir caso'}
            title={item.kind === 'PROTOCOL' ? 'Abrir protocolo' : 'Abrir caso'}
          >
            <Pencil aria-hidden="true" />
          </Link>
          {item.autoReleaseAt ? (
            <span className="group relative inline-flex">
              <button
                type="button"
                className={cn(iconLinkClass(), 'cursor-default hover:bg-transparent')}
                aria-label={formatAutoRelease(item.autoReleaseAt)}
              >
                <Clock aria-hidden="true" />
              </button>
              <span
                role="tooltip"
                className="pointer-events-none absolute bottom-full right-0 z-10 mb-2 w-max max-w-64 rounded-lg bg-popover px-3 py-1.5 text-xs text-popover-foreground opacity-0 shadow-md ring-1 ring-border transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
              >
                {formatAutoRelease(item.autoReleaseAt)}
              </span>
            </span>
          ) : null}
        </div>
      </div>
      {showEye ? (
        <AnamnesisAnswersModal
          kind={item.kind === 'PROTOCOL' ? 'PROTOCOL' : 'PARQ'}
          id={item.id}
          open={anamnesisOpen}
          onOpenChange={setAnamnesisOpen}
        />
      ) : null}
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
      const allItems = [...next.mandatory, ...next.optional];
      const newItems = allItems.filter((item) => !knownIds.current.has(item.id));
      if (knownIds.current.size > 0 && newItems.length > 0) {
        const safety = newItems.filter((item) => item.severity === 'SAFETY').length;
        setAnnouncement(
          safety > 0
            ? `${newItems.length} novo(s) item(ns), ${safety} de segurança prioritária.`
            : `${newItems.length} novo(s) item(ns) na fila.`,
        );
      }
      knownIds.current = new Set(allItems.map((item) => item.id));
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

  const mandatory = data ? sortQueue(data.mandatory) : [];
  const optional = data ? sortQueue(data.optional) : [];
  const total = mandatory.length + optional.length;

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
          </div>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={refreshing}>
          <RefreshCw aria-hidden="true" className={refreshing ? 'animate-spin' : undefined} />
          {refreshing ? 'Atualizando…' : 'Atualizar fila'}
        </Button>
      </div>

      {/* Status de conexão em tempo real: só para leitor de tela — a pedido do usuário,
          não aparece mais como texto visível no painel. */}
      <p className="sr-only" role="status" aria-live="polite">
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

      {total === 0 ? (
        <div className="rounded-xl border border-dashed border-input bg-card px-6 py-12 text-center">
          <CheckCircle2 aria-hidden="true" className="mx-auto size-10 text-muted-foreground" />
          <h2 className="mt-4 text-h3 font-semibold">Fila em dia</h2>
          <p className="mt-2 text-body text-muted-foreground">
            Não há protocolos nem liberações PAR-Q pendentes agora.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          <QueueSection id="mandatory" title="Revisão Humana Obrigatória" items={mandatory} />
          <QueueSection id="optional" title="Revisão Humana Opcional" items={optional} />
        </div>
      )}
    </section>
  );
}

function QueueSection({ id, title, items }: { id: string; title: string; items: QueueItem[] }) {
  const headingId = `queue-section-${id}`;
  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-border p-4 sm:p-6">
      <h2 id={headingId} className="mb-3 text-h2 font-bold">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-input bg-card px-4 py-6 text-center text-body text-muted-foreground">
          Nada aqui agora.
        </p>
      ) : (
        <ol className="space-y-3" aria-label={title}>
          {items.map((item) => (
            <QueueCard key={`${item.kind}:${item.id}`} item={item} />
          ))}
        </ol>
      )}
    </section>
  );
}
