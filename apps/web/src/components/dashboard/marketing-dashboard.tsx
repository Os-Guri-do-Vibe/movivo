'use client';

import { useCallback } from 'react';

import { getMarketing } from '@/lib/control-center-api';
import { cn } from '@/lib/utils';

import { ActivityHeatmap } from './overview-charts';
import {
  DataQuality,
  EmptyState,
  ResourceState,
  SectorHeader,
  useControlCenterResource,
} from './control-center-ui';

const DIMENSION_LABELS = {
  PRIMARY_GOAL: 'Objetivo principal',
  TRAINING_LOCATION: 'Local de treino',
  PREFERRED_PERIOD: 'Período preferido',
  AGE_BAND: 'Faixa etária',
} as const;

const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });

/**
 * Métricas que só existem com origem de tráfego. O cartão nomeia a dependência em vez
 * de renderizar zero: sem UTM não há CAC por canal, e inventar o número seria pior que
 * não ter (TASK-7.3.4).
 */
const ATTRIBUTION_METRICS = [
  'Origem do cadastro (canal e campanha)',
  'CAC por canal',
  'ROAS por campanha',
  'Conversão por campanha e criativo',
];

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
  const { anamnesisFunnel } = data;
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

      <section
        aria-labelledby="anamnesis-funnel-title"
        className="mt-6 rounded-xl border border-border bg-card p-5 sm:p-6"
      >
        <h2 id="anamnesis-funnel-title" className="text-h2 font-bold">
          Onde o cadastro se perde
        </h2>
        <p className="mt-1 text-label text-muted-foreground">
          Abandono por etapa do onboarding, sobre sessões com desfecho definido.
        </p>
        {anamnesisFunnel.steps.length ? (
          <>
            <ul className="mt-5 grid gap-4 lg:grid-cols-3">
              {anamnesisFunnel.steps.map((step) => {
                const worst = step.step === anamnesisFunnel.worstStep;
                return (
                  <li
                    key={step.step}
                    className={cn(
                      'rounded-lg bg-secondary p-4',
                      worst && 'ring-2 ring-destructive/60',
                    )}
                  >
                    <p className="text-label font-semibold">{step.label}</p>
                    <p className="mt-3 font-mono text-h2 font-bold">
                      {step.abandonRate === null ? '—' : percent.format(step.abandonRate)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {step.abandoned.toLocaleString('pt-BR')} de{' '}
                      {step.reached.toLocaleString('pt-BR')} desistiram nesta etapa
                    </p>
                    {worst ? (
                      <p className="mt-2 text-xs font-semibold text-destructive">
                        Maior queda do funil
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-label text-muted-foreground">
              {anamnesisFunnel.exitPoint.status === 'AVAILABLE' &&
              anamnesisFunnel.exitPoint.checkpoint
                ? `Ponto de parada mais frequente: ${anamnesisFunnel.exitPoint.checkpoint} (${anamnesisFunnel.exitPoint.count?.toLocaleString('pt-BR')} sessões).`
                : anamnesisFunnel.exitPoint.reason}
            </p>
          </>
        ) : (
          <div className="mt-4">
            <EmptyState
              title="Funil suprimido por privacidade"
              description={anamnesisFunnel.exitPoint.reason}
            />
          </div>
        )}
      </section>

      <section
        aria-labelledby="attribution-title"
        className="mt-6 rounded-xl border border-dashed border-border bg-card p-5 sm:p-6"
      >
        <h2 id="attribution-title" className="text-h2 font-bold">
          Aquisição &amp; Canais
        </h2>
        <p className="mt-1 text-label text-muted-foreground">
          Indisponível — depende da captura de UTM em <code>anamnesis_sessions</code> e da tabela de
          investimento em mídia, previstas para a Sprint 8. Nenhum número é estimado aqui.
        </p>
        <ul className="mt-4 grid gap-2 text-label text-muted-foreground sm:grid-cols-2">
          {ATTRIBUTION_METRICS.map((item) => (
            <li key={item} className="rounded-lg bg-secondary px-3 py-2">
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted-foreground">{data.acquisition.definition}</p>
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
      <section aria-labelledby="seasonality-title" className="mt-8">
        <h2 id="seasonality-title" className="sr-only">
          Sazonalidade de cadastro
        </h2>
        <ActivityHeatmap
          cells={data.signupSeasonality}
          title="Cadastros iniciados por dia e hora"
          description="Quando as pessoas começam o cadastro. Base para horário de veiculação e plantão de atendimento, no fuso de São Paulo."
          unitLabel="cadastros"
        />
      </section>

      <DataQuality notes={meta.dataQuality} />
    </div>
  );
}
