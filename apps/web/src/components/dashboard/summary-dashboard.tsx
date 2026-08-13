'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import type {
  ControlCenterFinanceResponse,
  ControlCenterOverviewResponse,
  ControlCenterPendingCapability,
  ControlCenterPercentiles,
  ControlCenterPillarSummary,
  ControlCenterSlo,
  ControlCenterSystemResponse,
} from '@movivo/shared';

import { getFinanceSummary, getOverview, getSystemSummary } from '@/lib/control-center-api';
import { cn } from '@/lib/utils';

import { DailySeriesChart } from './overview-charts';

import {
  DataQuality,
  formatMetric,
  MetricGrid,
  ResourceState,
  SectorHeader,
  useControlCenterResource,
} from './control-center-ui';

type Resource = 'overview' | 'system' | 'finance';
type SummaryResponse =
  ControlCenterOverviewResponse | ControlCenterSystemResponse | ControlCenterFinanceResponse;

const COPY: Record<Resource, { title: string; description: string }> = {
  overview: {
    title: 'Visão geral',
    description:
      'Resumo operacional: indicadores do dia, receita, movimento dos últimos 30 dias e concentração de atendimento. Métricas aproximadas ou sem fonte aparecem identificadas.',
  },
  system: {
    title: 'Saúde do sistema',
    description:
      'Disponibilidade, filas e IA com identificadores técnicos. Nenhuma identidade de aluno é exibida.',
  },
  finance: {
    title: 'Financeiro',
    description:
      'Receita contratada, assinaturas e custos disponíveis, sem dados individuais de saúde.',
  },
};

function metricsFor(resource: Exclude<Resource, 'overview'>, response: SummaryResponse) {
  if (resource === 'system') {
    const data = (response as ControlCenterSystemResponse).data;
    return [
      { label: 'Latencia do banco', metric: data.databaseLatency },
      { label: 'Latencia do Redis', metric: data.redisLatency },
      { label: 'Trabalhos de IA (30 dias)', metric: data.aiJobs },
      { label: 'Trabalhos com erro', metric: data.aiFailures },
      { label: 'Trabalhos que viraram tarefa manual', metric: data.aiDlq },
    ];
  }
  const data = (response as ControlCenterFinanceResponse).data;
  return [
    { label: 'Assinaturas ativas', metric: data.activeSubscriptions },
    { label: 'MRR contratado', metric: data.contractedMrr },
    { label: 'Receita recebida', metric: data.receivedRevenue },
    { label: 'Lucro', metric: data.profit },
    { label: 'Custo de IA (30 dias)', metric: data.aiCost },
    { label: 'Custo de IA por assinante', metric: data.aiCostPerActiveUser },
    { label: 'Custo WhatsApp', metric: data.whatsappCost },
    { label: 'Custo de infraestrutura', metric: data.infrastructureCost },
    { label: 'Receita em risco (30 dias)', metric: data.revenueAtRisk30d },
    { label: 'CAC', metric: data.customerAcquisitionCost },
    { label: 'Distribuição por sócio', metric: data.partnerDistribution },
  ];
}

const PILLAR_STATE_TONE: Record<
  ControlCenterPillarSummary['state'],
  { dot: string; label: string; border: string }
> = {
  OK: { dot: 'bg-emerald-500', label: 'Tudo certo', border: 'border-border' },
  ATTENTION: { dot: 'bg-amber-500', label: 'Atenção', border: 'border-amber-500/40' },
  CRITICAL: { dot: 'bg-coral', label: 'Crítico', border: 'border-coral' },
};

/**
 * Linha-resumo de um pilar (US-7.8): nenhum número nasce na Visão Geral — o
 * `headline`/`details` vêm do próprio pilar de destino, e o clique leva pra lá.
 */
