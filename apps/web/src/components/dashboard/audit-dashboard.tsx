'use client';

import type { AuditSearchQuery } from '@movivo/shared';
import { Search } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { getAuditEvents } from '@/lib/control-center-api';

import { ResourceState, SectorHeader, useControlCenterResource } from './control-center-ui';

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-label focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none';
const INITIAL: AuditSearchQuery = { page: 1, pageSize: 25 };

function shortId(value: string): string {
  return `${value.slice(0, 8)}…`;
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

export function AuditDashboard() {
  const [form, setForm] = useState<AuditSearchQuery>(INITIAL);
  const [applied, setApplied] = useState<AuditSearchQuery>(INITIAL);
  const load = useCallback((signal?: AbortSignal) => getAuditEvents(applied, signal), [applied]);
  const { data, error, forbidden, loading, refresh } = useControlCenterResource(load);

  const apply = (event: FormEvent) => {
    event.preventDefault();
    setApplied({ ...form, page: 1 });
  };
  const move = (page: number) => {
    const next = { ...applied, page };
    setForm(next);
    setApplied(next);
  };

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

  const { events, actors, actions, pagination } = data.data;
  return (
    <div>
      <SectorHeader
        title="Auditoria"
        description="Busca operacional na trilha imutável. Cada consulta também fica registrada para preservar a cadeia de responsabilidade."
        meta={data.meta}
        refreshing={loading}
        onRefresh={() => void refresh()}
      />

      <form
        className="mt-6 grid gap-4 rounded-xl border border-border bg-card p-5 md:grid-cols-2 xl:grid-cols-5"
        onSubmit={apply}
      >
        <label className="text-label font-semibold">
          Ator
          <select
            className={INPUT_CLASS}
            value={form.actorId ?? ''}
            onChange={(event) =>
              setForm((value) => ({ ...value, actorId: event.target.value || undefined }))
            }
          >
            <option value="">Todos</option>
            {actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name ?? shortId(actor.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-label font-semibold">
          Tipo de ação
          <select
            className={INPUT_CLASS}
            value={form.action ?? ''}
            onChange={(event) =>
              setForm((value) => ({ ...value, action: event.target.value || undefined }))
            }
          >
            <option value="">Todas</option>
            {actions.map((action) => (
              <option key={action}>{action}</option>
            ))}
          </select>
        </label>
        <label className="text-label font-semibold">
          De
          <input
            type="date"
            className={INPUT_CLASS}
            value={form.from ?? ''}
            onChange={(event) =>
              setForm((value) => ({ ...value, from: event.target.value || undefined }))
            }
          />
        </label>
        <label className="text-label font-semibold">
          Até
          <input
            type="date"
            className={INPUT_CLASS}
            value={form.to ?? ''}
            onChange={(event) =>
              setForm((value) => ({ ...value, to: event.target.value || undefined }))
            }
          />
        </label>
        <Button className="self-end" type="submit">
          <Search aria-hidden="true" />
          Buscar
        </Button>
      </form>

      <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[760px] text-label">
          <caption className="p-4 text-left text-xs text-muted-foreground">
            {pagination.total} evento(s) encontrado(s). Identificadores são abreviados apenas na
            tela.
          </caption>
          <thead className="border-t border-border text-xs text-muted-foreground">
            <tr>
              <th className="p-3 text-left">Data</th>
              <th className="p-3 text-left">Ator</th>
              <th className="p-3 text-left">Ação</th>
              <th className="p-3 text-left">Entidade</th>
              <th className="p-3 text-left">Titular</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-t border-border">
                <td className="p-3 whitespace-nowrap">{dateLabel(event.createdAt)}</td>
                <td className="p-3">
                  {event.actorName ?? shortId(event.actorId)}{' '}
                  <span className="font-mono text-xs text-muted-foreground">
                    {shortId(event.actorId)}
                  </span>
                </td>
                <td className="p-3 font-mono text-xs">{event.action}</td>
                <td className="p-3">
                  {event.entityType}{' '}
                  <span className="font-mono text-xs text-muted-foreground">
                    {shortId(event.entityId)}
                  </span>
                </td>
                <td className="p-3 font-mono text-xs">{shortId(event.subjectId)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {events.length === 0 ? (
          <p className="border-t border-border p-5 text-label text-muted-foreground">
            Nenhum evento para os filtros escolhidos.
          </p>
        ) : null}
      </div>

      <nav
        className="mt-4 flex items-center justify-between gap-3"
        aria-label="Paginação da auditoria"
      >
        <Button
          variant="outline"
          disabled={pagination.page <= 1}
          onClick={() => move(pagination.page - 1)}
        >
          Anterior
        </Button>
        <p className="text-label">
          Página {pagination.page} de {Math.max(pagination.totalPages, 1)}
        </p>
        <Button
          variant="outline"
          disabled={pagination.page >= pagination.totalPages}
          onClick={() => move(pagination.page + 1)}
        >
          Próxima
        </Button>
      </nav>
    </div>
  );
}
