'use client';

import { Handshake } from 'lucide-react';

import { getPartnerDistribution } from '@/lib/control-center-api';

import {
  DataQuality,
  ResourceState,
  SectorHeader,
  useControlCenterResource,
} from './control-center-ui';

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
        title="Sócios"
        icon={Handshake}
        meta={data.meta}
        refreshing={loading}
        onRefresh={() => void refresh()}
      />

      {/* Uma atualização que falha depois do primeiro carregamento não pode ser silenciosa:
          o valor na tela passa a ser antigo, e num setor financeiro isso engana. Mesmo
          banner dos demais setores do Control Center. */}
      {error ? (
        <p role="alert" className="mt-4 rounded-lg border border-coral bg-card p-3 text-label">
          {error}
        </p>
      ) : null}

      <section aria-label="Cap table vigente" className="mt-6 overflow-x-auto">
        <table className="w-full min-w-125 border-collapse text-label">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-4 font-semibold">Sócio</th>
              <th className="py-2 pr-4 font-semibold">Participação</th>
              <th className="py-2 pr-4 font-semibold">Desde</th>
            </tr>
          </thead>
          <tbody>
            {data.data.partners.map((partner) => (
              <tr key={partner.id} className="border-b border-border/60">
                <td className="py-2 pr-4">{partner.name}</td>
                <td className="py-2 pr-4 font-mono">{share(partner.shareBasisPoints)}</td>
                <td className="py-2 pr-4 text-muted-foreground">{partner.validFrom}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="py-2 pr-4">Total</td>
              <td className="py-2 pr-4 font-mono">{share(data.data.totalBasisPoints)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </section>

      <DataQuality notes={data.meta.dataQuality} />
    </div>
  );
}
