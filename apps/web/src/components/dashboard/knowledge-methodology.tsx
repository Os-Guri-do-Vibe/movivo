'use client';

import { CheckCircle2, GitCompareArrows, Lock, RotateCcw, Send, XCircle } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  ControlCenterApiError,
  createMethodologyVersion,
  getMethodology,
  publishMethodologyVersion,
  reviewMethodologyVersion,
  rollbackMethodologyVersion,
  submitMethodologyVersion,
  type MethodologyStatus,
  type MethodologyVersionView,
} from '@/lib/control-center-api';

import { ResourceState, useControlCenterResource } from './control-center-ui';

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-body focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none';

const STATUS_LABEL: Record<MethodologyStatus, string> = {
  DRAFT: 'Rascunho',
  IN_REVIEW: 'Em revisão',
  APPROVED: 'Aprovada',
  PUBLISHED: 'Publicada',
  REJECTED: 'Rejeitada',
  ARCHIVED: 'Arquivada',
};

type WorkflowAction =
  | { kind: 'submit'; version: MethodologyVersionView }
  | { kind: 'approve'; version: MethodologyVersionView }
  | { kind: 'reject'; version: MethodologyVersionView }
  | { kind: 'publish'; version: MethodologyVersionView }
  | { kind: 'rollback'; version: MethodologyVersionView };

