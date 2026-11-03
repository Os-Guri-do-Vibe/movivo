'use client';

/**
 * Agentes de IA: a lista de quem trabalha na MOVIVO (cada um com a sua ficha, que se vê e se
 * edita aqui), o resultado dos testes de cada tarefa, o modelo que atende cada nível e o custo
 * por aluno. A lista é a aba inicial; o restante é operação e fica uma aba adiante.
 */
import { Bot } from 'lucide-react';
import { useCallback, useState, type KeyboardEvent } from 'react';
import type { ModelTierName } from '@movivo/shared';

import { cn } from '@/lib/utils';
import {
  getAgentCosts,
  getAgentProfiles,
  getAgents,
  saveTierRoutes,
} from '@/lib/control-center-api';

import { AgentRoster } from './agent-roster';
import { TIER_INFO, vendorLabel } from './agents-labels';
import { CostsTab, ModelsTab, TestsTab } from './agents-tabs';
import { CONTROL_H, FOCUS_RING } from './control-center-table';
import { ResourceState, SectorHeader, useControlCenterResource } from './control-center-ui';

const TABS = [
  { id: 'agentes', label: 'Agentes' },
  { id: 'testes', label: 'Testes' },
  { id: 'modelos', label: 'Modelos' },
  { id: 'custos', label: 'Custos' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function Tabs({ active, onChange }: { active: TabId; onChange: (tab: TabId) => void }) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = TABS.findIndex((tab) => tab.id === active);
    const next = TABS[(index + step + TABS.length) % TABS.length];
    if (!next) return;
    onChange(next.id);
    document.getElementById(`agents-tab-${next.id}`)?.focus();
  }
  return (
    <div
      role="tablist"
      aria-label="Seções do painel de agentes"
      onKeyDown={onKeyDown}
      className="flex border-b border-border"
    >
      {TABS.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            id={`agents-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`agents-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              '-mb-px flex-1 border-b-2 px-4 text-label font-medium transition-colors sm:flex-none',
              CONTROL_H,
              FOCUS_RING,
              selected
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function AgentsPanel({
  canWriteTiers,
  canWriteProfiles = false,
}: {
  canWriteTiers: boolean;
  canWriteProfiles?: boolean;
}) {
  const load = useCallback((signal?: AbortSignal) => getAgents(signal), []);
  const loadCosts = useCallback((signal?: AbortSignal) => getAgentCosts(30, signal), []);
  const loadProfiles = useCallback((signal?: AbortSignal) => getAgentProfiles(signal), []);
  const {
    data,
    error,
    forbidden,
    loading,
    refresh,
    updatedAt: updated,
  } = useControlCenterResource(load);
  const costs = useControlCenterResource(loadCosts);
  const profiles = useControlCenterResource(loadProfiles);
  const [tab, setTab] = useState<TabId>('agentes');
  // O painel junta três cargas (tarefas e modelos, custos, fichas): vale a mais recente.
  const updatedAt = [updated, costs.updatedAt, profiles.updatedAt].reduce<Date | null>(
    (latest, at) => (at && (!latest || at > latest) ? at : latest),
    null,
  );
  const [notice, setNotice] = useState('');

  async function promote(tier: ModelTierName, index: number) {
    const current = data?.tiers.find((t) => t.tier === tier);
    if (!current || index === 0) return;
    const routes = [...current.routes];
    const [moved] = routes.splice(index, 1);
    if (!moved) return;
    routes.unshift(moved);
    try {
      await saveTierRoutes(tier, { routes });
      setNotice(
        `${vendorLabel(moved.vendor)} · ${moved.model} agora é a IA principal de “${TIER_INFO[tier].name}”.`,
      );
      await refresh();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Não foi possível salvar.');
    }
  }

  const refreshAll = () => {
    void refresh();
    void costs.refresh();
    void profiles.refresh();
  };

  return (
    <section className="@container mx-auto w-full max-w-6xl space-y-6" aria-label="Agentes de IA">
      <SectorHeader
        title="Agentes de IA"
        icon={Bot}
        updatedAt={updatedAt}
        refreshing={loading || profiles.loading}
        onRefresh={refreshAll}
      />
      <Tabs active={tab} onChange={setTab} />

      <div role="tabpanel" id={`agents-panel-${tab}`} aria-labelledby={`agents-tab-${tab}`}>
        {tab === 'agentes' ? (
          profiles.data ? (
            <AgentRoster
              entries={profiles.data}
              canWrite={canWriteProfiles}
              onChanged={() => profiles.refresh()}
            />
          ) : (
            <ResourceState
              loading={profiles.loading}
              error={profiles.error}
              forbidden={profiles.forbidden}
              onRetry={() => void profiles.refresh()}
            />
          )
        ) : null}

        {tab === 'testes' || tab === 'modelos' ? (
          <ResourceState
            loading={loading && !data}
            error={error}
            forbidden={forbidden}
            onRetry={() => void refresh()}
          />
        ) : null}

        {tab === 'testes' && data ? <TestsTab tasks={data.tasks} /> : null}

        {tab === 'modelos' && data ? (
          <ModelsTab
            overview={data}
            canWrite={canWriteTiers}
            notice={notice}
            onPromote={(tier, index) => void promote(tier, index)}
          />
        ) : null}

        {tab === 'custos' ? (
          costs.data ? (
            <CostsTab costs={costs.data} />
          ) : (
            <ResourceState
              loading={costs.loading}
              error={costs.error}
              forbidden={costs.forbidden}
              onRetry={() => void costs.refresh()}
            />
          )
        ) : null}
      </div>
    </section>
  );
}
