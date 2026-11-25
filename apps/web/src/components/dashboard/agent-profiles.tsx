'use client';

/**
 * Editor da ficha de um agente: markdown versionado, rascunho → teste → publicação. Só ADMIN
 * chega aqui. Publicar exige passar nos casos de avaliação de todas as tarefas do agente, com o
 * modelo real.
 */
import { useState } from 'react';

import {
  AGENT_PROFILE_MAX_CHARS,
  AGENT_PROFILE_MIN_CHARS,
  agentTaskLabel,
  type AgentProfile,
  type AgentProfileTestResult,
} from '@movivo/shared';

import { Button } from '@/components/ui/button';
import {
  discardAgentProfile,
  publishAgentProfile,
  testAgentProfile,
  updateAgentProfile,
} from '@/lib/control-center-api';

import { ConfirmAction } from './confirm-action';

const STATUS_LABEL: Record<AgentProfile['status'], string> = {
  DRAFT: 'rascunho',
  TESTING: 'aprovado nos testes',
  PUBLISHED: 'publicada',
  SUPERSEDED: 'substituída',
  DISCARDED: 'descartada',
};
const field =
  'mt-1 w-full rounded-md border border-input bg-card p-2 font-mono text-label text-foreground';

export function ProfileEditor({
  draft,
  onChanged,
}: {
  draft: AgentProfile;
  onChanged: () => Promise<void>;
}) {
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
          maxLength={AGENT_PROFILE_MAX_CHARS}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          className={field}
        />
      </label>
      <p className="-mt-1 text-right text-xs text-muted-foreground tabular-nums">
        {content.length.toLocaleString('pt-BR')} / {AGENT_PROFILE_MAX_CHARS.toLocaleString('pt-BR')}{' '}
        caracteres
      </p>
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
              {e.passed ? 'Aprovado' : 'Reprovado'} · {agentTaskLabel(e.taskId)} · {e.casesPassed}/
              {e.casesTotal} casos · R$ {e.costBrl.toFixed(2)}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          disabled={
            busy !== null ||
            !dirty ||
            content.trim().length < AGENT_PROFILE_MIN_CHARS ||
            changeNote.trim().length < 3
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
