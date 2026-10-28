'use client';

/** Agentes de IA: tarefas e o resultado dos testes, o modelo que atende cada nível e o custo por aluno. */
import { Bot } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { ModelTierName } from '@movivo/shared';

import { Button } from '@/components/ui/button';
import { getAgentCosts, getAgents, saveTierRoutes } from '@/lib/control-center-api';

import { StatusBadge } from './control-center-table';
import { ResourceState, SectorHeader, useControlCenterResource } from './control-center-ui';

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 4,
});
const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

export function AgentsPanel({ canWriteTiers }: { canWriteTiers: boolean }) {
  const load = useCallback((signal?: AbortSignal) => getAgents(signal), []);
  const loadCosts = useCallback((signal?: AbortSignal) => getAgentCosts(30, signal), []);
  const { data, error, forbidden, loading, refresh } = useControlCenterResource(load);
  const costs = useControlCenterResource(loadCosts);
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
      setNotice(`Rota ${moved.vendor} · ${moved.model} agora é a primeira do nível ${tier}.`);
      await refresh();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Não foi possível salvar.');
    }
  }

  return (
    <section className="space-y-8" aria-label="Agentes de IA">
      <SectorHeader
        title="Agentes de IA"
        icon={Bot}
        refreshing={loading}
        onRefresh={() => void refresh()}
      />
      <ResourceState
        loading={loading && !data}
        error={error}
        forbidden={forbidden}
        onRetry={() => void refresh()}
      />

      {data ? (
        <>
          <div className="space-y-3">
            <h2 className="text-h3 font-semibold">Tarefas e testes</h2>
            <ul className="space-y-2">
              {data.tasks.map((task) => (
                <li
                  key={task.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border bg-card p-4"
                >
                  <span className="font-mono text-xs">{task.id}</span>
                  <span className="text-xs text-muted-foreground">nível {task.tier}</span>
                  <span className="text-xs text-muted-foreground">
                    prompt {task.promptVersion.slice(0, 8)}
                  </span>
                  <span className="ml-auto">
                    {task.lastEval ? (
                      <StatusBadge
                        tone={
                          task.lastEval.passed && task.lastEval.current ? 'positive' : 'attention'
                        }
                      >
                        {task.lastEval.casesPassed}/{task.lastEval.casesTotal} casos
                        {task.lastEval.current ? '' : ' (prompt mudou desde o teste)'} ·{' '}
                        {dateTime.format(new Date(task.lastEval.finishedAt))}
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="quiet">
                        {task.cases > 0 ? 'nunca testada' : 'sem casos'}
                      </StatusBadge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-3">
            <h2 className="text-h3 font-semibold">Modelo de cada nível</h2>
            <p className="max-w-prose text-xs text-muted-foreground">
              Os agentes pedem uma capacidade, nunca um modelo. A primeira rota é a preferida; as
              seguintes assumem se ela falhar. Dados de saúde só vão a fornecedores aprovados na
              diligência (ADR-005-R2).
            </p>
            {notice ? (
              <p role="status" className="text-xs font-medium">
                {notice}
              </p>
            ) : null}
            {data.tiers.map((tier) => (
              <div key={tier.tier} className="rounded-xl border border-border bg-card p-4">
                <p className="text-label font-medium">
                  {tier.tier}{' '}
                  <span className="text-xs font-normal text-muted-foreground">({tier.source})</span>
                </p>
                <ol className="mt-2 space-y-1">
                  {tier.routes.map((route, index) => (
                    <li
                      key={`${route.vendor}-${route.model}`}
                      className="flex items-center gap-3 text-xs"
                    >
                      <span className="w-4 text-muted-foreground">{index + 1}.</span>
                      <span>
                        {route.vendor} · {route.model}
                      </span>
                      {canWriteTiers && index > 0 ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void promote(tier.tier, index)}
                          aria-label={`Tornar ${route.model} a primeira rota de ${tier.tier}`}
                        >
                          Tornar primeira
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {costs.data ? (
        <div className="space-y-3">
          <h2 className="text-h3 font-semibold">Custo de IA (últimos {costs.data.days} dias)</h2>
          <p className="text-label">
            Total {brl.format(costs.data.totalBrl)} · {costs.data.students} aluno(s) · média{' '}
            {brl.format(costs.data.avgPerStudentBrl)} por aluno
          </p>
          <ul className="space-y-1">
            {costs.data.byTask.map((row) => (
              <li key={row.taskId} className="flex flex-wrap gap-x-4 text-xs">
                <span className="font-mono">{row.taskId}</span>
                <span className="text-muted-foreground">
                  {row.calls} chamadas · {row.failed} falhas · {Math.round(row.avgLatencyMs)} ms
                </span>
                <span className="ml-auto">{brl.format(row.costBrl)}</span>
              </li>
            ))}
          </ul>
          <details className="text-xs">
            <summary className="cursor-pointer font-medium">Alunos que mais custam</summary>
            <ul className="mt-2 space-y-1">
              {costs.data.byStudent.map((row) => (
                <li key={row.userId ?? 'sem-aluno'} className="flex gap-x-4">
                  <span>{row.name ?? 'Aluno sem nome'}</span>
                  <span className="text-muted-foreground">{row.calls} chamadas</span>
                  <span className="ml-auto">{brl.format(row.costBrl)}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      ) : null}
    </section>
  );
}
