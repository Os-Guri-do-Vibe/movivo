'use client';

/**
 * Lista dos agentes de IA da MOVIVO: quem são, o que fazem e a ficha de cada um. "Visualizar"
 * mostra a ficha publicada; "Editar" abre o rascunho (rascunho → teste → publicação) e é só de
 * ADMIN. O layout responde à largura do próprio painel (container query), não da janela: com ou
 * sem a barra lateral aberta, as colunas se alinham do mesmo jeito em todas as linhas.
 */
import { Eye, Pencil } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';

import {
  AGENT_PROFILE_GROUPS,
  AGENT_PROFILE_ROLES,
  agentDisplayName,
  agentTaskLabel,
  type AgentProfileKey,
  type AgentProfilesOverview,
} from '@movivo/shared';

import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { openAgentProfileDraft } from '@/lib/control-center-api';
import { cn } from '@/lib/utils';

import { ProfileEditor } from './agent-profiles';
import { CONTROL_H, ICON_BUTTON, StatusBadge, type StatusTone } from './control-center-table';

type Entry = AgentProfilesOverview['data'][number];
type Mode = 'view' | 'edit';

// O leitor de markdown (react-markdown) só é baixado quando alguém abre uma ficha.
const MarkdownView = lazy(() =>
  import('./markdown-view').then((module) => ({ default: module.MarkdownView })),
);

function ProfileSkeleton() {
  return (
    <div role="status" aria-label="Carregando a ficha" className="space-y-3">
      {['w-1/3', 'w-full', 'w-11/12', 'w-4/5'].map((width) => (
        <div key={width} className={cn('h-3 animate-pulse rounded bg-muted', width)} />
      ))}
    </div>
  );
}

const day = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' });

/** Mesma grade no cabeçalho e em todas as linhas: é o que mantém as colunas simétricas. */
const COLUMNS = '@3xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_9rem_6rem]';
const READ_ONLY_HINT = 'Somente contas ADMIN editam as fichas.';

function profileStatus(entry: Entry): { tone: StatusTone; label: string; title?: string } {
  const { published, openDraft } = entry;
  if (openDraft) {
    return {
      tone: 'neutral',
      label: `Rascunho v${openDraft.version}`,
      title: published
        ? `Há uma edição em andamento; a v${published.version} continua valendo.`
        : 'Há uma edição em andamento; ainda não existe ficha publicada.',
    };
  }
  if (published) return { tone: 'positive', label: `v${published.version} publicada` };
  return {
    tone: 'quiet',
    label: 'Sem ficha',
    title: 'Sem ficha publicada: o agente usa só o papel de cada tarefa.',
  };
}

