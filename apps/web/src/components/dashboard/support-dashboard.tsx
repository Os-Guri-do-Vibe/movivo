'use client';

import { Mail, Phone } from 'lucide-react';
import { useCallback } from 'react';

import { getSupportSummary } from '@/lib/control-center-api';

import {
  DataQuality,
  EmptyState,
  ResourceState,
  SectorHeader,
  useControlCenterResource,
} from './control-center-ui';

function text(value: string | null): string {
  return value?.trim() || 'Não informado';
}

export function SupportDashboard() {
  const load = useCallback((signal?: AbortSignal) => getSupportSummary(signal), []);
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
        title="Suporte"
        description="Contatos e situação operacional para atendimento. Dados de saúde não fazem parte desta projeção."
        meta={data.meta}
        refreshing={loading}
        onRefresh={() => void refresh()}
      />
      {error ? (
        <p role="alert" className="mt-4 rounded-lg border border-coral bg-card p-3 text-label">
          {error} Os dados abaixo são da última atualização concluída.
        </p>
      ) : null}

      {data.data.customers.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Nenhum contato disponível"
            description="Os contatos autorizados aparecerão aqui quando houver clientes no escopo de suporte."
          />
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 lg:grid-cols-2" aria-label="Contatos de suporte">
          {data.data.customers.map((customer) => (
            <li key={customer.id} className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-h3 font-semibold">{text(customer.name)}</h2>
              <div className="mt-3 space-y-2 text-label text-muted-foreground">
                <p className="flex items-center gap-2">
                  <Mail aria-hidden="true" className="size-4 shrink-0" />
                  <span className="truncate">{text(customer.email)}</span>
                </p>
                <p className="flex items-center gap-2">
                  <Phone aria-hidden="true" className="size-4 shrink-0" />
                  <span className="font-mono text-xs">{customer.phoneNumber}</span>
                </p>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-label">
                <div className="rounded-lg bg-secondary p-3">
                  <dt className="text-xs text-muted-foreground">Cadastro</dt>
                  <dd className="mt-1 font-semibold">{customer.status}</dd>
                </div>
                <div className="rounded-lg bg-secondary p-3">
                  <dt className="text-xs text-muted-foreground">Assinatura</dt>
                  <dd className="mt-1 font-semibold">{text(customer.subscriptionStatus)}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
      <DataQuality notes={data.meta.dataQuality} />
    </div>
  );
}