function OverviewPillarRow({ pillar }: { pillar: ControlCenterPillarSummary }) {
  const tone = PILLAR_STATE_TONE[pillar.state];
  return (
    <li>
      <Link
        href={pillar.href}
        className={cn(
          'block rounded-xl border bg-card p-5 transition-colors hover:border-verde-pulso focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring',
          tone.border,
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-label font-semibold">{pillar.label}</h2>
          <span className="flex items-center gap-2 whitespace-nowrap text-xs font-semibold">
            <span aria-hidden="true" className={cn('size-3 rounded-full', tone.dot)} />
            {tone.label}
          </span>
        </div>
        <p
          className="mt-3 font-mono text-h1 font-bold text-foreground"
          aria-label={`${pillar.headline.label}: ${formatMetric(pillar.headline.metric)}`}
        >
          {formatMetric(pillar.headline.metric)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{pillar.headline.label}</p>
        {pillar.details.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1 text-xs text-muted-foreground">
            {pillar.details.map((detail) => (
              <li key={detail.label}>
                {detail.label}: {formatMetric(detail.metric)}
              </li>
            ))}
          </ul>
        ) : null}
        {pillar.reason ? (
          <p className="mt-2 text-xs font-medium text-coral">{pillar.reason}</p>
        ) : null}
      </Link>
    </li>
  );
}

/**
 * Visão Geral (US-7.8): resumo por pilar, não uma sexta tela com métrica própria.
 * Um pilar sem capability não chega aqui — o backend já não o calculou.
 */
function OverviewSections({ data }: { data: ControlCenterOverviewResponse['data'] }) {
  return (
    <ul className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Resumo por pilar">
      {data.pillars.map((pillar) => (
        <OverviewPillarRow key={pillar.pillar} pillar={pillar} />
      ))}
    </ul>
  );
}

const SLO_TONE: Record<ControlCenterSlo['status'], { dot: string; label: string; bar: string }> = {
  GREEN: { dot: 'bg-emerald-500', label: 'Dentro do objetivo', bar: 'bg-emerald-500' },
  YELLOW: { dot: 'bg-amber-500', label: 'Atenção', bar: 'bg-amber-500' },
  RED: { dot: 'bg-coral', label: 'Fora do objetivo', bar: 'bg-coral' },
  UNKNOWN: {
    dot: 'bg-muted-foreground',
    label: 'Sem dados no período',
    bar: 'bg-muted-foreground',
  },
};

const percent = (value: number, digits = 1) =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(value);

/**
 * Semáforo de um objetivo. O número sozinho não decide nada: o que decide é o
 * orçamento de erro — quanta folga a meta ainda concede dentro do período.
 */
function SloCard({ slo }: { slo: ControlCenterSlo }) {
  const tone = SLO_TONE[slo.status];
  const consumed = slo.errorBudgetConsumedPercent;
  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-label font-semibold">{slo.title}</h3>
        <span className="flex items-center gap-2 whitespace-nowrap text-xs font-semibold">
          <span aria-hidden="true" className={cn('size-3 rounded-full', tone.dot)} />
          {tone.label}
        </span>
      </div>
      <p
        className="mt-3 font-mono text-h1 font-bold text-foreground"
        aria-label={`${slo.title}: ${
          slo.currentPercent === null ? 'sem dados' : `${percent(slo.currentPercent, 2)} por cento`
        }, objetivo ${percent(slo.targetPercent, 2)} por cento, ${tone.label}`}
      >
        {slo.currentPercent === null ? '—' : `${percent(slo.currentPercent, 2)}%`}
        <span className="ml-2 font-sans text-label font-normal text-muted-foreground">
          objetivo {percent(slo.targetPercent, 2)}%
        </span>
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{slo.objective}</p>
      <div className="mt-4">
        <p className="flex items-center justify-between text-xs font-semibold">
          <span>Margem de erro já usada no período</span>
          <span>{consumed === null ? '—' : `${percent(consumed)}%`}</span>
        </p>
        <div
          className="mt-1 h-2 overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={
            consumed === null
              ? 'Margem de erro sem dados no período'
              : `Margem de erro consumida: ${percent(consumed)} por cento`
          }
        >
          <div
            className={cn('h-full rounded-full', tone.bar)}
            style={{ width: `${Math.min(consumed ?? 0, 100)}%` }}
          />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {slo.explanation}
          {slo.samples > 0 ? ` Base: ${slo.samples} registros nos últimos 30 dias.` : ''}
        </p>
      </div>
    </article>
  );
}

