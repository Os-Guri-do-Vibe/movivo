'use client';

/**
 * Fichas dos agentes: quem é cada especialista de IA e como trabalha, em markdown versionado.
 * Todos com acesso ao painel de agentes leem; só ADMIN edita, testa e publica. Publicar exige
 * passar nos casos de avaliação de todas as tarefas do agente, com o modelo real.
 */
import { useCallback, useState } from 'react';

import {
  AGENT_PROFILE_LABELS,
  type AgentProfile,
  type AgentProfileTestResult,
  type AgentProfilesOverview,
} from '@movivo/shared';

import { Button } from '@/components/ui/button';
import {
  discardAgentProfile,
  getAgentProfiles,
  openAgentProfileDraft,
  publishAgentProfile,
  testAgentProfile,
  updateAgentProfile,
} from '@/lib/control-center-api';

import { ConfirmAction } from './confirm-action';
import { ResourceState, useControlCenterResource } from './control-center-ui';

type Entry = AgentProfilesOverview['data'][number];

const STATUS_LABEL: Record<AgentProfile['status'], string> = {
  DRAFT: 'rascunho',
  TESTING: 'aprovado nos testes',
  PUBLISHED: 'publicada',
  SUPERSEDED: 'substituída',
  DISCARDED: 'descartada',
};
const field =
  'mt-1 w-full rounded-md border border-input bg-card p-2 font-mono text-label text-foreground';
const day = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' });

function Editor({ draft, onChanged }: { draft: AgentProfile; onChanged: () => Promise<void> }) {
  const savedNote = draft.changeNote === 'Rascunho' ? '' : draft.changeNote;
  const [content, setContent] = useState(draft.content);
  const [changeNote, setChangeNote] = useState(savedNote);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AgentProfileTestResult | null>(null);
  const dirty = content !== draft.content || changeNote !== savedNote;

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir a ação.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-4 space-y-3 border-t border-border pt-4">
      <p className="text-xs text-muted-foreground">
        Rascunho v{draft.version} · {STATUS_LABEL[draft.status]}. Qualquer edição invalida o teste
        anterior.
      </p>
      <label className="block text-xs text-muted-foreground">
        Ficha (markdown)
        <textarea
          rows={14}
          maxLength={6000}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          className={field}
        />
      </label>
      <label className="block text-xs text-muted-foreground">
        O que mudou e por quê
        <input
          maxLength={500}
          value={changeNote}
          onChange={(event) => setChangeNote(event.target.value)}
          className={field}
        />
      </label>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {result ? (
        <ul className="space-y-1 text-xs">
          {result.evaluations.map((e) => (
            <li key={e.taskId}>
              {e.passed ? 'Aprovado' : 'Reprovado'} · {e.taskId} · {e.casesPassed}/{e.casesTotal}{' '}
              casos · R$ {e.costBrl.toFixed(2)}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          disabled={
            busy !== null || !dirty || content.trim().length < 80 || changeNote.trim().length < 3
          }
          onClick={() =>
            void run('save', () =>
              updateAgentProfile(draft.id, { content, changeNote: changeNote.trim() }),
            )
          }
        >
          {busy === 'save' ? 'Salvando…' : 'Salvar rascunho'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy !== null || dirty}
          onClick={() => void run('test', async () => setResult(await testAgentProfile(draft.id)))}
        >
          {busy === 'test' ? 'Testando com o modelo real…' : 'Testar'}
        </Button>
        {draft.status === 'TESTING' ? (
          <ConfirmAction
            triggerLabel="Publicar"
            title="Publicar esta ficha?"
            description="Ela passa a valer em todas as tarefas do agente em até um minuto."
            confirmLabel="Publicar"
            onConfirm={() => run('publish', () => publishAgentProfile(draft.id))}
          />
        ) : null}
        <ConfirmAction
          triggerLabel="Descartar"
          triggerVariant="ghost"
          title="Descartar o rascunho?"
          description="A ficha publicada continua valendo."
          confirmLabel="Descartar"
          onConfirm={() => run('discard', () => discardAgentProfile(draft.id))}
        />
      </div>
    </div>
  );
}

function ProfileCard({
  entry,
  canWrite,
  onChanged,
}: {
  entry: Entry;
  canWrite: boolean;
  onChanged: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const { published, openDraft } = entry;
  return (
    <article className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-h3 font-semibold">{AGENT_PROFILE_LABELS[entry.agent]}</h2>
        <span className="text-xs text-muted-foreground">
          {published
            ? `v${published.version} publicada${published.publishedAt ? ` em ${day.format(new Date(published.publishedAt))}` : ''}`
            : 'sem ficha publicada (usa só o papel de cada tarefa)'}
        </span>
      </header>
      <p className="mt-1 text-xs text-muted-foreground">Tarefas: {entry.tasks.join(', ')}</p>
      {published ? (
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">
          {published.content}
        </pre>
      ) : null}
      {canWrite && openDraft ? (
        <Editor key={openDraft.id} draft={openDraft} onChanged={onChanged} />
      ) : null}
      {canWrite && !openDraft ? (
        <div className="mt-3">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              void openAgentProfileDraft(entry.agent)
                .then(onChanged)
                .catch((err: unknown) =>
                  setError(
                    err instanceof Error ? err.message : 'Não foi possível abrir o rascunho.',
                  ),
                )
            }
          >
            {published ? 'Editar ficha' : 'Criar ficha'}
          </Button>
          {error ? (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function AgentProfiles({ canWrite }: { canWrite: boolean }) {
  const load = useCallback((signal?: AbortSignal) => getAgentProfiles(signal), []);
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
    <section className="space-y-6" aria-label="Fichas dos agentes">
      <header className="space-y-1">
        <h1 className="text-h2 font-semibold">Fichas dos agentes</h1>
        <p className="max-w-prose text-label text-muted-foreground">
          Quem é cada especialista de IA e como trabalha. A ficha entra no prompt de todas as
          tarefas do agente, abaixo da constituição da MOVIVO e acima da metodologia dos
          profissionais. Só vai ao ar depois de passar nos casos de avaliação.
          {canWrite ? '' : ' Somente contas ADMIN editam.'}
        </p>
      </header>
      {data.map((entry) => (
        <ProfileCard
          key={entry.agent}
          entry={entry}
          canWrite={canWrite}
          onChanged={async () => {
            await refresh();
          }}
        />
      ))}
    </section>
  );
}
