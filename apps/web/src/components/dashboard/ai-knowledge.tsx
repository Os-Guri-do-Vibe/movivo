'use client';

import type { UploadKnowledgeDocumentInput } from '@movivo/shared';
import {
  Archive,
  CheckCircle2,
  FileSearch,
  Lock,
  RefreshCw,
  Search,
  Upload,
  XCircle,
} from 'lucide-react';
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
  archiveKnowledgeDocument,
  ControlCenterApiError,
  getKnowledgeDocumentContent,
  getKnowledgeDocuments,
  retryKnowledgeDocument,
  reviewKnowledgeDocument,
  uploadKnowledgeDocument,
  type KnowledgeDocumentStatus,
  type KnowledgeDocumentView,
} from '@/lib/control-center-api';

import { ResourceState, SectorHeader, useControlCenterResource } from './control-center-ui';

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-body focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none';

const STATUS_LABEL: Record<KnowledgeDocumentStatus, string> = {
  QUARANTINED: 'Em quarentena',
  QUEUED: 'Na fila',
  PROCESSING: 'Processando',
  READY_FOR_REVIEW: 'Aguardando revisão',
  APPROVED: 'Aprovado',
  INDEXING: 'Indexando',
  PUBLISHED: 'Publicado',
  REJECTED: 'Rejeitado',
  FAILED: 'Falha no processamento',
  ARCHIVED: 'Arquivado',
  PENDING: 'Aguardando revisão',
};

const STATUS_FILTERS: Array<{ value: KnowledgeDocumentStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Todos os status' },
  { value: 'READY_FOR_REVIEW', label: 'Aguardando revisão' },
  { value: 'QUARANTINED', label: 'Em quarentena' },
  { value: 'QUEUED', label: 'Na fila' },
  { value: 'PROCESSING', label: 'Processando' },
  { value: 'APPROVED', label: 'Aprovados' },
  { value: 'INDEXING', label: 'Indexando' },
  { value: 'PUBLISHED', label: 'Publicados' },
  { value: 'FAILED', label: 'Com falha' },
  { value: 'ARCHIVED', label: 'Arquivados' },
  { value: 'REJECTED', label: 'Rejeitados' },
];

type ReviewAction =
  | { kind: 'approve' | 'reject'; document: KnowledgeDocumentView }
  | { kind: 'archive'; document: KnowledgeDocumentView };

type KnowledgeCategory =
  'METHODOLOGY' | 'SCIENTIFIC_EVIDENCE' | 'EXERCISE_LIBRARY' | 'SAFETY' | 'OTHER';
type UploadDraft = Partial<UploadKnowledgeDocumentInput> & { category?: KnowledgeCategory };

function normalizedStatus(status: KnowledgeDocumentStatus): KnowledgeDocumentStatus {
  if (status === 'PENDING') return 'READY_FOR_REVIEW';
  return status;
}

