'use client';

import { AlertTriangle, CheckCircle2, CircleMinus, Gauge, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { getOperations } from '@/lib/dashboard-api';
import type { OperationsResponse } from '@/lib/dashboard-types';
import { cn } from '@/lib/utils';

import { ConversationReplay } from './conversation-replay';

function percent(value: number, base: number): number {
  return base > 0 ? Math.min(100, Math.round((value / base) * 100)) : 0;
}

function SlaCard({
  label,
  value,
  target,
  breached,
  available,
}: {
  label: string;
  value: string;
  target: string;
  breached: boolean;
  available: boolean;
}) {
  const Icon = !available ? CircleMinus : breached ? AlertTriangle : CheckCircle2;
  return (
    <article
      className={cn('rounded-xl border bg-card p-5', breached ? 'border-coral' : 'border-border')}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-label font-semibold">{label}</h2>
          <p className="mt-2 font-mono text-h2 font-bold">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">Meta: {target}</p>
        </div>
        <span
          className={cn(
            'flex size-11 items-center justify-center rounded-full',
            !available
              ? 'bg-secondary text-secondary-foreground'
              : breached
                ? 'bg-destructive text-destructive-foreground'
                : 'bg-accent text-accent-foreground',
          )}
        >
          <Icon aria-hidden="true" />
          <span className="sr-only">
            {!available ? 'SLA sem amostra' : breached ? 'SLA excedido' : 'SLA dentro da meta'}
          </span>
        </span>
      </div>
      <p className="mt-3 text-label font-semibold">
        {!available
          ? 'Sem amostra suficiente'
          : breached
            ? 'Atenção · SLA excedido'
            : 'Dentro da meta'}
      </p>
    </article>
  );
}

export function OperationsDashboard() {
  const [data, setData] = useState<OperationsResponse | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError('');
    setRefreshing(true);
    try {
      setData(await getOperations(signal));
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(
        caught instanceof Error ? caught.message : 'Não foi possível carregar as operações.',
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (!data && !error) {
    return (
      <div
        role="status"
        aria-label="Carregando operações"
        className="h-80 animate-pulse rounded-xl border border-border bg-card"
      />
    );
  }
  if (!data) {
    return (
      <section role="alert" className="rounded-xl border border-coral bg-card p-6">
        <h1 className="text-h2 font-bold">As operações não carregaram</h1>
        <p className="mt-2 text-body text-muted-foreground">{error}</p>
        <Button className="mt-4" onClick={() => void load()}>
          <RefreshCw aria-hidden="true" /> Tentar novamente
        </Button>
      </section>
    );
  }

  const stages = [
    { label: 'Formulário iniciado', value: data.funnel.formStarted },
    { label: 'Protocolo enviado', value: data.funnel.protocolSent },
    { label: 'Primeiro treino reportado', value: data.funnel.firstWorkout },
    { label: 'Conversão', value: data.funnel.converted },
  ];

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h1 font-bold">Operações</h1>
          <p className="mt-2 max-w-3xl text-body text-muted-foreground">
            Funil operacional, compromissos de nível de serviço e conversas anonimizadas para
            supervisão.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={refreshing}>
          <RefreshCw aria-hidden="true" className={refreshing ? 'animate-spin' : undefined} />
          {refreshing ? 'Atualizando…' : 'Atualizar'}
        </Button>
      </header>
      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-destructive p-3 text-label text-destructive-foreground"
        >
          A última atualização falhou: {error}
        </p>
      ) : null}

      <section aria-labelledby="sla-title" className="mt-8">
        <h2 id="sla-title" className="flex items-center gap-2 text-h2 font-bold">
          <Gauge aria-hidden="true" /> SLA
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <SlaCard
            label="Entrega do protocolo"
            value={
              data.sla.protocolDeliveryMinutes === null
                ? '—'
                : `${data.sla.protocolDeliveryMinutes.toLocaleString('pt-BR')} min`
            }
            target="até 120 min"
            breached={data.sla.protocolBreached}
            available={data.sla.protocolDeliveryMinutes !== null}
          />
          <SlaCard
            label="Resposta da MOVI · p95"
            value={
              data.sla.coachP95Seconds === null
                ? '—'
                : `${data.sla.coachP95Seconds.toLocaleString('pt-BR')} s`
            }
            target="até 30 s"
            breached={data.sla.coachBreached}
            available={data.sla.coachP95Seconds !== null}
          />
        </div>
      </section>

      <section
        aria-labelledby="funnel-title"
        className="mt-8 rounded-xl border border-border bg-card p-5 sm:p-6"
      >
        <h2 id="funnel-title" className="text-h2 font-bold">
          Funil do MVP
        </h2>
        <p className="mt-1 text-label text-muted-foreground">
          Da entrada no formulário até a assinatura.
        </p>
        <ol className="mt-6 space-y-5">
          {stages.map((stage, index) => {
            const available = stage.value !== null;
            const value = stage.value ?? 0;
            const rate = available ? percent(value, data.funnel.formStarted) : null;
            return (
              <li key={stage.label}>
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <span className="text-label font-semibold">
                      {index + 1}. {stage.label}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {rate === null ? 'Métrica ainda indisponível' : `${rate}% da entrada`}
                    </span>
                  </div>
                  <strong className="font-mono text-h3">
                    {available ? value.toLocaleString('pt-BR') : '—'}
                  </strong>
                </div>
                <progress
                  className="mt-2 h-3 w-full overflow-hidden rounded-full accent-petroleo"
                  max={Math.max(1, data.funnel.formStarted)}
                  value={value}
                  aria-label={
                    rate === null
                      ? `${stage.label}: métrica ainda indisponível`
                      : `${stage.label}: ${value}, ${rate}% da entrada`
                  }
                />
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="replays-heading" className="mt-8">
        <h2 id="replays-heading" className="text-h2 font-bold">
          Replays anonimizados
        </h2>
        <p className="mt-2 max-w-3xl text-label text-muted-foreground">
          Recortes para avaliar a qualidade e a segurança do atendimento. O PII Scrubber roda no
          backend antes de qualquer conteúdo chegar aqui.
        </p>
        {data.replays.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-input bg-card p-8 text-center">
            <p className="text-body font-semibold">Nenhum replay disponível</p>
            <p className="mt-1 text-label text-muted-foreground">
              Novas conversas elegíveis aparecerão após a anonimização.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {data.replays.map((replay, index) => (
              <div key={replay.conversationId || index}>
                <p className="mb-2 font-mono text-xs text-muted-foreground">
                  Conversa anonimizada #{index + 1}
                </p>
                <ConversationReplay replay={replay} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
