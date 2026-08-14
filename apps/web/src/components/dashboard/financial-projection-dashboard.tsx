'use client';

import { useCallback } from 'react';

import { getFinanceSummary } from '@/lib/control-center-api';

import {
  EmptyState,
  formatMetric,
  ResourceState,
  SectorHeader,
  useControlCenterResource,
} from './control-center-ui';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const labels = {
  CONSERVATIVE: 'Conservador',
  BASE: 'Base',
  OPTIMISTIC: 'Otimista',
} as const;

function monthLabel(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${value}-01T00:00:00Z`),
  );
}

export function FinancialProjectionDashboard() {
  const load = useCallback((signal?: AbortSignal) => getFinanceSummary(signal), []);
  const state = useControlCenterResource(load);
  if (!state.data) {
    return <ResourceState loading={state.loading} error={state.error} forbidden={state.forbidden} onRetry={() => void state.refresh()} />;
  }
  const { data, meta } = state.data;
  const projection = data.projection;
  return (
    <div>
      <SectorHeader
        title="Resultado & Projeção"
        description="O realizado permanece separado dos três cenários projetados. As projeções apoiam decisão dos fundadores; não são promessa de receita ou resultado."
        meta={meta}
        refreshing={state.loading}
        onRefresh={() => void state.refresh()}
      />

      <section className="mt-6 rounded-xl border border-border bg-card p-5" aria-labelledby="realized-result">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Realizado · mês corrente</p>
        <h2 id="realized-result" className="mt-2 font-mono text-h1 font-bold">{formatMetric(data.profit)}</h2>
        <p className="mt-2 text-label text-muted-foreground">{data.profit.definition}</p>
      </section>

      {projection.status === 'UNAVAILABLE' ? (
        <div className="mt-6"><EmptyState title="Projeção ainda indisponível" description={projection.reason ?? 'Base histórica insuficiente.'} /></div>
      ) : (
        <>
          <section className="mt-6 rounded-xl border border-border bg-secondary p-5" aria-labelledby="projection-basis">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Projetado · não realizado</p>
            <h2 id="projection-basis" className="mt-2 text-h2 font-bold">Base de cálculo</h2>
            <p className="mt-2 text-label text-muted-foreground">{projection.method}</p>
            <p className="mt-2 text-xs text-muted-foreground">Meses fechados usados: {projection.basisMonths.map(monthLabel).join(', ')}. Horizonte: {projection.horizonMonths} meses.</p>
          </section>

          <section className="mt-6 grid gap-4 xl:grid-cols-3" aria-label="Cenários projetados">
            {projection.scenarios.map((scenario) => <article key={scenario.scenario} className="rounded-xl border border-border bg-card p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cenário projetado</p>
              <h2 className="mt-1 text-h2 font-bold">{labels[scenario.scenario]}</h2>
              <p className="mt-3 font-mono text-h1 font-bold">{brl.format(scenario.totalResultBrl)}</p>
              <p className="text-xs text-muted-foreground">Resultado acumulado projetado em 3 meses</p>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-label"><div><dt className="text-xs text-muted-foreground">Receita projetada</dt><dd className="font-mono font-semibold">{brl.format(scenario.totalRevenueBrl)}</dd></div><div><dt className="text-xs text-muted-foreground">Custo projetado</dt><dd className="font-mono font-semibold">{brl.format(scenario.totalCostBrl)}</dd></div></dl>
              <ul className="mt-4 grid gap-2">{scenario.months.map((month) => <li key={month.month} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-label"><span>{monthLabel(month.month)}</span><span className="font-mono font-semibold">{brl.format(month.projectedResultBrl)}</span></li>)}</ul>
            </article>)}
          </section>
        </>
      )}
    </div>
  );
}
