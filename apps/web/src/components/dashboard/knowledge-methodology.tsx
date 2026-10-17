'use client';

import { MAX_METHODOLOGY_NOTE_LENGTH } from '@movivo/shared';
import {
  BookOpenText,
  CheckCircle2,
  ChevronDown,
  GitCompareArrows,
  Plus,
  RotateCcw,
  Rocket,
  X,
  XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';

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
  type MethodologyResponse,
  type MethodologyStatus,
  type MethodologyVersionView,
} from '@/lib/control-center-api';
import { countWords, diffLines } from '@/lib/text-diff';
import { cn } from '@/lib/utils';

import { StatusBadge, type StatusTone } from './control-center-table';
import { KNOWLEDGE_CHANGED_EVENT } from './knowledge-base-shell';
import { ResourceState, useControlCenterResource } from './control-center-ui';
import { DiffStat, MethodologyCompareDialog } from './methodology-diff';
import { MethodologyEditor } from './methodology-editor';

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-body focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none';

const STATUS_LABEL: Record<MethodologyStatus, string> = {
  DRAFT: 'Rascunho',
  IN_REVIEW: 'Em revisão',
  APPROVED: 'Aprovada',
  PUBLISHED: 'Publicada',
  REJECTED: 'Rejeitada',
  ARCHIVED: 'Arquivada',
};

const STATUS_TONE: Record<MethodologyStatus, StatusTone> = {
  DRAFT: 'neutral',
  IN_REVIEW: 'neutral',
  APPROVED: 'neutral',
  PUBLISHED: 'positive',
  REJECTED: 'attention',
  ARCHIVED: 'quiet',
};

/** Estados que ainda não valem para a IA e que um administrador pode colocar em vigor. */
const PENDING: readonly MethodologyStatus[] = ['DRAFT', 'IN_REVIEW', 'APPROVED'];

const numberFormat = new Intl.NumberFormat('pt-BR');

function dateLabel(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

function versionNumber(version: MethodologyVersionView): number {
  const parsed = Number(version.version);
  if (Number.isFinite(parsed)) return parsed;
  const digits = /(\d+)\s*$/.exec(String(version.version));
  return digits ? Number(digits[1]) : 0;
}

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof ControlCenterApiError ? caught.message : fallback;
}

interface Feedback {
  text: string;
}

function FeedbackBanner({ feedback, onDismiss }: { feedback: Feedback; onDismiss: () => void }) {
  return (
    <div
      role="status"
      className="mt-5 flex items-start gap-3 rounded-xl border border-verde-pulso/50 bg-verde-pulso/10 p-4 text-label"
    >
      <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <p className="flex-1 font-medium">{feedback.text}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="-m-1 flex size-8 items-center justify-center rounded-md opacity-70 hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none"
      >
        <X aria-hidden="true" className="size-4" />
        <span className="sr-only">Dispensar aviso</span>
      </button>
    </div>
  );
}

function ContentReader({ content, summary }: { content: string; summary: string }) {
  return (
    <details className="group mt-4">
      <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-label font-semibold hover:underline focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none">
        <ChevronDown
          aria-hidden="true"
          className="size-4 transition-transform group-open:rotate-180"
        />
        {summary}
      </summary>
      <pre className="mt-2 max-h-[28rem] overflow-auto rounded-lg border border-border bg-background p-4 font-mono text-[13px] leading-6 whitespace-pre-wrap">
        {content}
      </pre>
    </details>
  );
}

type ReviewAction = { kind: 'approve' | 'reject'; version: MethodologyVersionView };

