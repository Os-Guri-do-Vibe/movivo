'use client';

import { useCallback } from 'react';

import { getMarketing } from '@/lib/control-center-api';
import { cn } from '@/lib/utils';

import { ActivityHeatmap } from './overview-charts';
import {
  DataQuality,
  EmptyState,
  formatMetric,
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
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const SIGNAL_LABELS = {
  GREEN: { label: 'Dentro da meta', className: 'bg-accent text-accent-foreground' },
  ATTENTION: { label: 'Atenção', className: 'bg-secondary text-secondary-foreground' },
  CRITICAL: { label: 'Fora da meta', className: 'bg-destructive/10 text-destructive' },
  UNKNOWN: { label: 'Sem base', className: 'border border-border text-muted-foreground' },
} as const;

/** Rótulo do investimento. Canal sem gasto NUNCA exibe R$ 0,00 (TASK-8.6.2). */
const NO_INVESTMENT_LABEL = 'sem investimento direto';


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

      <section aria-labelledby="attribution-title" className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="attribution-title" className="text-h2 font-bold">
              Aquisição &amp; Canais
            </h2>
            <p className="mt-1 text-label text-muted-foreground">
              CAC, ROAS e LTV/CAC por origem. Janela de atribuição: convertidos em até{' '}
              {data.attributionWindowDays} dias após o cadastro, atribuídos ao canal de primeiro
              toque. ROAS usa receita <strong>recebida</strong>, nunca contratada.
            </p>
          </div>
          <p className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
            {data.suppressedChannels.toLocaleString('pt-BR')} canais suprimidos (n&lt;
            {data.minimumSegmentSize})
          </p>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Investimento em mídia lançado: {brl.format(data.mediaInvestmentBrl)} · LTV sustentado por{' '}
          {data.matureCohorts} coorte(s) de entrada madura(s)
          {data.matureCohorts < 3 ? ' — estimativa de baixa confiança, é hipótese, não medida.' : '.'}{' '}
          Origem não capturada: {data.attributionNotCaptured.toLocaleString('pt-BR')} cadastros
          anteriores à captura de origem — nunca contados como orgânicos.
        </p>
        {data.channelEconomics.length ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.channelEconomics.map((channel) => {
              const signal = SIGNAL_LABELS[channel.signal];
              return (
                <article
                  key={channel.channel}
                  className="rounded-xl border border-border bg-card p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-h3 font-semibold">{channel.channel}</h3>
                    <span
                      className={cn('rounded-full px-2 py-1 text-xs font-semibold', signal.className)}
                    >
                      {signal.label}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {channel.students.toLocaleString('pt-BR')} cadastros ·{' '}
                    {channel.converted.toLocaleString('pt-BR')} convertidos na janela
                  </p>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-label">
                    <div>
                      <dt className="text-xs text-muted-foreground">Investimento</dt>
                      <dd className="font-mono font-semibold">
                        {channel.investmentBrl === null
                          ? NO_INVESTMENT_LABEL
                          : brl.format(channel.investmentBrl)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">CAC</dt>
                      <dd className="font-mono font-semibold">{formatMetric(channel.cac)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Receita recebida</dt>
                      <dd className="font-mono font-semibold">
                        {formatMetric(channel.receivedRevenue)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">ROAS</dt>
                      <dd className="font-mono font-semibold">{formatMetric(channel.roas)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">LTV/CAC (meta ≥ 3)</dt>
                      <dd className="font-mono font-semibold">{formatMetric(channel.ltvToCac)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Payback (meta ≤ 3 meses)</dt>
                      <dd className="font-mono font-semibold">
                        {formatMetric(channel.paybackMonths)}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-xs text-muted-foreground">{channel.ltv.definition}</p>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="mt-4">
            <EmptyState
              title="Sem canais publicáveis"
              description={`Nenhum canal alcançou ${data.minimumSegmentSize} cadastros — publicar abaixo disso permitiria reidentificação.`}
            />
          </div>
        )}
        <p className="mt-4 text-xs text-muted-foreground">{data.acquisition.definition}</p>
      </section>

      <section id="publico-agregado" aria-labelledby="audience-title" className="mt-8">
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
