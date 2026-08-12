'use client';

import { useCallback } from 'react';
import type {
  ControlCenterFinanceResponse,
  ControlCenterOverviewResponse,
  ControlCenterSystemResponse,
} from '@movivo/shared';

import { getFinanceSummary, getOverview, getSystemSummary } from '@/lib/control-center-api';

import {
  DataQuality,
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
      'Sinais essenciais da operação. Métricas aproximadas ou sem fonte aparecem identificadas.',
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

function metricsFor(resource: Resource, response: SummaryResponse) {
  if (resource === 'overview') {
    const data = (response as ControlCenterOverviewResponse).data;
    return [
      { label: 'Assinaturas ativas', metric: data.activeSubscriptions },
      { label: 'Trials em andamento', metric: data.trials },
      { label: 'MRR contratado', metric: data.contractedMrr },
      { label: 'North Star', metric: data.northStar },
      { label: 'Alertas críticos', metric: data.criticalAlerts },
    ];
  }
  if (resource === 'system') {
    const data = (response as ControlCenterSystemResponse).data;
    return [
      { label: 'Latência do banco', metric: data.databaseLatency },
      { label: 'Latência do Redis', metric: data.redisLatency },
      { label: 'Jobs de IA', metric: data.aiJobs },
      { label: 'Falhas de IA', metric: data.aiFailures },
      { label: 'Jobs em DLQ', metric: data.aiDlq },
      { label: 'Latência média da IA', metric: data.aiAverageLatency },
      { label: 'Custo WhatsApp', metric: data.whatsappDeliveryCost },
      { label: 'Custo de infraestrutura', metric: data.infrastructureCost },
    ];
  }
  const data = (response as ControlCenterFinanceResponse).data;
  return [
    { label: 'Assinaturas ativas', metric: data.activeSubscriptions },
    { label: 'MRR contratado', metric: data.contractedMrr },
    { label: 'Custo de IA', metric: data.aiCost },
    { label: 'Custo WhatsApp', metric: data.whatsappCost },
    { label: 'Custo de infraestrutura', metric: data.infrastructureCost },
    { label: 'Receita recebida', metric: data.receivedRevenue },
  ];
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
      <MetricGrid metrics={metricsFor(resource, state.data)} />
      <DataQuality notes={state.data.meta.dataQuality} />
    </div>
  );
}
