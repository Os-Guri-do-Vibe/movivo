'use client';

import { useCallback } from 'react';

import { getCampaigns } from '@/lib/control-center-api';
import { cn } from '@/lib/utils';

import {
  EmptyState,
  formatMetric,
  ResourceState,
  SectorHeader,
  useControlCenterResource,
} from './control-center-ui';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const SIGNALS = {
  GREEN: { label: 'Dentro da meta', className: 'bg-accent text-accent-foreground' },
  ATTENTION: { label: 'Atencao', className: 'bg-secondary text-secondary-foreground' },
  CRITICAL: { label: 'Fora da meta', className: 'bg-destructive/10 text-destructive' },
  UNKNOWN: { label: 'Sem base', className: 'border border-border text-muted-foreground' },
} as const;

export function CampaignsDashboard() {
  const load = useCallback((signal?: AbortSignal) => getCampaigns(signal), []);
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
  return (
    <div>
      <SectorHeader
        title="Campanhas & Experimentos"
        description="Economia por utm_campaign, calculada sobre primeiro toque, conversao na janela declarada e receita recebida. Grupos pequenos permanecem ocultos."
        meta={meta}
        refreshing={state.loading}
        onRefresh={() => void state.refresh()}
      />
      <p className="mt-4 text-label text-muted-foreground">
        Janela de atribuicao: {data.attributionWindowDays} dias · investimento total:{' '}
        {brl.format(data.mediaInvestmentBrl)} · {data.suppressedCampaigns} campanha(s) suprimida(s)
        por n&lt;{data.minimumSegmentSize}. Cada utm_campaign e tratada como uma celula de
        experimento; a tela nao altera campanhas nas plataformas de midia.
      </p>
      {data.campaigns.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Sem campanhas publicaveis"
            description={`Nenhuma utm_campaign alcancou ${data.minimumSegmentSize} cadastros atribuídos.`}
          />
        </div>
      ) : (
        <section
          className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3"
          aria-label="Economia por campanha"
        >
          {data.campaigns.map((campaign) => {
            const signal = SIGNALS[campaign.signal];
            return (
              <article
                key={`${campaign.channel}:${campaign.campaign}`}
                className="rounded-xl border border-border bg-card p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-h3 font-semibold">{campaign.campaign}</h2>
                    <p className="text-xs text-muted-foreground">{campaign.channel}</p>
                  </div>
                  <span
                    className={cn('rounded-full px-2 py-1 text-xs font-semibold', signal.className)}
                  >
                    {signal.label}
                  </span>
                </div>
                <p className="mt-3 text-label">
                  {campaign.students} cadastros · {campaign.converted} convertidos
                </p>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-label">
                  <div>
                    <dt className="text-xs text-muted-foreground">Investimento</dt>
                    <dd className="font-mono font-semibold">
                      {campaign.investmentBrl === null
                        ? 'sem investimento direto'
                        : brl.format(campaign.investmentBrl)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">CAC</dt>
                    <dd className="font-mono font-semibold">{formatMetric(campaign.cac)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Receita recebida</dt>
                    <dd className="font-mono font-semibold">
                      {formatMetric(campaign.receivedRevenue)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">ROAS</dt>
                    <dd className="font-mono font-semibold">{formatMetric(campaign.roas)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">LTV/CAC</dt>
                    <dd className="font-mono font-semibold">{formatMetric(campaign.ltvToCac)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Payback</dt>
                    <dd className="font-mono font-semibold">
                      {formatMetric(campaign.paybackMonths)}
                    </dd>
                  </div>
                </dl>
                {data.matureCohorts < 3 ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Baixa confianca: {data.matureCohorts} coorte(s) madura(s). E hipotese, nao
                    medida consolidada.
                  </p>
                ) : null}
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