function formatBytes(bytes: number): string {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(bytes / 1024)} KiB`;
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

export function AiKnowledgeDashboard({
  canUpload = false,
  canApprove = false,
  showHeader = true,
}: {
  canUpload?: boolean;
  canApprove?: boolean;
  showHeader?: boolean;
}) {
  const { data, error, forbidden, loading, refresh } =
    useControlCenterResource(getKnowledgeDocuments);
  const [draft, setDraft] = useState<UploadDraft>({ category: 'OTHER' });
  const [fileKey, setFileKey] = useState(0);
  const [fileError, setFileError] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [writeError, setWriteError] = useState('');
  const [preview, setPreview] = useState<{ id: string; content: string } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [review, setReview] = useState<ReviewAction | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<KnowledgeDocumentStatus | 'ALL'>('ALL');

  const documents = useMemo(() => data?.data.documents ?? [], [data]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt-BR');
    return documents.filter((document) => {
      const documentStatus = normalizedStatus(document.status);
      const matchesStatus = status === 'ALL' || documentStatus === status;
      const matchesQuery =
        !needle ||
        `${document.title} ${document.topic} ${document.originalFilename}`
          .toLocaleLowerCase('pt-BR')
          .includes(needle);
      return matchesStatus && matchesQuery;
    });
  }, [documents, query, status]);

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

  const validDraft =
    Boolean(draft.title?.trim()) &&
    Boolean(draft.topic?.trim()) &&
    Boolean(draft.originalFilename) &&
    Boolean(draft.mimeType) &&
    Boolean(draft.content && draft.content.length >= 50) &&
    !fileError;

  async function run(action: () => Promise<unknown>, success: string): Promise<boolean> {
    setSaving(true);
    setWriteError('');
    setFeedback('');
    try {
      await action();
      setFeedback(success);
      await refresh();
      return true;
    } catch (caught) {
      setWriteError(
        caught instanceof ControlCenterApiError
          ? caught.message
          : 'Não foi possível concluir a ação.',
      );
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function submitUpload(event: FormEvent) {
    event.preventDefault();
    if (!validDraft) return;
    const uploaded = await run(
      () => uploadKnowledgeDocument(draft as UploadKnowledgeDocumentInput),
      'Arquivo aceito e encaminhado para processamento seguro.',
    );
    if (uploaded) {
      setDraft({ category: 'OTHER' });
      setFileKey((value) => value + 1);
    }
  }

  async function openPreview(document: KnowledgeDocumentView) {
    setSaving(true);
    setWriteError('');
    try {
      const response = await getKnowledgeDocumentContent(document.id);
      setPreview(response.data);
      setPreviewOpen(true);
    } catch (caught) {
      setWriteError(
        caught instanceof ControlCenterApiError
          ? caught.message
          : 'Não foi possível abrir o conteúdo extraído.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function confirmReview() {
    if (!review || reviewNote.trim().length < 5) return;
    const action = review;
    const note = reviewNote.trim();
    if (action.kind === 'archive') {
      const archived = await run(
        () => archiveKnowledgeDocument(action.document.id, note),
        'Documento arquivado e removido das novas recuperações.',
      );
      if (!archived) return;
    } else {
      const reviewed = await run(
        () =>
          reviewKnowledgeDocument({
            documentId: action.document.id,
            decision: action.kind === 'approve' ? 'APPROVED' : 'REJECTED',
            note,
          }),
        action.kind === 'approve'
          ? 'Aprovação registrada; o documento seguirá para publicação.'
          : 'Documento rejeitado; o histórico foi preservado.',
      );
      if (!reviewed) return;
    }
    setReview(null);
    setReviewNote('');
  }

  function openReview(action: ReviewAction) {
    setWriteError('');
    setReviewNote('');
    setReview(action);
  }

  const allowedExtensions = data.data.policy.allowedTypes.includes('text/markdown')
    ? '.txt e .md'
    : data.data.policy.allowedTypes.join(', ');

  return (
    <div>
      {showHeader ? (
        <SectorHeader
          title="Documentos e evidências"
          description="Fontes entram isoladas, são processadas e só ficam disponíveis para recuperação depois da revisão do profissional CREF."
          meta={data.meta}
          refreshing={loading}
          onRefresh={() => void refresh()}
        />
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-h2 font-bold">Documentos e evidências</h2>
            <p className="mt-2 max-w-3xl text-label text-muted-foreground">
              Acompanhe quarentena, extração, revisão e publicação sem misturar conteúdo não
              confiável às instruções da IA.
            </p>
          </div>
          <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw aria-hidden="true" className={loading ? 'animate-spin' : undefined} />
            {loading ? 'Atualizando…' : 'Atualizar'}
          </Button>
        </div>
      )}

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

      <section
        className="mt-6 rounded-xl border border-border bg-card p-5"
        aria-labelledby="knowledge-policy"
      >
        <h3 id="knowledge-policy" className="font-semibold">
          Política de entrada e retenção
        </h3>
        <p className="mt-2 text-label text-muted-foreground">
          Formatos liberados agora: {allowedExtensions}, até{' '}
          {formatBytes(data.data.policy.maxBytes)}. O original fica{' '}
          {data.data.policy.quarantineDays} dias em quarentena e, se aprovado,{' '}
          {data.data.policy.approvedOriginalDays} dias. Formatos complexos permanecem bloqueados até
          o pipeline isolado de análise estar ativo.
        </p>
      </section>

      {canUpload ? (
        <form
          className="mt-6 rounded-xl border border-border bg-card p-5"
          aria-labelledby="knowledge-upload"
          onSubmit={(event) => void submitUpload(event)}
        >
          <h3 id="knowledge-upload" className="flex items-center gap-2 font-semibold">
            <Upload aria-hidden="true" className="size-5" />
            Enviar documento
          </h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-label font-semibold">
              Título
              <input
                className={INPUT_CLASS}
                required
                minLength={3}
                maxLength={200}
                value={draft.title ?? ''}
                onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))}
              />
            </label>
            <label className="text-label font-semibold">
              Tópico
              <input
                className={INPUT_CLASS}
                required
                minLength={2}
                maxLength={60}
                pattern="[A-Za-zÀ-ú0-9 _-]+"
                value={draft.topic ?? ''}
                onChange={(event) => setDraft((value) => ({ ...value, topic: event.target.value }))}
              />
            </label>
            <label className="text-label font-semibold md:col-span-2">
              Categoria
              <select
                className={INPUT_CLASS}
                value={draft.category ?? 'OTHER'}
                onChange={(event) =>
                  setDraft((value) => ({
                    ...value,
                    category: event.target.value as KnowledgeCategory,
                  }))
                }
              >
                <option value="SCIENTIFIC_EVIDENCE">Evidência científica</option>
                <option value="EXERCISE_LIBRARY">Biblioteca de exercícios</option>
                <option value="SAFETY">Segurança</option>
                <option value="METHODOLOGY">Metodologia de apoio</option>
                <option value="OTHER">Outro</option>
              </select>
            </label>
            <label className="text-label font-semibold md:col-span-2">
              URL da fonte (opcional)
              <input
                className={INPUT_CLASS}
                type="url"
                maxLength={500}
                value={draft.sourceUrl ?? ''}
                onChange={(event) =>
                  setDraft((value) => ({
                    ...value,
                    sourceUrl: event.target.value || undefined,
                  }))
                }
              />
            </label>
            <label className="text-label font-semibold md:col-span-2">
              Arquivo
              <input
                key={fileKey}
                className={INPUT_CLASS}
                type="file"
                accept=".txt,.md,text/plain,text/markdown"
                aria-describedby="knowledge-file-help knowledge-file-error"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  setFileError('');
                  setDraft((value) => ({
                    ...value,
                    content: undefined,
                    originalFilename: undefined,
                    mimeType: undefined,
                  }));
                  if (!file) return;
                  const extension = file.name.toLocaleLowerCase().slice(file.name.lastIndexOf('.'));
                  if (!['.txt', '.md'].includes(extension)) {
                    setFileError('Formato não permitido. Envie um arquivo .txt ou .md.');
                    return;
                  }
                  if (file.size > data.data.policy.maxBytes) {
                    setFileError(`O arquivo excede ${formatBytes(data.data.policy.maxBytes)}.`);
                    return;
                  }
                  void file.text().then((content) => {
                    if (content.length < 50) {
                      setFileError('O documento precisa ter ao menos 50 caracteres úteis.');
                      return;
                    }
                    setDraft((value) => ({
                      ...value,
                      originalFilename: file.name,
                      mimeType: extension === '.md' ? 'text/markdown' : 'text/plain',
                      content,
                    }));
                  });
                }}
              />
              <span
                id="knowledge-file-help"
                className="mt-1 block text-xs font-normal text-muted-foreground"
              >
                O navegador valida tipo e tamanho antes do envio. A aprovação humana continua
                obrigatória.
              </span>
              {fileError ? (
                <span
                  id="knowledge-file-error"
                  role="alert"
                  className="mt-1 block text-xs font-normal text-coral"
                >
                  {fileError}
                </span>
              ) : null}
            </label>
          </div>
          <Button className="mt-4" type="submit" disabled={!validDraft || saving}>
            {saving ? 'Enviando…' : 'Enviar para processamento'}
          </Button>
        </form>
      ) : null}

      <section className="mt-6" aria-labelledby="knowledge-list">
        <h3 id="knowledge-list" className="font-semibold">
          Corpus e processamento
        </h3>
        <div className="mt-4 grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
          <label className="relative text-label font-semibold">
            Buscar
            <span className="relative block">
              <Search
                aria-hidden="true"
                className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                className={`${INPUT_CLASS} pl-9`}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Título, tópico ou arquivo"
              />
            </span>
          </label>
          <label className="text-label font-semibold">
            Status
            <select
              className={INPUT_CLASS}
              value={status}
              onChange={(event) => setStatus(event.target.value as KnowledgeDocumentStatus | 'ALL')}
            >
              {STATUS_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <ul className="mt-4 grid gap-3">
          {filtered.map((document) => {
            const documentStatus = normalizedStatus(document.status);
            return (
              <li key={document.id} className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="font-semibold">{document.title}</h4>
                    <p className="mt-1 text-label text-muted-foreground">
                      {document.topic} · {document.originalFilename} ·{' '}
                      {formatBytes(document.sizeBytes)}
                    </p>
                  </div>
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold">
                    {STATUS_LABEL[document.status]}
                  </span>
                </div>
                <dl className="mt-4 grid gap-3 text-xs text-muted-foreground sm:grid-cols-3">
                  <div>
                    <dt className="font-semibold text-foreground">Enviado por</dt>
                    <dd>{document.uploadedBy ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-foreground">Última mudança</dt>
                    <dd>
                      {dateLabel(
                        document.statusUpdatedAt ?? document.reviewedAt ?? document.createdAt,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-foreground">Proveniência</dt>
                    <dd className="font-mono">
                      {document.chunkCount} trechos · {document.sha256.slice(0, 12)}…
                    </dd>
                  </div>
                </dl>
                {document.processingStage || document.processingError ? (
                  <p className="mt-3 rounded-lg bg-secondary p-3 text-xs">
                    <strong>{document.processingStage ?? 'Processamento'}:</strong>{' '}
                    {document.processingError ?? 'etapa em andamento'}
                  </p>
                ) : null}
                {document.reviewNote ? (
                  <p className="mt-3 text-label text-muted-foreground">
                    <strong>Nota da revisão:</strong> {document.reviewNote}
                  </p>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  {canApprove &&
                  (documentStatus === 'READY_FOR_REVIEW' || document.blobAvailable) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={saving}
                      onClick={() => void openPreview(document)}
                    >
                      <FileSearch aria-hidden="true" />
                      Visualizar conteúdo
                    </Button>
                  ) : null}
                  {canApprove && documentStatus === 'READY_FOR_REVIEW' ? (
                    <>
                      <Button
                        size="sm"
                        disabled={saving}
                        onClick={() => openReview({ kind: 'approve', document })}
                      >
                        <CheckCircle2 aria-hidden="true" />
                        Aprovar
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={saving}
                        onClick={() => openReview({ kind: 'reject', document })}
                      >
                        <XCircle aria-hidden="true" />
                        Rejeitar
                      </Button>
                    </>
                  ) : null}
                  {canUpload && (documentStatus === 'FAILED' || document.canRetry === true) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={saving}
                      onClick={() =>
                        void run(
                          () => retryKnowledgeDocument(document.id),
                          'Reprocessamento colocado na fila.',
                        )
                      }
                    >
                      <RefreshCw aria-hidden="true" />
                      Tentar novamente
                    </Button>
                  ) : null}
                  {canApprove && documentStatus === 'PUBLISHED' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={saving}
                      onClick={() => openReview({ kind: 'archive', document })}
                    >
                      <Archive aria-hidden="true" />
                      Arquivar
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        {filtered.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-border p-6 text-center text-label text-muted-foreground">
            Nenhum documento corresponde aos filtros.
          </p>
        ) : null}
      </section>

      {!canUpload && !canApprove ? (
        <p className="mt-6 flex items-center gap-2 rounded-lg border border-border bg-secondary p-3 text-label">
          <Lock aria-hidden="true" className="size-4" />
          Seu acesso permite consultar o corpus e o histórico.
        </p>
      ) : null}

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Conteúdo isolado para revisão</DialogTitle>
            <DialogDescription>
              Este texto é exibido como dado não confiável. Ele não altera regras superiores nem é
              renderizado como HTML.
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-lg bg-secondary p-4 font-mono text-xs whitespace-pre-wrap">
            {preview?.content}
          </pre>
        </DialogContent>
      </Dialog>

      <Dialog
        open={review !== null}
        onOpenChange={(open) => {
          if (!open && !saving) {
            setReview(null);
            setReviewNote('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {review?.kind === 'approve'
                ? 'Aprovar esta evidência?'
                : review?.kind === 'reject'
                  ? 'Rejeitar esta evidência?'
                  : 'Arquivar esta evidência?'}
            </DialogTitle>
            <DialogDescription>
              {review?.kind === 'approve'
                ? 'Confirme que conteúdo, fonte e escopo foram revisados por profissional CREF. A publicação o torna recuperável pela IA.'
                : review?.kind === 'archive'
                  ? 'O documento deixará de participar de novas recuperações; a trilha histórica será mantida.'
                  : 'O documento não será disponibilizado para a IA; a decisão e sua justificativa serão preservadas.'}
            </DialogDescription>
          </DialogHeader>
          {writeError ? (
            <p role="alert" className="rounded-lg border border-coral bg-card p-3 text-label">
              {writeError}
            </p>
          ) : null}
          <label className="text-label font-semibold">
            Nota obrigatória
            <textarea
              autoFocus
              className={`${INPUT_CLASS} min-h-24`}
              minLength={5}
              maxLength={500}
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
            />
          </label>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" disabled={saving} onClick={() => setReview(null)}>
              Voltar e revisar
            </Button>
            <Button
              variant={review?.kind === 'reject' ? 'destructive' : 'default'}
              disabled={saving || reviewNote.trim().length < 5}
              onClick={() => void confirmReview()}
            >
              {saving ? 'Registrando…' : 'Confirmar decisão'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
