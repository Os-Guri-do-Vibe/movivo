'use client';

import { AlertTriangle, Bell, CheckCircle2, Clock3, RefreshCw, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { getAlerts } from '@/lib/dashboard-api';
import type { AlertsResponse, DashboardAlert } from '@/lib/dashboard-types';
import { cn } from '@/lib/utils';

import { StatusBadge } from './control-center-table';
import { SectorHeader } from './control-center-ui';

const REASONS: Record<string, { title: string; detail: string }> = {
  RED_FLAG: {
    title: 'Sinal de segurança',
    detail: 'O aluno relatou um sinal que requer atenção prioritária.',
  },
  PEDIDO_HANDOFF: {
    title: 'Acompanhamento solicitado',
    detail: 'O aluno pediu contato ou acompanhamento humano.',
  },
  SUBSTITUTION_PAIN: {
    title: 'Dor ou limitação em exercício',
    detail: 'A substituição de exercício precisa de revisão profissional.',
  },
  VALIDATOR_BLOCK: {
    title: 'Resposta bloqueada por segurança',
    detail: 'O AI Coach não enviou uma resposta sem validação adequada.',
  },
  VALIDATOR_FLAG: {
    title: 'Revisão técnica solicitada',
    detail: 'O AI Coach sinalizou esta conversa para acompanhamento.',
  },
  L1_GUARDRAIL_FLAG: {
    title: 'Revisão das regras do AI Coach',
    detail: 'As regras de segurança pediram supervisão humana.',
  },
  AGENT_CONFIG_UNAVAILABLE: {
    title: 'AI Coach indisponível com segurança',
    detail: 'A configuração necessária para responder não estava disponível.',
  },
  FORA_DE_ESCOPO: {
    title: 'Assunto fora do escopo do AI Coach',
    detail: 'A conversa foi encaminhada para acompanhamento profissional.',
  },
};

const SOURCES: Record<string, string> = {
  WORKOUT: 'Treino',
  WORKOUT_INSIGHT: 'Acompanhamento de treino',
  CHECKIN: 'Check-in semanal',
  CONVERSATION: 'Conversa',
};

function copyFor(alert: DashboardAlert) {
  return (
    REASONS[alert.reason] ?? {
      title:
        alert.level === 'SAFETY' ? 'Sinal de segurança' : 'Acompanhamento solicitado pelo AI Coach',
      detail: 'O AI Coach encaminhou este caso para supervisão profissional.',
    }
  );
}

function elapsed(createdAt: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000));
  if (minutes < 1) return 'Agora';
  if (minutes < 60) return `Há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Há ${hours} h`;
  return `Há ${Math.floor(hours / 24)} dia${hours >= 48 ? 's' : ''}`;
}

function AlertCard({ alert }: { alert: DashboardAlert }) {
  const { title, detail } = copyFor(alert);
  const safety = alert.level === 'SAFETY';
  const Icon = safety ? ShieldAlert : AlertTriangle;
  return (
    <li>
      <Link
        href={`/dashboard/fila/handoff/${encodeURIComponent(alert.id)}`}
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
                <h2 className="text-body font-semibold text-foreground">{title}</h2>
                <StatusBadge tone={safety ? 'attention' : 'neutral'} variant="solid">
                  {safety ? 'Segurança' : 'Atenção'}
                </StatusBadge>
              </div>
              <p className="mt-1 text-label text-muted-foreground">{detail}</p>
              <p className="mt-2 text-xs font-medium text-foreground">
                {alert.studentName ?? 'Aluno não identificado'}
                {alert.sourceType ? ` · ${SOURCES[alert.sourceType] ?? 'Acompanhamento'}` : ''}
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