function AgentRow({
  entry,
  canWrite,
  busy,
  onOpen,
}: {
  entry: Entry;
  canWrite: boolean;
  busy: boolean;
  onOpen: (mode: Mode) => void;
}) {
  const name = agentDisplayName(entry.agent);
  const status = profileStatus(entry);
  return (
    <li
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-muted/40 @3xl:px-5 @3xl:py-2 ${COLUMNS}`}
    >
      <p className="row-start-1 text-label font-medium @3xl:col-start-1">{name}</p>
      <p className="col-span-2 row-start-2 text-label text-muted-foreground @3xl:col-span-1 @3xl:col-start-2 @3xl:row-start-1">
        {AGENT_PROFILE_ROLES[entry.agent]}
      </p>
      <div className="col-span-2 row-start-3 justify-self-start @3xl:col-span-1 @3xl:col-start-3 @3xl:row-start-1">
        <StatusBadge tone={status.tone} title={status.title}>
          {status.label}
        </StatusBadge>
      </div>
      <div className="col-start-2 row-start-1 flex items-center justify-end gap-1 @3xl:col-start-4">
        <button
          type="button"
          className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), ICON_BUTTON)}
          aria-label={`Visualizar ${name}`}
          title="Visualizar"
          onClick={() => onOpen('view')}
        >
          <Eye aria-hidden="true" />
        </button>
        <span title={canWrite ? 'Editar' : READ_ONLY_HINT}>
          <button
            type="button"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), ICON_BUTTON)}
            aria-label={`Editar ${name}`}
            disabled={!canWrite || busy}
            onClick={() => onOpen('edit')}
          >
            <Pencil aria-hidden="true" />
          </button>
        </span>
      </div>
    </li>
  );
}

function Tasks({ entry }: { entry: Entry }) {
  return (
    <section aria-labelledby="agent-tasks" className="space-y-2">
      <h3 id="agent-tasks" className="text-xs font-medium text-muted-foreground">
        Tarefas que a ficha alimenta
      </h3>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {entry.tasks.map((taskId) => (
          <li key={taskId} className="px-3 py-2 text-label">
            {agentTaskLabel(taskId)}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AgentSheet({
  entry,
  mode,
  canWrite,
  busy,
  onClose,
  onEdit,
  onChanged,
}: {
  entry: Entry;
  mode: Mode;
  canWrite: boolean;
  busy: boolean;
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => Promise<void>;
}) {
  const { published, openDraft } = entry;
  const editing = mode === 'edit' && canWrite && openDraft;
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="top-0 right-0 left-auto h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 content-start gap-6 rounded-none border-0 border-l p-5 sm:max-w-xl sm:p-6">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-h3">{agentDisplayName(entry.agent)}</DialogTitle>
          <DialogDescription>{AGENT_PROFILE_ROLES[entry.agent]}</DialogDescription>
        </DialogHeader>

        {!editing ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <StatusBadge tone={published ? 'positive' : 'quiet'}>
              {published ? `Ficha v${published.version} publicada` : 'Sem ficha publicada'}
              {published?.publishedAt ? ` · ${day.format(new Date(published.publishedAt))}` : ''}
            </StatusBadge>
            <Button
              type="button"
              className={CONTROL_H}
              disabled={!canWrite || busy}
              title={canWrite ? undefined : READ_ONLY_HINT}
              onClick={onEdit}
            >
              <Pencil aria-hidden="true" />
              {openDraft ? 'Continuar o rascunho' : 'Editar ficha'}
            </Button>
          </div>
        ) : null}

        {editing ? (
          <ProfileEditor key={openDraft.id} draft={openDraft} onChanged={onChanged} />
        ) : (
          <section aria-labelledby="agent-profile" className="space-y-2">
            <h3 id="agent-profile" className="text-xs font-medium text-muted-foreground">
              Como este agente trabalha
            </h3>
            {published ? (
              <article className="rounded-xl border border-border bg-card p-4 sm:p-5">
                <Suspense fallback={<ProfileSkeleton />}>
                  <MarkdownView content={published.content} hideTitle />
                </Suspense>
              </article>
            ) : (
              <p className="rounded-lg border border-dashed border-border p-4 text-label text-muted-foreground">
                Este agente ainda não tem ficha publicada. Ele usa só o papel de cada tarefa.
              </p>
            )}
          </section>
        )}

        <Tasks entry={entry} />
      </DialogContent>
    </Dialog>
  );
}

export function AgentRoster({
  entries,
  canWrite,
  onChanged,
}: {
  entries: AgentProfilesOverview['data'];
  canWrite: boolean;
  onChanged: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<{ agent: AgentProfileKey; mode: Mode } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const byAgent = new Map(entries.map((entry) => [entry.agent, entry]));
  const current = selected ? byAgent.get(selected.agent) : undefined;

  async function open(entry: Entry, mode: Mode) {
    setError(null);
    if (mode === 'edit' && !entry.openDraft) {
      setBusy(true);
      try {
        await openAgentProfileDraft(entry.agent);
        await onChanged();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Não foi possível abrir o rascunho.');
        return;
      } finally {
        setBusy(false);
      }
    }
    setSelected({ agent: entry.agent, mode });
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p role="alert" className="text-label text-destructive">
          {error}
        </p>
      ) : null}
      {AGENT_PROFILE_GROUPS.map((group) => {
        const rows = group.agents.flatMap((agent) => byAgent.get(agent) ?? []);
        if (rows.length === 0) return null;
        return (
          <section key={group.id} aria-labelledby={`group-${group.id}`} className="space-y-2">
            <h2 id={`group-${group.id}`} className="text-label font-semibold">
              {group.label} <span className="font-normal text-muted-foreground">{rows.length}</span>
            </h2>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div
                aria-hidden="true"
                className={`hidden gap-x-4 border-b border-border bg-muted/40 px-5 py-2 text-xs font-medium text-muted-foreground @3xl:grid ${COLUMNS}`}
              >
                <span>Agente</span>
                <span>Função</span>
                <span>Ficha</span>
                <span className="text-right">Ações</span>
              </div>
              <ul className="divide-y divide-border">
                {rows.map((entry) => (
                  <AgentRow
                    key={entry.agent}
                    entry={entry}
                    canWrite={canWrite}
                    busy={busy}
                    onOpen={(mode) => void open(entry, mode)}
                  />
                ))}
              </ul>
            </div>
          </section>
        );
      })}
      {selected && current ? (
        <AgentSheet
          entry={current}
          mode={selected.mode}
          canWrite={canWrite}
          busy={busy}
          onClose={() => setSelected(null)}
          onEdit={() => void open(current, 'edit')}
          onChanged={onChanged}
        />
      ) : null}
    </div>
  );
}
