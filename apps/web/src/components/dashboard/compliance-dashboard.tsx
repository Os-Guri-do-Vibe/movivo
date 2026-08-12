'use client';

import { useCallback } from 'react';

import { getComplianceSummary } from '@/lib/control-center-api';

import {
  DataQuality,
  EmptyState,
  MetricGrid,
  ResourceState,
  SectorHeader,
  useControlCenterResource,
} from './control-center-ui';

function technicalReference(value: string): string {
  return `#${value.slice(0, 8)}`;
}

function eventDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

export function ComplianceDashboard() {
  const load = useCallback((signal?: AbortSignal) => getComplianceSummary(signal), []);
  const { data, error, forbidden, loading, refresh } = useControlCenterResource(load);

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
        title="Compliance e auditoria"
        description="Consentimentos, solicitações de privacidade e rastreabilidade dos acessos sensíveis."
        meta={data.meta}
        refreshing={loading}
        onRefresh={() => void refresh()}
      />
      {error ? (
        <p role="alert" className="mt-4 rounded-lg border border-coral bg-card p-3 text-label">
          {error} Os dados abaixo são da última atualização concluída.
        </p>
      ) : null}
      <MetricGrid
        metrics={[
          { label: 'Consentimentos ativos', metric: data.data.activeConsents },
          { label: 'Consentimentos revogados', metric: data.data.revokedConsents },
          { label: 'Leituras de saúde auditadas', metric: data.data.auditedHealthReads },
          { label: 'Solicitações de privacidade', metric: data.data.privacyRequests },
        ]}
      />

      <section
        className="mt-6 rounded-xl border border-border bg-card p-5"
        aria-labelledby="audit-events"
      >
        <h2 id="audit-events" className="text-h2 font-bold">
          Eventos recentes de auditoria
        </h2>
        <p className="mt-2 text-label text-muted-foreground">
          Identificadores são exibidos como referências técnicas curtas; o registro integral
          permanece no servidor.
        </p>
        {data.data.recentAuditEvents.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Sem eventos recentes"
              description="Novos acessos e mudanças auditáveis aparecerão nesta trilha."
            />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[48rem] border-collapse text-left text-label">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th scope="col" className="p-3 font-semibold">
                    Data
                  </th>
                  <th scope="col" className="p-3 font-semibold">
                    Ação
                  </th>
                  <th scope="col" className="p-3 font-semibold">
                    Ator
                  </th>
                  <th scope="col" className="p-3 font-semibold">
                    Titular
                  </th>
                  <th scope="col" className="p-3 font-semibold">
                    Entidade
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.data.recentAuditEvents.map((event) => (
                  <tr key={event.id} className="border-b border-border last:border-0">
                    <td className="p-3 whitespace-nowrap">{eventDate(event.createdAt)}</td>
                    <td className="p-3 font-semibold">{event.action}</td>
                    <td className="p-3 font-mono text-xs">{technicalReference(event.actorId)}</td>
                    <td className="p-3 font-mono text-xs">{technicalReference(event.subjectId)}</td>
                    <td className="p-3">{event.entityType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <DataQuality notes={data.meta.dataQuality} />
    </div>
  );
}