export function KnowledgeMethodologyPanel({
  canEdit = false,
  canApprove = false,
}: {
  canEdit?: boolean;
  canApprove?: boolean;
}) {
  const { data, error, forbidden, loading, refresh, setData } =
    useControlCenterResource(getMethodology);
  const [editing, setEditing] = useState<{ initial: string } | null>(null);
  const [compare, setCompare] = useState<{
    open: boolean;
    baseId: string | null;
    targetId: string | null;
  }>({ open: false, baseId: null, targetId: null });
  const [review, setReview] = useState<ReviewAction | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [writeError, setWriteError] = useState('');
  const [editorError, setEditorError] = useState('');

  const versions = useMemo(
    () => [...(data?.data.versions ?? [])].sort((a, b) => versionNumber(b) - versionNumber(a)),
    [data],
  );
  const current =
    versions.find((version) => version.current) ??
    versions.find((version) => version.status === 'PUBLISHED');
  const pending = versions.find(
    (version) =>
      version.id !== current?.id &&
      PENDING.includes(version.status) &&
      (!current || versionNumber(version) > versionNumber(current)),
  );

  // O que cada versão mudou em relação à anterior, para o histórico.
  const deltas = useMemo(() => {
    const result = new Map<string, { added: number; removed: number }>();
    versions.forEach((version, index) => {
      const previous = versions[index + 1];
      if (!previous) return;
      const diff = diffLines(previous.content, version.content);
      result.set(version.id, { added: diff.added, removed: diff.removed });
    });
    return result;
  }, [versions]);

  const pendingDelta = useMemo(() => {
    if (!pending || !current) return null;
    const diff = diffLines(current.content, pending.content);
    return { added: diff.added, removed: diff.removed };
  }, [pending, current]);

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

  const nextVersion = (versions[0] ? versionNumber(versions[0]) : 0) + 1;
  /** ADMIN (escreve + aprova) publica direto do rascunho; quem só aprova publica o que foi aprovado. */
  const canPublish = (version: MethodologyVersionView) =>
    version.id !== current?.id &&
    (version.status === 'APPROVED'
      ? canApprove
      : PENDING.includes(version.status) && canEdit && canApprove);

  const previousOf = (version: MethodologyVersionView) =>
    versions[versions.findIndex((item) => item.id === version.id) + 1] ?? null;

  function openCompare(baseId: string | null, targetId: string | null) {
    setCompare({ open: true, baseId, targetId });
  }

  function apply(response: MethodologyResponse) {
    setData(response);
    window.dispatchEvent(new Event(KNOWLEDGE_CHANGED_EVENT));
  }

  async function publish(version: MethodologyVersionView) {
    setBusyKey(`publish:${version.id}`);
    setWriteError('');
    try {
      apply(await publishMethodologyVersion(version.id));
      setFeedback({
        text: `A v${version.version} foi publicada. A IA já usa este texto nas próximas gerações de protocolo e conversas.`,
      });
    } catch (caught) {
      setWriteError(errorMessage(caught, 'Não foi possível publicar esta versão.'));
    } finally {
      setBusyKey(null);
    }
  }

  async function restore(version: MethodologyVersionView) {
    setBusyKey(`restore:${version.id}`);
    setWriteError('');
    try {
      let response = await rollbackMethodologyVersion(version.id);
      const copy = [...response.data.versions]
        .filter((item) => item.status === 'DRAFT' && item.content === version.content)
        .sort((a, b) => versionNumber(b) - versionNumber(a))[0];
      apply(response);
      if (copy && canEdit && canApprove) {
        response = await publishMethodologyVersion(copy.id);
        apply(response);
        setFeedback({
          text: `O texto da v${version.version} voltou a valer como v${copy.version}.`,
        });
      } else {
        setFeedback({
          text: `O texto da v${version.version} foi restaurado como rascunho${copy ? ` v${copy.version}` : ''}. Publique quando quiser colocá-lo em vigor.`,
        });
      }
    } catch (caught) {
      setWriteError(errorMessage(caught, 'Não foi possível restaurar esta versão.'));
    } finally {
      setBusyKey(null);
    }
  }

  async function saveVersion(input: { content: string; changeNote: string; publish: boolean }) {
    setBusyKey('editor');
    setEditorError('');
    setWriteError('');
    let saved: MethodologyResponse;
    try {
      saved = await createMethodologyVersion({
        content: input.content,
        changeNote: input.changeNote || undefined,
      });
    } catch (caught) {
      setEditorError(errorMessage(caught, 'Não foi possível salvar o rascunho.'));
      setBusyKey(null);
      return;
    }
    apply(saved);
    setEditing(null);
    const draft = [...saved.data.versions]
      .filter((item) => item.status === 'DRAFT' && item.content.trim() === input.content)
      .sort((a, b) => versionNumber(b) - versionNumber(a))[0];
    try {
      if (input.publish && draft) {
        apply(await publishMethodologyVersion(draft.id));
        setFeedback({
          text: `A v${draft.version} foi salva e publicada. A IA já usa este texto nas próximas gerações.`,
        });
      } else {
        setFeedback({
          text: `Rascunho${draft ? ` v${draft.version}` : ''} salvo. Ele ainda não afeta a IA; publique quando estiver pronto.`,
        });
      }
    } catch (caught) {
      setWriteError(
        `${errorMessage(caught, 'Não foi possível publicar.')} O rascunho foi salvo e pode ser publicado abaixo.`,
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function submitReview() {
    if (!review || reviewNote.trim().length < 5) return;
    setBusyKey('review');
    setWriteError('');
    try {
      apply(
        await reviewMethodologyVersion(review.version.id, {
          decision: review.kind === 'approve' ? 'APPROVED' : 'REJECTED',
          note: reviewNote.trim(),
        }),
      );
      setFeedback({
        text:
          review.kind === 'approve'
            ? `A v${review.version.version} foi aprovada e já pode ser publicada.`
            : `A v${review.version.version} foi rejeitada. O histórico foi preservado.`,
      });
      setReview(null);
      setReviewNote('');
    } catch (caught) {
      setWriteError(errorMessage(caught, 'Não foi possível registrar o parecer.'));
    } finally {
      setBusyKey(null);
    }
  }

  function startEditing() {
    setEditorError('');
    setFeedback(null);
    setEditing({ initial: current?.content ?? '' });
  }

  return (
    <section aria-labelledby="methodology-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="methodology-title" className="text-h2 font-bold">
            Metodologia oficial
          </h2>
          <p className="mt-2 max-w-3xl text-label text-muted-foreground">
            É o texto que orienta a IA ao montar protocolos e conversar com os alunos. Só a versão
            publicada vale; rascunhos ficam guardados sem afetar ninguém.
          </p>
        </div>
        {canEdit && !editing ? (
          <Button onClick={startEditing}>
            <Plus aria-hidden="true" />
            Nova versão
          </Button>
        ) : null}
      </div>

      {feedback ? <FeedbackBanner feedback={feedback} onDismiss={() => setFeedback(null)} /> : null}
      {writeError ? (
        <p
          role="alert"
          className="mt-5 rounded-xl border border-coral bg-coral/10 p-4 text-label font-medium"
        >
          {writeError}
        </p>
      ) : null}

      {pending && !editing ? (
        <section
          aria-label="Versão aguardando publicação"
          className="mt-6 rounded-xl border-2 border-verde-pulso/60 bg-verde-pulso/10 p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-wide uppercase">Aguardando publicação</p>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <h3 className="font-mono text-h2 font-bold">v{pending.version}</h3>
                <StatusBadge tone={STATUS_TONE[pending.status]} variant="solid">
                  {STATUS_LABEL[pending.status]}
                </StatusBadge>
              </div>
              <p className="mt-2 text-label">{pending.changeNote ?? 'Sem resumo da alteração.'}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {pending.createdBy ?? 'Autor não informado'} · {dateLabel(pending.createdAt)}
                </span>
                {pendingDelta && current ? (
                  <span className="inline-flex items-center gap-2">
                    <DiffStat added={pendingDelta.added} removed={pendingDelta.removed} />
                    em relação à v{current.version}
                  </span>
                ) : null}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => openCompare(current?.id ?? null, pending.id)}
              >
                <GitCompareArrows aria-hidden="true" />
                Ver mudanças
              </Button>
              {canPublish(pending) ? (
                <Button disabled={busyKey !== null} onClick={() => void publish(pending)}>
                  <Rocket aria-hidden="true" />
                  {busyKey === `publish:${pending.id}`
                    ? 'Publicando…'
                    : `Publicar v${pending.version}`}
                </Button>
              ) : null}
            </div>
          </div>
          {!canPublish(pending) ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Para publicar esta versão é preciso uma conta com permissão de publicação.
            </p>
          ) : null}
        </section>
      ) : null}

      {editing ? (
        <MethodologyEditor
          baseContent={current?.content ?? ''}
          baseLabel={current ? `v${current.version} (vigente)` : null}
          initialContent={editing.initial}
          nextVersion={nextVersion}
          canPublish={canEdit && canApprove}
          busy={busyKey === 'editor'}
          error={editorError}
          onSave={(input) => void saveVersion(input)}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      {current ? (
        <article className="mt-6 overflow-hidden rounded-xl border border-border border-l-4 border-l-verde-pulso bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <BookOpenText aria-hidden="true" className="size-3.5" />
                Em vigor agora
              </p>
              <h3 className="mt-1 font-mono text-h1 font-bold">v{current.version}</h3>
            </div>
            <StatusBadge tone="positive" variant="solid">
              Publicada
            </StatusBadge>
          </div>
          <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-label">
            <div>
              <dt className="text-xs text-muted-foreground">Publicada em</dt>
              <dd>{dateLabel(current.publishedAt ?? current.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Autor</dt>
              <dd>{current.createdBy ?? 'Não informado'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Tamanho</dt>
              <dd>
                {numberFormat.format(countWords(current.content))} palavras ·{' '}
                {numberFormat.format(current.content.length)} caracteres
              </dd>
            </div>
            {current.sha256 ? (
              <div>
                <dt className="text-xs text-muted-foreground">Assinatura SHA-256</dt>
                <dd className="font-mono text-xs">{current.sha256.slice(0, 16)}…</dd>
              </div>
            ) : null}
          </dl>
          {current.changeNote ? (
            <p className="mt-3 text-label text-muted-foreground">“{current.changeNote}”</p>
          ) : null}
          <ContentReader content={current.content} summary="Ler o texto vigente" />
        </article>
      ) : (
        <div className="mt-6 rounded-xl border border-dashed border-coral bg-card p-8 text-center">
          <p className="text-h3 font-bold">Nenhuma metodologia em vigor</p>
          <p className="mx-auto mt-2 max-w-xl text-label text-muted-foreground">
            Sem uma versão publicada a geração de protocolos fica bloqueada.{' '}
            {canEdit
              ? 'Escreva a primeira metodologia e publique.'
              : 'Peça a um administrador para publicar uma.'}
          </p>
          {canEdit && !editing ? (
            <Button className="mt-4" onClick={startEditing}>
              <Plus aria-hidden="true" />
              Escrever metodologia
            </Button>
          ) : null}
        </div>
      )}

      <section aria-labelledby="methodology-history-title" className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="methodology-history-title" className="text-h3 font-bold">
              Histórico de versões
            </h3>
            <p className="mt-1 text-label text-muted-foreground">
              Nada é apagado: cada versão fica guardada para comparar ou restaurar.
            </p>
          </div>
          {versions.length > 1 ? (
            <Button
              variant="outline"
              onClick={() => openCompare(versions[1]?.id ?? null, versions[0]?.id ?? null)}
            >
              <GitCompareArrows aria-hidden="true" />
              Comparar versões
            </Button>
          ) : null}
        </div>

        {versions.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-border p-6 text-center text-label text-muted-foreground">
            Nenhuma versão cadastrada.
          </p>
        ) : (
          <ol className="mt-5 ml-2 border-l border-border">
            {versions.map((version) => {
              const delta = deltas.get(version.id);
              const previous = previousOf(version);
              const isCurrent = version.id === current?.id;
              const busyHere = busyKey?.endsWith(version.id) ?? false;
              return (
                <li key={version.id} className="relative pb-4 pl-6 last:pb-0">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute top-6 -left-[6px] size-[11px] rounded-full ring-4 ring-background',
                      isCurrent ? 'bg-verde-pulso' : 'bg-muted-foreground/60',
                    )}
                  />
                  <article
                    aria-label={`Versão ${version.version}`}
                    className={cn(
                      'rounded-xl border bg-card p-4',
                      isCurrent ? 'border-verde-pulso/60' : 'border-border',
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-h3 font-bold">v{version.version}</span>
                          <StatusBadge tone={STATUS_TONE[version.status]} variant="solid">
                            {isCurrent ? 'Vigente' : STATUS_LABEL[version.status]}
                          </StatusBadge>
                        </div>
                        <p className="mt-1 text-label">
                          {version.changeNote ?? 'Sem resumo da alteração.'}
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>
                            {version.createdBy ?? 'Autor não informado'} ·{' '}
                            {dateLabel(version.createdAt)}
                          </span>
                          <span>{numberFormat.format(countWords(version.content))} palavras</span>
                          {delta && previous ? (
                            delta.added + delta.removed === 0 ? (
                              <span>Texto idêntico à v{previous.version}</span>
                            ) : (
                              <span className="inline-flex items-center gap-2">
                                <DiffStat added={delta.added} removed={delta.removed} />
                                vs v{previous.version}
                              </span>
                            )
                          ) : null}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openCompare(previous?.id ?? null, version.id)}
                        >
                          <GitCompareArrows aria-hidden="true" />
                          Comparar
                        </Button>
                        {canPublish(version) ? (
                          <Button
                            size="sm"
                            disabled={busyKey !== null}
                            onClick={() => void publish(version)}
                          >
                            <Rocket aria-hidden="true" />
                            {busyKey === `publish:${version.id}` ? 'Publicando…' : 'Publicar'}
                          </Button>
                        ) : null}
                        {canApprove && !canEdit && version.status === 'IN_REVIEW' ? (
                          <>
                            <Button
                              size="sm"
                              disabled={busyKey !== null}
                              onClick={() => {
                                setWriteError('');
                                setReviewNote('');
                                setReview({ kind: 'approve', version });
                              }}
                            >
                              <CheckCircle2 aria-hidden="true" />
                              Aprovar
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={busyKey !== null}
                              onClick={() => {
                                setWriteError('');
                                setReviewNote('');
                                setReview({ kind: 'reject', version });
                              }}
                            >
                              <XCircle aria-hidden="true" />
                              Rejeitar
                            </Button>
                          </>
                        ) : null}
                        {canEdit && version.status === 'ARCHIVED' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyKey !== null}
                            onClick={() => void restore(version)}
                          >
                            <RotateCcw aria-hidden="true" />
                            {busyHere && busyKey?.startsWith('restore')
                              ? 'Restaurando…'
                              : canApprove
                                ? 'Restaurar e publicar'
                                : 'Restaurar'}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <ContentReader content={version.content} summary="Ler o texto desta versão" />
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <MethodologyCompareDialog
        open={compare.open}
        onOpenChange={(open) => setCompare((state) => ({ ...state, open }))}
        versions={versions}
        initialBaseId={compare.baseId}
        initialTargetId={compare.targetId}
      />

      <Dialog
        open={review !== null}
        onOpenChange={(open) => {
          if (!open && busyKey !== 'review') {
            setReview(null);
            setReviewNote('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {review?.kind === 'reject' ? 'Rejeitar versão?' : 'Aprovar versão?'}
            </DialogTitle>
            <DialogDescription>
              O parecer fica registrado com seu usuário, data e justificativa.
            </DialogDescription>
          </DialogHeader>
          {writeError ? (
            <p role="alert" className="rounded-lg border border-coral bg-coral/10 p-3 text-label">
              {writeError}
            </p>
          ) : null}
          <label className="text-label font-semibold">
            Justificativa do parecer
            <textarea
              autoFocus
              className={`${INPUT_CLASS} min-h-20`}
              minLength={5}
              maxLength={MAX_METHODOLOGY_NOTE_LENGTH}
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
            />
          </label>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              disabled={busyKey === 'review'}
              onClick={() => setReview(null)}
            >
              Voltar
            </Button>
            <Button
              variant={review?.kind === 'reject' ? 'destructive' : 'default'}
              disabled={busyKey === 'review' || reviewNote.trim().length < 5}
              onClick={() => void submitReview()}
            >
              {busyKey === 'review'
                ? 'Registrando…'
                : review?.kind === 'reject'
                  ? 'Rejeitar versão'
                  : 'Aprovar versão'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
