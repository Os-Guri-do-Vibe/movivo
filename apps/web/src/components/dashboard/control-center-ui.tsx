'use client';

import { AlertTriangle, Clock3, DatabaseZap, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ControlCenterMetric, DataAvailability } from '@movivo/shared';

import { Button } from '@/components/ui/button';
import { ControlCenterApiError } from '@/lib/control-center-api';
import { cn } from '@/lib/utils';

export interface ControlCenterMeta {
  generatedAt: string;
  timezone: 'America/Sao_Paulo';
  dataQuality: string[];
}

export function useControlCenterResource<T>(load: (signal?: AbortSignal) => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      setError('');
      setForbidden(false);
      setLoading(true);
      try {
        setData(await load(signal));
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setForbidden(caught instanceof ControlCenterApiError && caught.status === 403);
        setError(caught instanceof Error ? caught.message : 'Não foi possível carregar o setor.');
      } finally {
        setLoading(false);
      }
    },
    [load],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  return { data, error, forbidden, loading, refresh };
}

export function SectorHeader({
  title,
  description,
  meta,
  refreshing,
  onRefresh,
}: {
  title: string;
  description: string;
  meta?: ControlCenterMeta;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-h1 font-bold">{title}</h1>
        <p className="mt-2 max-w-3xl text-body text-muted-foreground">{description}</p>
        {meta ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock3 aria-hidden="true" className="size-3.5" />
            Atualizado em{' '}
            <time dateTime={meta.generatedAt}>
              {new Intl.DateTimeFormat('pt-BR', {
                dateStyle: 'short',
                timeStyle: 'short',
                timeZone: meta.timezone,
              }).format(new Date(meta.generatedAt))}
            </time>
          </p>
        ) : null}
      </div>
      {onRefresh ? (
        <Button variant="outline" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw aria-hidden="true" className={refreshing ? 'animate-spin' : undefined} />
          {refreshing ? 'Atualizando…' : 'Atualizar'}
        </Button>
      ) : null}
    </header>
  );
}

function statusLabel(status: DataAvailability): string {
  if (status === 'PROXY') return 'Estimativa';
  if (status === 'UNAVAILABLE') return 'Indisponível';
  return 'Disponível';
}

export function formatMetric(metric: ControlCenterMetric): string {
  if (metric.status === 'UNAVAILABLE' || metric.value === null) return '—';
  if (metric.unit === 'BRL') {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
      metric.value,
    );
  }
  if (metric.unit === 'PERCENT') {
    return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(metric.value)}%`;
  }
  if (metric.unit === 'MILLISECONDS') {
    return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(metric.value)} ms`;
  }
  if (metric.unit === 'MINUTES') {
    return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(metric.value)} min`;
  }
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(metric.value);
}

export function MetricCard({ label, metric }: { label: string; metric: ControlCenterMetric }) {
  return (
    <article
      className={cn(
        'rounded-xl border bg-card p-5',
        metric.status === 'UNAVAILABLE' ? 'border-dashed' : 'border-border',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-label font-semibold">{label}</h2>
        <span
          className={cn(
            'rounded-full px-2 py-1 text-xs font-semibold',
            metric.status === 'AVAILABLE' && 'bg-accent text-accent-foreground',
            metric.status === 'PROXY' && 'bg-secondary text-secondary-foreground',
            metric.status === 'UNAVAILABLE' && 'border border-border text-muted-foreground',
          )}
        >
          {statusLabel(metric.status)}
        </span>
      </div>
      <p
        className="mt-3 font-mono text-h1 font-bold text-foreground"
        aria-label={`${label}: ${formatMetric(metric)}`}
      >
        {formatMetric(metric)}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{metric.definition}</p>
    </article>
  );
}

export function MetricGrid({
  metrics,
  className = 'sm:grid-cols-2 xl:grid-cols-3',
  label = 'Indicadores',
}: {
  metrics: Array<{ label: string; metric: ControlCenterMetric }>;
  /** Colunas do grid. O padrão serve a setores com 6-8 métricas. */
  className?: string;
  /** Nome acessível da faixa — obrigatório distinguir quando há mais de uma na página. */
  label?: string;
}) {
  return (
    <section aria-label={label} className={cn('mt-6 grid gap-4', className)}>
      {metrics.map(({ label, metric }) => (
        <MetricCard key={label} label={label} metric={metric} />
      ))}
    </section>
  );
}

export function DataQuality({ notes }: { notes: readonly string[] }) {
  if (!notes.length) return null;
  return (
    <aside
      className="mt-6 rounded-xl border border-border bg-secondary p-4"
      aria-labelledby="quality-title"
    >
      <h2 id="quality-title" className="flex items-center gap-2 text-label font-semibold">
        <DatabaseZap aria-hidden="true" className="size-4" /> Qualidade e cobertura dos dados
      </h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-label text-muted-foreground">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </aside>
  );
}

export function ResourceState({
  loading,
  error,
  forbidden,
  onRetry,
}: {
  loading: boolean;
  error: string;
  forbidden: boolean;
  onRetry: () => void;
}) {
  if (loading && !error) {
    return (
      <div role="status" aria-label="Carregando setor" className="space-y-4">
        <div className="h-20 animate-pulse rounded-xl bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="h-40 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      </div>
    );
  }
  if (!error) return null;
  return (
    <section role="alert" className="rounded-xl border border-coral bg-card p-6">
      <AlertTriangle aria-hidden="true" className="size-6" />
      <h1 className="mt-3 text-h2 font-bold">
        {forbidden ? 'Este setor não faz parte do seu acesso' : 'Não foi possível carregar o setor'}
      </h1>
      <p className="mt-2 text-body text-muted-foreground">{error}</p>
      {!forbidden ? (
        <Button className="mt-4" variant="outline" onClick={onRetry}>
          <RefreshCw aria-hidden="true" /> Tentar novamente
        </Button>
      ) : null}
    </section>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
      <h2 className="text-h3 font-semibold">{title}</h2>
      <p className="mt-2 text-label text-muted-foreground">{description}</p>
    </div>
  );
}
