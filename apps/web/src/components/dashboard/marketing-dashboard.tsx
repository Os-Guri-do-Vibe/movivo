'use client';

import { useCallback } from 'react';

import { getMarketing } from '@/lib/control-center-api';

import {
  DataQuality,
  EmptyState,
  MetricCard,
  ResourceState,
  SectorHeader,
  useControlCenterResource,
} from './control-center-ui';

const DIMENSION_LABELS = {
  PRIMARY_GOAL: 'Objetivo principal',
  TRAINING_LOCATION: 'Local de treino',
  PREFERRED_PERIOD: 'Período preferido',
} as const;

export function MarketingDashboard() {
  const load = useCallback((signal?: AbortSignal) => getMarketing(signal), []);
  const state = useControlCenterResource(load);
  if (!state.data) {
    return (
      <ResourceState
        loading={state.loading}
        error={state.error}
        forbidden={state.forbidden}
        onRetry={() => void state.refresh()}
      />
    );
  }
  const { data, meta } = state.data;
  const funnel = [
    { label: 'Formulário iniciado', metric: data.funnel.formStarted },
    { label: 'Formulário concluído', metric: data.funnel.formSubmitted },
    { label: 'Protocolo ativo', metric: data.funnel.protocolActive },
    { label: 'Assinatura ativa', metric: data.funnel.subscriptionActive },
  ];
  return (
    <div>
      <SectorHeader
        title="Analytics"
        description="Aquisição, conversão e público em grupos protegidos. Nenhum dado individual de saúde ou contato é exibido."
        meta={meta}
        refreshing={state.loading}
        onRefresh={() => void state.refresh()}
      />

      <section
        aria-labelledby="funnel-title"
        className="mt-6 rounded-xl border border-border bg-card p-5 sm:p-6"
      >
        <h2 id="funnel-title" className="text-h2 font-bold">
          Funil de aquisição
        </h2>
        <ol className="mt-5 grid gap-4 lg:grid-cols-4">
          {funnel.map(({ label, metric }, index) => (
            <li key={label} className="relative rounded-lg bg-secondary p-4">
              <span className="text-xs font-semibold text-muted-foreground">Etapa {index + 1}</span>
              <p className="mt-1 text-label font-semibold">{label}</p>
              <p className="mt-3 font-mono text-h2 font-bold">
                {metric.status === 'UNAVAILABLE' || metric.value === null
                  ? '—'
                  : metric.value.toLocaleString('pt-BR')}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">{metric.definition}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="acquisition-title" className="mt-6 max-w-xl">
        <h2 id="acquisition-title" className="sr-only">
          Aquisição atribuída
        </h2>
        <MetricCard label="Aquisição por campanha" metric={data.acquisition} />
      </section>

      <section aria-labelledby="audience-title" className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="audience-title" className="text-h2 font-bold">
              Público agregado
            </h2>
            <p className="mt-1 text-label text-muted-foreground">
              Grupos com menos de {data.minimumSegmentSize} pessoas são ocultados para impedir
              reidentificação.
            </p>
          </div>
          <p className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
            {data.suppressedSegments.toLocaleString('pt-BR')} segmentos suprimidos
          </p>
        </div>
        {data.segments.length ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.segments.map((segment) => (
              <article
                key={`${segment.dimension}-${segment.value}`}
                className="rounded-xl border border-border bg-card p-5"
              >
                <p className="text-xs font-semibold text-muted-foreground">
                  {DIMENSION_LABELS[segment.dimension]}
                </p>
                <h3 className="mt-1 text-h3 font-semibold">{segment.value}</h3>
                <p className="mt-3 font-mono text-h2 font-bold">
                  {segment.count.toLocaleString('pt-BR')}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-4">
            <EmptyState
              title="Sem segmentos publicáveis"
              description="Ainda não há grupos com tamanho suficiente para uma análise segura."
            />
          </div>
        )}
      </section>
      <DataQuality notes={meta.dataQuality} />
    </div>
  );
}
