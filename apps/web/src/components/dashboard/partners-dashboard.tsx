'use client';

import { AlertTriangle } from 'lucide-react';

import { getPartnerDistribution } from '@/lib/control-center-api';

import { DataQuality, ResourceState, SectorHeader, useControlCenterResource } from './control-center-ui';

const brl = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

/** 2000 bps → "20,00%". Pontos-base inteiros, formatados só na exibição. */
const share = (basisPoints: number) =>
  `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(basisPoints / 100)}%`;

/**
 * Sócios & Distribuição (US-8.7). As três ressalvas de governança vêm do payload
 * (`caveats`), não são texto do frontend: o número nunca é exibido sem elas.
 */
export function PartnersDashboard() {
  const { data, error, forbidden, loading, refresh } =
    useControlCenterResource(getPartnerDistribution);

  if (!data) {
    return (
      <ResourceState
        loading={loading}
        error={error}
        forbidden={forbidden}
        onRetry={() => void refresh()}
      />
    );
  }

  return (
    <div>
      <SectorHeader
        title="Sócios & Distribuição"
        description="Participação vigente de cada sócio e quanto caberia a cada um do lucro do período. Número gerencial de referência — leia as ressalvas antes de tratá-lo como retirada."
        meta={data.meta}
        refreshing={loading}
        onRefresh={() => void refresh()}
      />

      <section aria-label="Lucro do período" className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="text-label font-semibold">Lucro apurado · {data.data.period}</h2>
        <p className="mt-3 font-mono text-h1 font-bold">
          {data.data.profitAvailable ? brl(data.data.profitCents) : '—'}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {data.data.profitDefinition}
        </p>
      </section>

      <section aria-label="Distribuição por sócio" className="mt-6 overflow-x-auto">
        <table className="w-full min-w-125 border-collapse text-label">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-4 font-semibold">Sócio</th>
              <th className="py-2 pr-4 font-semibold">Participação</th>
              <th className="py-2 pr-4 font-semibold">Desde</th>
              <th className="py-2 text-right font-semibold">Caberia no período</th>
            </tr>
          </thead>
          <tbody>
            {data.data.partners.map((partner) => (
              <tr key={partner.id} className="border-b border-border/60">
                <td className="py-2 pr-4">{partner.name}</td>
                <td className="py-2 pr-4 font-mono">{share(partner.shareBasisPoints)}</td>
                <td className="py-2 pr-4 text-muted-foreground">{partner.validFrom}</td>
                <td className="py-2 text-right font-mono">
                  {data.data.profitAvailable ? brl(partner.amountCents) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="py-2 pr-4">Total</td>
              <td className="py-2 pr-4 font-mono">{share(data.data.totalBasisPoints)}</td>
              <td />
              <td className="py-2 text-right font-mono">
                {data.data.profitAvailable
                  ? brl(data.data.partners.reduce((sum, item) => sum + item.amountCents, 0))
                  : '—'}
              </td>
            </tr>
          </tfoot>
        </table>
      </section>

      <aside
        aria-labelledby="caveats-title"
        className="mt-6 rounded-xl border border-amber-500/40 bg-secondary p-4"
      >
        <h2 id="caveats-title" className="flex items-center gap-2 text-label font-semibold">
          <AlertTriangle aria-hidden="true" className="size-4" /> O que este número não é
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-label text-muted-foreground">
          {data.data.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      </aside>

      <DataQuality notes={data.meta.dataQuality} />
    </div>
  );
}