function PercentileBlock({
  title,
  description,
  percentiles,
}: {
  title: string;
  description: string;
  percentiles: ControlCenterPercentiles;
}) {
  return (
    <>
      <h2 className="mt-10 text-h2 font-bold">{title}</h2>
      <p className="mt-1 max-w-3xl text-label text-muted-foreground">{description}</p>
      <MetricGrid
        label={title}
        className="sm:grid-cols-3"
        metrics={[
          { label: 'Tempo comum (metade das vezes)', metric: percentiles.p50 },
          { label: 'Tempo ruim (95 de cada 100)', metric: percentiles.p95 },
          { label: 'Pior caso (99 de cada 100)', metric: percentiles.p99 },
        ]}
      />
    </>
  );
}

function AiLatencyTable({
  rows,
}: {
  rows: ControlCenterSystemResponse['data']['aiLatencyByModel'];
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-label">
        <caption className="p-4 text-left text-xs text-muted-foreground">
          Detalhe por modelo e tipo de trabalho, em milissegundos. Leitura de engenharia.
        </caption>
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="p-3 text-left font-semibold">Modelo</th>
            <th className="p-3 text-left font-semibold">Tipo de trabalho</th>
            <th className="p-3 text-right font-semibold">Amostras</th>
            <th className="p-3 text-right font-semibold">p50</th>
            <th className="p-3 text-right font-semibold">p95</th>
            <th className="p-3 text-right font-semibold">p99</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.model}:${row.jobType}`} className="border-t border-border">
              <td className="p-3 font-mono">{row.model}</td>
              <td className="p-3">{row.jobType}</td>
              <td className="p-3 text-right font-mono">{row.samples}</td>
              <td className="p-3 text-right font-mono">
                {row.p50 === null ? '—' : percent(row.p50, 0)}
              </td>
              <td className="p-3 text-right font-mono">
                {row.p95 === null ? '—' : percent(row.p95, 0)}
              </td>
              <td className="p-3 text-right font-mono">
                {row.p99 === null ? '—' : percent(row.p99, 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** TASK-7.5.4: o que ainda não existe é nomeado com dependência e sprint — nunca zero. */
function PendingCapabilities({ items }: { items: readonly ControlCenterPendingCapability[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <h2 className="mt-10 text-h2 font-bold">Ainda não medimos</h2>
      <p className="mt-1 max-w-3xl text-label text-muted-foreground">
        Estes indicadores não aparecem como zero porque zero seria mentira: dependem de algo que
        ainda não foi construído.
      </p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <li
            key={item.title}
            className="rounded-xl border border-dashed border-border bg-card p-5"
          >
            <p className="text-label font-semibold">{item.title}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.reason}</p>
            <p className="mt-3 text-xs">
              <span className="font-semibold">Depende de:</span> {item.dependency}
            </p>
            <p className="mt-1 text-xs">
              <span className="font-semibold">Previsto para:</span> {item.plannedFor}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Ordem da tela (US-7.5): primeiro a resposta ("está tudo bem?"), depois a
 * evidência (tempos medidos), depois o que ainda não é mensurável.
 */
function SystemSections({ data }: { data: ControlCenterSystemResponse['data'] }) {
  return (
    <>
      <h2 className="mt-8 text-h2 font-bold">Estamos entregando o combinado?</h2>
      <p className="mt-1 max-w-3xl text-label text-muted-foreground">
        Cada objetivo tem uma meta e uma margem de erro para o período. Verde: pode seguir
        entregando novidade. Vermelho: a margem acabou, a prioridade é consertar.
      </p>
      <section aria-label="Objetivos de serviço" className="mt-6 grid gap-4 sm:grid-cols-2">
        {data.slos.map((slo) => (
          <SloCard key={slo.key} slo={slo} />
        ))}
      </section>

      <h2 className="mt-10 text-h2 font-bold">Infraestrutura agora</h2>
      <MetricGrid
        label="Indicadores de infraestrutura"
        metrics={[
          { label: 'Latência do banco', metric: data.databaseLatency },
          { label: 'Latência do Redis', metric: data.redisLatency },
          { label: 'Trabalhos de IA (30 dias)', metric: data.aiJobs },
          { label: 'Trabalhos com erro', metric: data.aiFailures },
          { label: 'Trabalhos que viraram tarefa manual', metric: data.aiDlq },
        ]}
      />

      <PercentileBlock
        title="Tempo que o aluno espera no WhatsApp"
        description="Da pergunta do aluno até a resposta chegar no celular: inclui fila, IA e envio. É o tempo que ele sente."
        percentiles={data.whatsappLatency}
      />
      <div className="mt-6">
        <DailySeriesChart
          title="Tempo ruim (p95) por dia — WhatsApp"
          description="Em cada dia, o tempo que 95 de cada 100 respostas não ultrapassaram."
          points={data.whatsappLatencyP95Daily}
          unit="ms"
        />
      </div>

      <PercentileBlock
        title="Tempo do modelo de IA"
        description="Só a chamada de IA, sem fila nem WhatsApp. Sai da latência já registrada em cada trabalho — não depende de OpenTelemetry."
        percentiles={data.aiLatency}
      />
      <AiLatencyTable rows={data.aiLatencyByModel} />
      <div className="mt-6">
        <DailySeriesChart
          title="Tempo ruim (p95) por dia — IA"
          description="Em cada dia, o tempo que 95 de cada 100 chamadas de IA não ultrapassaram."
          points={data.aiLatencyP95Daily}
          unit="ms"
        />
      </div>

      <h2 className="mt-10 text-h2 font-bold">Uso da base de conhecimento</h2>
      <p className="mt-1 max-w-3xl text-label text-muted-foreground">
        Quanto o AI Coach recorre ao material curado para responder. Taxa baixa indica corpus
        pequeno ou fora do assunto que os alunos perguntam.
      </p>
      <MetricGrid
        label="Uso da base de conhecimento"
        className="sm:grid-cols-3"
        metrics={[
          { label: 'Consultas em 30 dias', metric: data.ragQueries },
          { label: 'Consultas que acharam material', metric: data.ragUsefulRetrievalRate },
          { label: 'Trechos indexados', metric: data.ragCorpusChunks },
        ]}
      />

      <PendingCapabilities items={data.pendingCapabilities} />
    </>
  );
}

const PLAN_LABEL: Record<string, string> = {
  MONTHLY: 'Mensal',
  QUARTERLY: 'Trimestral',
  SEMIANNUAL: 'Semestral',
  ANNUAL: 'Anual',
};

const planLabel = (plan: string) => PLAN_LABEL[plan] ?? plan;

const brl = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const monthLabel = (month: string) => {
  const [year, monthPart] = month.split('-');
  return `${monthPart}/${year}`;
};

/**
 * Detalhamento do pilar Financeiro (US-7.2): calendário de renovação, risco de
 * receita, churn declarado, MRR/ARR por plano e custo de IA por modelo.
 */
function FinanceSections({ data }: { data: ControlCenterFinanceResponse['data'] }) {
  return (
    <>
      <section
        aria-label="Calendário de renovação (90 dias)"
        className="mt-10 rounded-xl border border-border bg-card p-5"
      >
        <h2 className="text-h2 font-bold">Calendário de renovação (90 dias)</h2>
        <p className="mt-1 text-label text-muted-foreground">
          Receita contratada que vence em cada mês, por plano.
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.renewalCalendar.map((slice) => (
            <li
              key={`${slice.month}:${slice.plan}`}
              className="rounded-lg border border-border p-4"
            >
              <p className="text-label font-semibold">{`${monthLabel(slice.month)} · ${planLabel(slice.plan)}`}</p>
              <p className="mt-2 font-mono text-h2 font-bold">{brl(slice.amountBrl)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {slice.subscriptions === 1
                  ? '1 assinatura vencendo'
                  : `${slice.subscriptions} assinaturas vencendo`}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-label="Assinaturas em risco nos próximos 30 dias"
        className="mt-6 rounded-xl border border-border bg-card p-5"
      >
        <h2 className="text-h2 font-bold">Assinaturas em risco (30 dias)</h2>
        <p className="mt-1 text-label text-muted-foreground">
          Vencimento próximo com sinal de desengajamento. Sem identidade do aluno.
        </p>
        <ul className="mt-4 grid gap-3">
          {data.subscriptionsAtRisk.map((item) => (
            <li
              key={item.subscriptionId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-4"
            >
              <span className="text-label font-semibold">{planLabel(item.plan)}</span>
              <span className="text-label">{item.riskSignal}</span>
              <span className="font-mono font-bold">{brl(item.amountBrl)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-label="Motivos declarados de cancelamento"
        className="mt-6 rounded-xl border border-border bg-card p-5"
      >
        <h2 className="text-h2 font-bold">Motivos de cancelamento</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.churnByReason.map((reason) => (
            <li key={reason.reason} className="rounded-lg border border-border p-4">
              <p className="text-label font-semibold">{reason.reason}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {`${reason.total} no total · ${reason.last90Days} nos últimos 90 dias`}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-label="MRR e ARR por plano"
        className="mt-6 rounded-xl border border-border bg-card p-5"
      >
        <h2 className="text-h2 font-bold">MRR e ARR por plano</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data.mrrByPlan.map((plan) => (
            <li key={plan.plan} className="rounded-lg border border-border p-4">
              <p className="text-label font-semibold">{planLabel(plan.plan)}</p>
              <p className="mt-2 font-mono text-h2 font-bold">{brl(plan.arrBrl)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {`ARR · MRR ${brl(plan.mrrBrl)} · ${plan.activeSubscriptions} assinaturas`}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-label="Custo de IA por modelo"
        className="mt-6 overflow-x-auto rounded-xl border border-border bg-card p-5"
      >
        <h2 className="text-h2 font-bold">Custo de IA por modelo</h2>
        <table className="mt-4 w-full text-label">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="p-3 text-left font-semibold">Modelo</th>
              <th className="p-3 text-right font-semibold">Trabalhos</th>
              <th className="p-3 text-right font-semibold">Tokens de entrada</th>
              <th className="p-3 text-right font-semibold">Tokens de saída</th>
              <th className="p-3 text-right font-semibold">Custo</th>
            </tr>
          </thead>
          <tbody>
            {data.aiCostByModel.map((row) => (
              <tr key={row.model} className="border-t border-border">
                <td className="p-3 font-mono">{row.model}</td>
                <td className="p-3 text-right font-mono">{row.jobs}</td>
                <td className="p-3 text-right font-mono">{row.tokensInput}</td>
                <td className="p-3 text-right font-mono">{row.tokensOutput}</td>
                <td className="p-3 text-right font-mono">
                  {row.costBrl === null ? '—' : brl(row.costBrl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

export function SummaryDashboard({ resource }: { resource: Resource }) {
  const load = useCallback(
    (signal?: AbortSignal): Promise<SummaryResponse> => {
      if (resource === 'system') return getSystemSummary(signal);
      if (resource === 'finance') return getFinanceSummary(signal);
      return getOverview(signal);
    },
    [resource],
  );
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
  const copy = COPY[resource];
  return (
    <div>
      <SectorHeader
        {...copy}
        meta={state.data.meta}
        refreshing={state.loading}
        onRefresh={() => void state.refresh()}
      />
      {state.error ? (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-destructive p-3 text-label text-destructive-foreground"
        >
          A última atualização falhou: {state.error}
        </p>
      ) : null}
      {resource === 'overview' ? (
        <OverviewSections data={(state.data as ControlCenterOverviewResponse).data} />
      ) : resource === 'system' ? (
        <SystemSections data={(state.data as ControlCenterSystemResponse).data} />
      ) : (
        <>
          <MetricGrid metrics={metricsFor(resource, state.data)} />
          <FinanceSections data={(state.data as ControlCenterFinanceResponse).data} />
        </>
      )}
      <DataQuality notes={state.data.meta.dataQuality} />
    </div>
  );
}
