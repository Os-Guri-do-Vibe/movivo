'use client';

import { AlertTriangle, Bell, CheckCircle2, Clock3, RefreshCw, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { alertCopyFor, alertSourceLabel } from '@/lib/alert-copy';
import { getAlerts } from '@/lib/dashboard-api';
import type { AlertsResponse, DashboardAlert } from '@/lib/dashboard-types';
import { elapsed } from '@/lib/relative-time';
import { cn } from '@/lib/utils';

import { StatusBadge } from './control-center-table';
import { SectorHeader } from './control-center-ui';
import { UnreadIndicator } from './unread-indicator';

function AlertCard({ alert }: { alert: DashboardAlert }) {
  const { title, detail } = alertCopyFor(alert);
  const safety = alert.level === 'SAFETY';
  const Icon = safety ? ShieldAlert : AlertTriangle;
  return (
    <li>
      <Link
        href={`/dashboard/alertas/${encodeURIComponent(alert.id)}`}
        className={cn(
          'block rounded-xl border border-l-4 bg-card p-4 transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none',
          safety ? 'border-l-coral' : 'border-l-verde-pulso',
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <span
              aria-hidden="true"
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-full',
                safety
                  ? 'bg-destructive text-destructive-foreground'
                  : 'bg-secondary text-secondary-foreground',
              )}
            >
              <Icon className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <UnreadIndicator
                  read={alert.read || alert.status === 'RESOLVED'}
                  label="Não lido. "
                />
                <h2
                  className={cn(
                    'text-body text-foreground',
                    alert.read || alert.status === 'RESOLVED' ? 'font-medium' : 'font-semibold',
                  )}
                >
                  {title}
                </h2>
                <StatusBadge tone={safety ? 'attention' : 'neutral'} variant="solid">
                  {safety ? 'Segurança' : 'Atenção'}
                </StatusBadge>
              </div>
              <p className="mt-1 text-label text-muted-foreground">{detail}</p>
              <p className="mt-2 text-xs font-medium text-foreground">
                {alert.studentName ?? 'Aluno não identificado'}
                {alertSourceLabel(alert.sourceType)
                  ? ` · ${alertSourceLabel(alert.sourceType)}`
                  : ''}
              </p>
            </div>
          </div>
          <time
            dateTime={alert.createdAt}
            className="flex items-center gap-1 text-xs text-muted-foreground"
          >
            <Clock3 aria-hidden="true" className="size-3.5" />
            {elapsed(alert.createdAt)}
          </time>
          {alert.status === 'RESOLVED' ? (
            <span className="basis-full text-xs text-muted-foreground">
              Resolvido em{' '}
              {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
                new Date(alert.updatedAt),
              )}
            </span>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

export function AlertsBoard() {
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setError('');
    setLoading(true);
    try {
      setData(await getAlerts(signal));
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar os alertas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const events = new EventSource('/api/dashboard/queue/events');
    events.addEventListener('queue.updated', () => void refresh());
    return () => {
      controller.abort();
      events.close();
    };
  }, [refresh]);

  const alerts = data?.[tab] ?? [];
  return (
    <div className="space-y-6">
      <SectorHeader
        title="Alertas"
        icon={Bell}
        onRefresh={() => void refresh()}
        refreshing={loading}
      />
      <p className="-mt-3 max-w-3xl text-body text-muted-foreground">
        Escalonamentos do AI Coach que precisam de supervisão do profissional CREF. Protocolos e
        substituições continuam na Fila do Profissional.
      </p>
      <div
        className="flex flex-wrap gap-2 border-b border-border pb-3"
        role="tablist"
        aria-label="Estado dos alertas"
      >
        {(
          [
            ['open', `Pendentes${data ? ` (${data.open.length})` : ''}`],
            ['resolved', `Resolvidos${data ? ` (${data.resolved.length})` : ''}`],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            variant={tab === value ? 'secondary' : 'ghost'}
            size="sm"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      {loading && !data ? (
        <p className="text-body text-muted-foreground">Carregando alertas…</p>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-destructive/40 bg-card p-4 text-body">
          <p>{error}</p>
          <Button className="mt-3" variant="outline" onClick={() => void refresh()}>
            <RefreshCw aria-hidden="true" className="size-4" />
            Tentar novamente
          </Button>
        </div>
      ) : null}
      {!loading && !error && alerts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <CheckCircle2 aria-hidden="true" className="mx-auto size-8 text-verde-pulso" />
          <h2 className="mt-3 text-h3 font-bold">
            {tab === 'open' ? 'Nenhum alerta pendente' : 'Nenhum alerta resolvido ainda'}
          </h2>
          <p className="mt-2 text-body text-muted-foreground">
            {tab === 'open'
              ? 'Quando o AI Coach pedir supervisão, o caso aparecerá aqui.'
              : 'Alertas resolvidos aparecerão aqui para consulta.'}
          </p>
        </div>
      ) : null}
      {alerts.length > 0 ? (
        <ul className="space-y-3">
          {alerts.map((alert) => (
            <AlertCard key={alert.id} alert={alert} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