function dateLabel(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

function DiffPreview({ current, candidate }: { current: string; candidate: string }) {
  const currentLines = current.split('\n');
  const candidateLines = candidate.split('\n');
  const changed = candidateLines.filter((line, index) => line !== currentLines[index]).length;
  return (
    <div className="mt-5 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold">
          <GitCompareArrows aria-hidden="true" className="size-4" />
          Comparação com a versão vigente
        </h3>
        <span className="font-mono text-xs text-muted-foreground">
          {changed} linha(s) alterada(s)
        </span>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {[
          { label: 'Vigente', lines: currentLines, peer: candidateLines },
          { label: 'Versão selecionada', lines: candidateLines, peer: currentLines },
        ].map((column) => (
          <div key={column.label}>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {column.label}
            </p>
            <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-secondary p-4 font-mono text-xs whitespace-pre-wrap">
              {column.lines.map((line, index) => (
                <span
                  key={`${index}-${line.slice(0, 12)}`}
                  className={line !== column.peer[index] ? 'block bg-coral/10' : 'block'}
                >
                  {line || ' '}
                  {'\n'}
                </span>
              ))}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}

export function KnowledgeMethodologyPanel({
  canEdit = false,
  canApprove = false,
}: {
  canEdit?: boolean;
  canApprove?: boolean;
}) {
  const { data, error, forbidden, loading, refresh } = useControlCenterResource(getMethodology);
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [compareId, setCompareId] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowAction | null>(null);
  const [workflowNote, setWorkflowNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [writeError, setWriteError] = useState('');

  const versions = useMemo(() => data?.data.versions ?? [], [data]);
  const current =
    versions.find((version) => version.current) ??
    versions.find((version) => version.status === 'PUBLISHED');
  const compared = versions.find((version) => version.id === compareId) ?? null;

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

  async function saveDraft(event: FormEvent) {
    event.preventDefault();
    if (content.trim().length < 200 || changeNote.trim().length < 10) return;
    setBusy(true);
    setWriteError('');
    try {
      await createMethodologyVersion({
        content: content.trim(),
        changeNote: changeNote.trim(),
      });
      setEditing(false);
      setContent('');
      setChangeNote('');
      setFeedback('Nova versão salva como rascunho. Ela ainda não afeta a IA.');
      await refresh();
    } catch (caught) {
      setWriteError(
        caught instanceof ControlCenterApiError
          ? caught.message
          : 'Não foi possível salvar o rascunho.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function runWorkflow() {
    if (!workflow || workflowNote.trim().length < 5) return;
    setBusy(true);
    setWriteError('');
    try {
      if (workflow.kind === 'submit') {
        await submitMethodologyVersion(workflow.version.id, workflowNote.trim());
        setFeedback('Versão enviada para revisão do profissional CREF.');
      } else if (workflow.kind === 'approve') {
        await reviewMethodologyVersion(workflow.version.id, {
          decision: 'APPROVED',
          note: workflowNote.trim(),
        });
        setFeedback('Versão aprovada. A publicação ainda exige uma confirmação separada.');
      } else if (workflow.kind === 'reject') {
        await reviewMethodologyVersion(workflow.version.id, {
          decision: 'REJECTED',
          note: workflowNote.trim(),
        });
        setFeedback('Versão rejeitada. O histórico foi preservado.');
      } else if (workflow.kind === 'publish') {
        await publishMethodologyVersion(workflow.version.id, workflowNote.trim());
        setFeedback('Versão publicada e disponível para novas gerações.');
      } else {
        await rollbackMethodologyVersion(workflow.version.id, workflowNote.trim());
        setFeedback('Rollback solicitado como uma nova versão auditável.');
      }
      setWorkflow(null);
      setWorkflowNote('');
      await refresh();
    } catch (caught) {
      setWriteError(
        caught instanceof ControlCenterApiError
          ? caught.message
          : 'Não foi possível concluir a transição.',
      );
    } finally {
      setBusy(false);
    }
  }

  function openWorkflow(action: WorkflowAction) {
    setWriteError('');
    setWorkflowNote('');
    setWorkflow(action);
  }

  return (
    <section aria-labelledby="methodology-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="methodology-title" className="text-h2 font-bold">
            Metodologia oficial
          </h2>
          <p className="mt-2 max-w-3xl text-label text-muted-foreground">
            Somente a versão publicada orienta a geração. Rascunhos e versões em revisão ficam
            isolados do runtime.
          </p>
        </div>
        {canEdit ? (
          <Button
            onClick={() => {
              setContent(current?.content ?? '');
              setChangeNote('');
              setEditing(true);
            }}
          >
            Criar nova versão
          </Button>
        ) : null}
      </div>

      {feedback ? (
        <p
          role="status"
          className="mt-4 rounded-lg border border-border bg-secondary p-3 text-label"
        >
          {feedback}
        </p>
      ) : null}
      {writeError ? (
        <p role="alert" className="mt-4 rounded-lg border border-coral bg-card p-3 text-label">
          {writeError}
        </p>
      ) : null}

      {current ? (
        <article className="mt-6 rounded-xl border border-verde-pulso/50 bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Versão vigente
              </p>
              <h3 className="mt-1 font-mono text-h2 font-bold">v{current.version}</h3>
            </div>
            <span className="rounded-full bg-verde-pulso/15 px-3 py-1 text-xs font-semibold text-petroleo">
              Publicada
            </span>
          </div>
          <p className="mt-3 text-label text-muted-foreground">
            Publicada em {dateLabel(current.publishedAt ?? current.createdAt)} ·{' '}
            {current.createdBy ?? 'responsável não informado'}
          </p>
          {current.sha256 ? (
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              SHA-256 {current.sha256.slice(0, 16)}…
            </p>
          ) : null}
          <details className="mt-4">
            <summary className="cursor-pointer text-label font-semibold">
              Visualizar conteúdo vigente
            </summary>
            <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-secondary p-4 font-mono text-xs whitespace-pre-wrap">
              {current.content}
            </pre>
          </details>
        </article>
      ) : (
        <p className="mt-6 rounded-xl border border-coral bg-card p-5 text-label">
          Nenhuma metodologia publicada. A geração deve permanecer bloqueada até a publicação por um
          profissional CREF.
        </p>
      )}

      {editing ? (
        <form
          className="mt-6 rounded-xl border border-border bg-card p-5"
          onSubmit={(event) => void saveDraft(event)}
        >
          <h3 className="font-semibold">Nova versão</h3>
          <label className="mt-4 block text-label font-semibold">
            Conteúdo metodológico
            <textarea
              className={`${INPUT_CLASS} min-h-80 font-mono text-xs`}
              required
              minLength={200}
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">
              Sem teto de caracteres — é o texto completo que a IA usa tanto para gerar protocolo
              quanto para responder o aluno no AI Coach, junto com o contexto individualizado de
              cada aluno (não um resumo à parte).
            </span>
          </label>
          <label className="mt-4 block text-label font-semibold">
            Motivo da mudança
            <input
              className={INPUT_CLASS}
              required
              minLength={10}
              maxLength={500}
              value={changeNote}
              onChange={(event) => setChangeNote(event.target.value)}
            />
          </label>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock aria-hidden="true" className="size-3.5" />
            Salvar cria um rascunho e não altera a versão usada pela IA.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={busy || content.trim().length < 200 || changeNote.trim().length < 10}
            >
              Salvar rascunho
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : null}

      <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[760px] text-label">
          <caption className="p-4 text-left text-xs text-muted-foreground">
            Versões preservadas para revisão, comparação e rollback auditável.
          </caption>
          <thead className="border-t border-border text-xs text-muted-foreground">
            <tr>
              <th className="p-3 text-left">Versão</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Responsável</th>
              <th className="p-3 text-left">Alteração</th>
              <th className="p-3 text-left">Ações</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((version) => (
              <tr key={version.id} className="border-t border-border align-top">
                <td className="p-3 font-mono">v{version.version}</td>
                <td className="p-3">
                  <span className="rounded-full bg-secondary px-2 py-1 text-xs font-semibold">
                    {STATUS_LABEL[version.status]}
                  </span>
                </td>
                <td className="p-3">
                  {version.createdBy ?? '—'}
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {dateLabel(version.createdAt)}
                  </span>
                </td>
                <td className="max-w-xs p-3 text-muted-foreground">
                  {version.changeNote ?? 'Sem nota registrada'}
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setCompareId(version.id)}>
                      Comparar
                    </Button>
                    {canEdit && version.status === 'DRAFT' ? (
                      <Button size="sm" onClick={() => openWorkflow({ kind: 'submit', version })}>
                        <Send aria-hidden="true" />
                        Enviar à revisão
                      </Button>
                    ) : null}
                    {canApprove && version.status === 'IN_REVIEW' ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() => openWorkflow({ kind: 'approve', version })}
                        >
                          <CheckCircle2 aria-hidden="true" />
                          Aprovar
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => openWorkflow({ kind: 'reject', version })}
                        >
                          <XCircle aria-hidden="true" />
                          Rejeitar
                        </Button>
                      </>
                    ) : null}
                    {canApprove && version.status === 'APPROVED' ? (
                      <Button size="sm" onClick={() => openWorkflow({ kind: 'publish', version })}>
                        <CheckCircle2 aria-hidden="true" />
                        Publicar
                      </Button>
                    ) : null}
                    {canEdit && version.status === 'ARCHIVED' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openWorkflow({ kind: 'rollback', version })}
                      >
                        <RotateCcw aria-hidden="true" />
                        Restaurar
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {versions.length === 0 ? (
          <p className="border-t border-border p-5 text-label text-muted-foreground">
            Nenhuma versão cadastrada.
          </p>
        ) : null}
      </div>

      {compared && current ? (
        <DiffPreview current={current.content} candidate={compared.content} />
      ) : null}

      <Dialog
        open={workflow !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setWorkflow(null);
            setWorkflowNote('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {workflow?.kind === 'approve'
                ? 'Aprovar versão?'
                : workflow?.kind === 'publish'
                  ? 'Publicar versão aprovada?'
                  : workflow?.kind === 'reject'
                    ? 'Rejeitar versão?'
                    : workflow?.kind === 'rollback'
                      ? 'Restaurar esta metodologia?'
                      : 'Enviar para revisão?'}
            </DialogTitle>
            <DialogDescription>
              A transição será registrada com seu usuário, data e justificativa. Publicações passam
              a orientar novas gerações.
            </DialogDescription>
          </DialogHeader>
          {writeError ? (
            <p role="alert" className="rounded-lg border border-coral bg-card p-3 text-label">
              {writeError}
            </p>
          ) : null}
          <label className="text-label font-semibold">
            Justificativa obrigatória
            <input
              autoFocus
              className={INPUT_CLASS}
              minLength={5}
              maxLength={500}
              value={workflowNote}
              onChange={(event) => setWorkflowNote(event.target.value)}
            />
          </label>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" disabled={busy} onClick={() => setWorkflow(null)}>
              Voltar e revisar
            </Button>
            <Button
              variant={workflow?.kind === 'reject' ? 'destructive' : 'default'}
              disabled={busy || workflowNote.trim().length < 5}
              onClick={() => void runWorkflow()}
            >
              {busy ? 'Registrando…' : 'Confirmar transição'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
