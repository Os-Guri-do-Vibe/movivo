'use client';

/**
 * Abas de acompanhamento do painel de agentes: Testes (as tarefas estão acertando?), Modelos (qual
 * IA atende cada tipo de tarefa) e Custos (quanto a IA gastou). Todas seguem o mesmo molde da
 * lista de agentes: cartão com borda fina, linhas separadas, colunas iguais em todas as linhas e
 * um cabeçalho que só aparece quando o painel é largo o bastante para virar tabela.
 */
import type { ReactNode } from 'react';
import type { AgentCosts, AgentsOverview, ModelTierName } from '@movivo/shared';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { plural, taskParts, testStatus, TIER_INFO, vendorLabel } from './agents-labels';
import { StatusBadge } from './control-center-table';

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
const date = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});
const formatDate = (iso: string) => date.format(new Date(iso));
const seconds = (ms: number) =>
  `${(ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`;

const ROW =
  'grid items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/40 @3xl:px-5';
const HEADER =
  'hidden gap-x-4 border-b border-border bg-muted/40 px-5 py-2 text-xs font-medium text-muted-foreground @3xl:grid';

function Intro({ children }: { children: ReactNode }) {
  return <p className="max-w-prose text-label text-muted-foreground">{children}</p>;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-h3 font-semibold">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-border p-6 text-center text-label text-muted-foreground">
      {children}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Testes                                                                     */
/* -------------------------------------------------------------------------- */

const TESTS_COLUMNS = '@3xl:grid-cols-[minmax(0,2fr)_9rem_minmax(0,2fr)]';

export function TestsTab({ tasks }: { tasks: AgentsOverview['tasks'] }) {
  const rows = tasks
    .map((task) => ({ task, status: testStatus(task, formatDate) }))
    .sort((a, b) => a.status.rank - b.status.rank);
  const approved = rows.filter((r) => r.status.rank === 2).length;
  const attention = rows.filter((r) => r.status.rank === 0).length;
  const untested = rows.length - approved - attention;

  return (
    <div className="space-y-4">
      <Intro>
        Antes de uma ficha ou metodologia ir ao ar, cada tarefa dos agentes responde a situações de
        teste, como exemplos de alunos. Aqui você vê quais tarefas estão acertando. Quem precisa de
        ação aparece primeiro.
      </Intro>
      <div className="grid gap-4 @md:grid-cols-3">
        <Stat label="Aprovadas" value={String(approved)} hint="Acertaram o último teste" />
        <Stat
          label="Precisam de atenção"
          value={String(attention)}
          hint="Reprovadas ou desatualizadas"
        />
        <Stat label="Sem teste" value={String(untested)} hint="Nunca testadas ou sem situações" />
      </div>
      {rows.length === 0 ? (
        <Empty>Nenhuma tarefa cadastrada.</Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div aria-hidden="true" className={cn(HEADER, TESTS_COLUMNS)}>
            <span>Tarefa</span>
            <span>Resultado</span>
            <span>Último teste</span>
          </div>
          <ul className="divide-y divide-border">
            {rows.map(({ task, status }) => {
              const { area, action } = taskParts(task.id);
              return (
                <li
                  key={task.id}
                  className={cn(ROW, 'grid-cols-[minmax(0,1fr)_auto]', TESTS_COLUMNS)}
                >
                  <div className="min-w-0 @3xl:col-start-1">
                    <p className="text-label font-medium">{action}</p>
                    {area ? <p className="text-xs text-muted-foreground">{area}</p> : null}
                  </div>
                  <div className="justify-self-end @3xl:col-start-2 @3xl:justify-self-start">
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  </div>
                  <p className="col-span-2 text-label text-muted-foreground @3xl:col-span-1 @3xl:col-start-3">
                    {status.detail}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Modelos                                                                    */
/* -------------------------------------------------------------------------- */

export function ModelsTab({
  overview,
  canWrite,
  notice,
  onPromote,
}: {
  overview: AgentsOverview;
  canWrite: boolean;
  notice: string;
  onPromote: (tier: ModelTierName, index: number) => void;
}) {
  return (
    <div className="space-y-4">
      <Intro>
        Cada tarefa dos agentes pede um tipo de capacidade, nunca uma IA específica. Aqui você
        escolhe qual IA atende cada tipo. A <strong className="font-medium">principal</strong> é a
        usada primeiro; se ela falhar, a próxima da lista assume. A troca vale na hora e fica
        registrada. Dados de saúde só são enviados a fornecedores aprovados na diligência de
        privacidade.
      </Intro>
      {notice ? (
        <p role="status" className="text-label font-medium">
          {notice}
        </p>
      ) : null}
      <div className="grid gap-4 @3xl:grid-cols-2">
        {overview.tiers.map((tier) => {
          const info = TIER_INFO[tier.tier];
          const uses = overview.tasks.filter((task) => task.tier === tier.tier).length;
          return (
            <section
              key={tier.tier}
              aria-label={info.name}
              className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 @3xl:p-5"
            >
              <header className="space-y-1">
                <h3 className="text-body font-semibold">{info.name}</h3>
                <p className="text-label text-muted-foreground">{info.description}</p>
                <p className="text-xs text-muted-foreground">
                  {plural(uses, 'tarefa usa', 'tarefas usam')} este tipo ·{' '}
                  {tier.source === 'PAINEL' ? 'Escolhido no painel' : 'Padrão do sistema'}
                </p>
              </header>
              <ol className="divide-y divide-border rounded-lg border border-border">
                {tier.routes.map((route, index) => (
                  <li
                    key={`${route.vendor}-${route.model}`}
                    className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2"
                  >
                    <StatusBadge tone={index === 0 ? 'positive' : 'quiet'}>
                      {index === 0 ? 'Principal' : 'Reserva'}
                    </StatusBadge>
                    <p className="min-w-0 text-label break-words">
                      <span className="font-medium">{vendorLabel(route.vendor)}</span>
                      <span className="text-muted-foreground"> · {route.model}</span>
                    </p>
                    {canWrite && index > 0 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onPromote(tier.tier, index)}
                        aria-label={`Tornar ${route.model} a IA principal de ${info.name}`}
                      >
                        Tornar principal
                      </Button>
                    ) : (
                      <span aria-hidden="true" />
                    )}
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Custos                                                                     */
/* -------------------------------------------------------------------------- */

const COSTS_COLUMNS =
  '@3xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_7rem]';

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="@3xl:text-right">
      <p className="text-xs text-muted-foreground @3xl:hidden">{label}</p>
      <p className="text-label tabular-nums">{children}</p>
    </div>
  );
}

export function CostsTab({ costs }: { costs: AgentCosts }) {
  return (
    <div className="space-y-4">
      <Intro>
        Quanto a IA custou nos últimos {costs.days} dias, calculado a partir do uso registrado de
        cada modelo. Um valor alto em uma tarefa mostra onde vale otimizar.
      </Intro>
      <div className="grid gap-4 @md:grid-cols-3">
        <Stat label="Gasto total" value={brl.format(costs.totalBrl)} />
        <Stat label="Alunos atendidos" value={String(costs.students)} />
        <Stat label="Média por aluno" value={brl.format(costs.avgPerStudentBrl)} />
      </div>

      {costs.byTask.length === 0 ? (
        <Empty>Ainda não houve uso de IA neste período.</Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div aria-hidden="true" className={cn(HEADER, COSTS_COLUMNS)}>
            <span>Tarefa</span>
            <span className="text-right">Vezes usada</span>
            <span className="text-right">Com falha</span>
            <span className="text-right">Tempo de resposta</span>
            <span className="text-right">Custo</span>
          </div>
          <ul className="divide-y divide-border">
            {costs.byTask.map((row) => {
              const { area, action } = taskParts(row.taskId);
              return (
                <li
                  key={row.taskId}
                  className={cn(ROW, 'grid-cols-[minmax(0,1fr)_auto]', COSTS_COLUMNS)}
                >
                  <div className="min-w-0 @3xl:col-start-1">
                    <p className="text-label font-medium">{action}</p>
                    {area ? <p className="text-xs text-muted-foreground">{area}</p> : null}
                  </div>
                  <p className="text-label font-medium tabular-nums @3xl:col-start-5 @3xl:row-start-1 @3xl:text-right">
                    {brl.format(row.costBrl)}
                  </p>
                  <div className="col-span-2 grid grid-cols-3 gap-x-4 @3xl:contents">
                    <Metric label="Vezes usada">{row.calls}</Metric>
                    <Metric label="Com falha">{row.failed}</Metric>
                    <Metric label="Tempo de resposta">{seconds(row.avgLatencyMs)}</Metric>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {costs.byStudent.length > 0 ? (
        <details className="group rounded-xl border border-border bg-card">
          <summary className="cursor-pointer rounded-xl px-4 py-3 text-label font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring @3xl:px-5">
            Custo por aluno{' '}
            <span className="font-normal text-muted-foreground">
              (os {costs.byStudent.length} que mais custaram)
            </span>
          </summary>
          <ul className="divide-y divide-border border-t border-border">
            {costs.byStudent.map((row) => (
              <li
                key={row.userId ?? 'sem-aluno'}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-3 @3xl:px-5"
              >
                <div className="min-w-0">
                  <p className="text-label font-medium">{row.name ?? 'Aluno sem nome'}</p>
                  <p className="text-xs text-muted-foreground">
                    {plural(row.calls, 'uso de IA', 'usos de IA')}
                  </p>
                </div>
                <p className="text-label tabular-nums">{brl.format(row.costBrl)}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
