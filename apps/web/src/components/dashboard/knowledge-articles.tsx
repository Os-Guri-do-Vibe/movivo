'use client';

import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  LayoutGrid,
  List,
  Loader2,
  RefreshCw,
  Rocket,
  ScanText,
  Search,
  Trash2,
  UploadCloud,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';

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
  deleteKnowledgeDocument,
  getKnowledgeDocumentContent,
  getKnowledgeDocuments,
  retryKnowledgeDocument,
  reviewKnowledgeDocument,
  uploadKnowledgeArticle,
  type KnowledgeDocumentStatus,
  type KnowledgeDocumentView,
  type KnowledgeDocumentsViewResponse,
} from '@/lib/control-center-api';
import { cn } from '@/lib/utils';

import { StatusBadge, type StatusTone } from './control-center-table';
import { ResourceState, useControlCenterResource } from './control-center-ui';
import { KNOWLEDGE_CHANGED_EVENT } from './knowledge-base-shell';

/** Formatos aceitos (espelha `ARTICLE_FORMATS` da API; a API é quem decide de verdade). */
const FALLBACK_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.csv', '.md', '.txt'];
const FALLBACK_MAX_BYTES = 10 * 1024 * 1024;
const POLL_MS = 4_000;

/** O que ainda está sendo extraído/indexado: a lista se atualiza sozinha enquanto houver. */
const IN_PROGRESS: readonly KnowledgeDocumentStatus[] = [
  'QUARANTINED',
  'QUEUED',
  'PROCESSING',
  'APPROVED',
  'INDEXING',
];
/** Resíduo de fluxos antigos (arquivados/rejeitados): fora da lista, a menos que se peça. */
const LEGACY: readonly KnowledgeDocumentStatus[] = ['ARCHIVED', 'REJECTED'];

/** Falhas que mudam de resultado ao tentar de novo; o resto exige outro arquivo. */
const RETRYABLE_ERRORS = new Set(['QUEUE_UNAVAILABLE', 'PROCESSING_FAILED']);

const ERROR_LABEL: Record<string, string> = {
  NO_TEXT_LAYER: 'O PDF não tem texto selecionável (parece escaneado). Envie uma versão com texto.',
  INVALID_PDF: 'Não foi possível abrir o PDF. Ele pode estar corrompido ou protegido.',
  INVALID_DOCX: 'Não foi possível ler o arquivo Word. Ele pode estar corrompido.',
  INVALID_XLSX: 'Não foi possível ler a planilha. Ela pode estar corrompida.',
  INVALID_ARCHIVE: 'O arquivo está corrompido ou não é um documento válido.',
  ARCHIVE_TOO_LARGE: 'O documento descompactado é grande demais para ser processado.',
  ARCHIVE_TOO_COMPLEX: 'O documento tem partes demais.',
  PDF_TOO_LONG: 'O PDF tem páginas demais para ser indexado.',
  SHEET_TOO_LARGE: 'A planilha tem linhas demais para ser indexada.',
  TEXT_TOO_LONG: 'O artigo é extenso demais para ser indexado.',
  CONTENT_TOO_SHORT: 'O arquivo quase não tem texto para indexar.',
  ACTIVE_OR_BINARY_CONTENT: 'O arquivo contém conteúdo ativo (script) e foi recusado.',
  PROMPT_INJECTION_DETECTED: 'O texto contém instruções dirigidas a agentes de IA e foi recusado.',
  QUEUE_UNAVAILABLE: 'A fila de processamento estava indisponível. Tente novamente.',
};

type Format = { label: string; icon: LucideIcon; tint: string };

const FORMATS: Record<string, Format> = {
  pdf: { label: 'PDF', icon: FileText, tint: 'bg-coral/20' },
  docx: { label: 'DOCX', icon: FileText, tint: 'bg-chart-4/15' },
  xlsx: { label: 'XLSX', icon: FileSpreadsheet, tint: 'bg-verde-pulso/25' },
  csv: { label: 'CSV', icon: FileSpreadsheet, tint: 'bg-verde-pulso/25' },
  md: { label: 'MD', icon: FileText, tint: 'bg-secondary' },
  txt: { label: 'TXT', icon: FileText, tint: 'bg-secondary' },
};
const UNKNOWN_FORMAT: Format = { label: 'ARQ', icon: FileText, tint: 'bg-secondary' };

function extensionOf(filename: string): string {
  const offset = filename.lastIndexOf('.');
  return offset < 0 ? '' : filename.slice(offset + 1).toLowerCase();
}

function formatOf(filename: string): Format {
  return FORMATS[extensionOf(filename)] ?? UNKNOWN_FORMAT;
}

function formatBytes(bytes: number): string {
  const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
  if (bytes < 1024 * 1024) return `${number.format(bytes / 1024)} KB`;
  return `${number.format(bytes / (1024 * 1024))} MB`;
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof ControlCenterApiError ? caught.message : fallback;
}

function statusOf(document: KnowledgeDocumentView): {
  tone: StatusTone;
  label: string;
  busy: boolean;
} {
  if (document.status === 'PUBLISHED') return { tone: 'positive', label: 'Ativo', busy: false };
  if (document.status === 'FAILED') return { tone: 'attention', label: 'Falhou', busy: false };
  if (document.status === 'ARCHIVED') return { tone: 'quiet', label: 'Arquivado', busy: false };
  if (document.status === 'REJECTED') return { tone: 'quiet', label: 'Rejeitado', busy: false };
  if (IN_PROGRESS.includes(document.status))
    return { tone: 'neutral', label: 'Processando', busy: true };
  return { tone: 'neutral', label: 'Aguardando publicação', busy: false };
}

function failureReason(document: KnowledgeDocumentView): string {
  const code = document.errorCode ?? document.processingError ?? '';
  if (ERROR_LABEL[code]) return ERROR_LABEL[code];
  return document.stage === 'INDEXING'
    ? 'Não foi possível indexar o artigo. Tente novamente em instantes.'
    : 'Não foi possível processar o arquivo. Tente novamente ou envie outro.';
}

/* ------------------------------------------------------------------ envio */

interface PendingFile {
  id: string;
  file: File;
  state: 'ready' | 'uploading' | 'error';
  error?: string;
}

let pendingSequence = 0;

function UploadArea({
  extensions,
  maxBytes,
  onUploaded,
}: {
  extensions: string[];
  maxBytes: number;
  onUploaded: (response: KnowledgeDocumentsViewResponse, sent: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);

  const accept = extensions.join(',');
  const readable = extensions.map((ext) => ext.slice(1).toUpperCase()).join(', ');

  function add(list: FileList | File[]) {
    const incoming: PendingFile[] = [...list].map((file) => {
      const id = `file-${++pendingSequence}`;
      if (!extensions.includes(`.${extensionOf(file.name)}`)) {
        return {
          id,
          file,
          state: 'error',
          error: `Formato não aceito. Envie ${readable}.`,
        };
      }
      if (file.size > maxBytes) {
        return {
          id,
          file,
          state: 'error',
          error: `Maior que o limite de ${formatBytes(maxBytes)}.`,
        };
      }
      if (file.size === 0) return { id, file, state: 'error', error: 'O arquivo está vazio.' };
      return { id, file, state: 'ready' };
    });
    setFiles((previous) => [...previous, ...incoming]);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (saving) return;
    if (event.dataTransfer.files.length) add(event.dataTransfer.files);
  }

  async function save() {
    const queue = files.filter((item) => item.state === 'ready');
    if (!queue.length || saving) return;
    setSaving(true);
    let sent = 0;
    let latest: KnowledgeDocumentsViewResponse | null = null;
    for (const item of queue) {
      setFiles((previous) =>
        previous.map((entry) =>
          entry.id === item.id ? { ...entry, state: 'uploading', error: undefined } : entry,
        ),
      );
      try {
        latest = await uploadKnowledgeArticle(item.file);
        sent++;
        setFiles((previous) => previous.filter((entry) => entry.id !== item.id));
      } catch (caught) {
        setFiles((previous) =>
          previous.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  state: 'error',
                  error: errorMessage(caught, 'Não foi possível enviar este artigo.'),
                }
              : entry,
          ),
        );
      }
    }
    setSaving(false);
    if (latest) onUploaded(latest, sent);
  }

  const readyCount = files.filter((item) => item.state === 'ready').length;

  return (
    <section aria-labelledby="articles-upload-title" className="mt-6">
      <h3 id="articles-upload-title" className="sr-only">
        Enviar artigos científicos
      </h3>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!saving) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'rounded-xl border-2 border-dashed bg-card p-6 text-center transition-colors sm:p-8',
          dragging ? 'border-verde-pulso bg-verde-pulso/10' : 'border-border',
        )}
      >
        <span
          aria-hidden="true"
          className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground"
        >
          <UploadCloud className="size-6" />
        </span>
        <p className="mt-3 text-body font-semibold">Arraste os artigos científicos até aqui</p>
        <p className="mt-1 text-label text-muted-foreground">
          {readable} · até {formatBytes(maxBytes)} cada
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept={accept}
          data-testid="articles-file-input"
          onChange={(event) => {
            if (event.target.files) add(event.target.files);
            event.target.value = '';
          }}
        />
        <Button
          type="button"
          variant="outline"
          className="mt-4"
          disabled={saving}
          onClick={() => inputRef.current?.click()}
        >
          Escolher arquivos
        </Button>
      </div>

      {files.length ? (
        <div className="mt-3 rounded-xl border border-border bg-card">
          <ul className="divide-y divide-border">
            {files.map((item) => {
              const format = formatOf(item.file.name);
              return (
                <li key={item.id} className="flex items-center gap-3 p-3">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-lg',
                      format.tint,
                    )}
                  >
                    <format.icon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-label font-semibold">{item.file.name}</p>
                    <p
                      className={cn(
                        'text-xs',
                        item.state === 'error'
                          ? 'font-medium text-foreground'
                          : 'text-muted-foreground',
                      )}
                      role={item.state === 'error' ? 'alert' : undefined}
                    >
                      {item.state === 'error' ? (
                        <span className="inline-flex items-start gap-1">
                          <AlertTriangle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                          {item.error}
                        </span>
                      ) : item.state === 'uploading' ? (
                        'Enviando…'
                      ) : (
                        formatBytes(item.file.size)
                      )}
                    </p>
                  </div>
                  {item.state === 'uploading' ? (
                    <Loader2
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground motion-safe:animate-spin"
                    />
                  ) : (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        setFiles((previous) => previous.filter((e) => e.id !== item.id))
                      }
                      className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none disabled:opacity-50"
                    >
                      <X aria-hidden="true" className="size-4" />
                      <span className="sr-only">Remover {item.file.name} da lista</span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-3">
            <p className="text-xs text-muted-foreground">
              Ao salvar, o artigo entra na base e a IA passa a consultá-lo.
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" disabled={saving} onClick={() => setFiles([])}>
                Limpar
              </Button>
              <Button
                type="button"
                disabled={saving || readyCount === 0}
                onClick={() => void save()}
              >
                {saving
                  ? 'Salvando…'
                  : readyCount > 1
                    ? `Salvar ${readyCount} artigos`
                    : 'Salvar artigo'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------- explorador */

type Layout = 'grid' | 'list';

function ArticleItem({
  document,
  selected,
  layout,
  canDelete,
  onSelect,
  onDelete,
}: {
  document: KnowledgeDocumentView;
  selected: boolean;
  layout: Layout;
  canDelete: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const format = formatOf(document.originalFilename);
  const status = statusOf(document);
  const trash = (position: string) =>
    selected && canDelete ? (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        className={cn(
          'absolute flex size-9 items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-xs hover:bg-coral/20 focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none',
          position,
        )}
      >
        <Trash2 aria-hidden="true" className="size-4" />
        <span className="sr-only">Excluir {document.title}</span>
      </button>
    ) : null;

  if (layout === 'list') {
    return (
      <li className="relative">
        <button
          type="button"
          aria-pressed={selected}
          onClick={onSelect}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg border bg-card p-3 pr-14 text-left focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none',
            selected
              ? 'border-verde-pulso ring-2 ring-verde-pulso/40'
              : 'border-border hover:bg-secondary/50',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-lg',
              format.tint,
            )}
          >
            <format.icon className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-label font-semibold">{document.title}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {document.originalFilename} · {formatBytes(document.sizeBytes)} ·{' '}
              {dateLabel(document.createdAt)}
            </span>
          </span>
          <span className="hidden shrink-0 sm:block">
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </span>
        </button>
        {trash('top-1/2 right-2 -translate-y-1/2')}
      </li>
    );
  }

  return (
    <li className="relative">
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          'flex h-full w-full flex-col items-center rounded-xl border bg-card p-4 pt-5 text-center focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none',
          selected
            ? 'border-verde-pulso ring-2 ring-verde-pulso/40'
            : 'border-border hover:bg-secondary/50',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'relative flex size-16 items-center justify-center rounded-2xl',
            format.tint,
          )}
        >
          <format.icon className="size-8" />
          <span className="absolute -right-1.5 -bottom-1.5 rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] font-bold">
            {format.label}
          </span>
        </span>
        <span className="mt-3 line-clamp-2 text-label font-semibold break-words">
          {document.title}
        </span>
        <span className="mt-1 text-xs text-muted-foreground">
          {formatBytes(document.sizeBytes)}
        </span>
        <span className="mt-2 text-xs">
          <StatusBadge tone={status.tone}>
            {status.label}
            {status.busy ? (
              <Loader2
                aria-hidden="true"
                className="ml-1.5 inline size-3 motion-safe:animate-spin"
              />
            ) : null}
          </StatusBadge>
        </span>
      </button>
      {trash('top-2 right-2')}
    </li>
  );
}

function ArticleDetails({
  document,
  canDelete,
  canRetry,
  canApprove,
  busy,
  onDelete,
  onRetry,
  onPublish,
  onRead,
}: {
  document: KnowledgeDocumentView;
  canDelete: boolean;
  canRetry: boolean;
  canApprove: boolean;
  busy: boolean;
  onDelete: () => void;
  onRetry: () => void;
  onPublish: () => void;
  onRead: () => void;
}) {
  const format = formatOf(document.originalFilename);
  const status = statusOf(document);
  const retryable =
    document.status === 'FAILED' &&
    (document.canRetry ?? true) &&
    RETRYABLE_ERRORS.has(document.errorCode ?? document.processingError ?? 'PROCESSING_FAILED');
  const legacyPending = document.status === 'READY_FOR_REVIEW' || document.status === 'PENDING';
  const extractedReady = document.status === 'PUBLISHED' || legacyPending;

  return (
    <section
      aria-label={`Detalhes de ${document.title}`}
      className="mt-4 rounded-xl border border-border bg-card p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-xl',
              format.tint,
            )}
          >
            <format.icon className="size-6" />
          </span>
          <div className="min-w-0">
            <h4 className="text-body font-bold break-words">{document.title}</h4>
            <p className="mt-0.5 text-xs break-all text-muted-foreground">
              {document.originalFilename}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {extractedReady && canApprove ? (
            <Button size="sm" variant="outline" onClick={onRead}>
              <ScanText aria-hidden="true" />
              Ver texto extraído
            </Button>
          ) : null}
          {retryable && canRetry ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}>
              <RefreshCw aria-hidden="true" />
              Tentar novamente
            </Button>
          ) : null}
          {legacyPending && canApprove ? (
            <Button size="sm" disabled={busy} onClick={onPublish}>
              <Rocket aria-hidden="true" />
              Publicar
            </Button>
          ) : null}
          {canDelete ? (
            <Button size="sm" variant="destructive" disabled={busy} onClick={onDelete}>
              <Trash2 aria-hidden="true" />
              Excluir
            </Button>
          ) : null}
        </div>
      </div>

      {document.status === 'FAILED' ? (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-lg border border-coral bg-coral/10 p-3 text-label"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {failureReason(document)}
        </p>
      ) : null}

      <dl className="mt-4 grid gap-x-8 gap-y-3 text-label sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Situação</dt>
          <dd>
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Tamanho</dt>
          <dd>{formatBytes(document.sizeBytes)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Enviado</dt>
          <dd>
            {dateLabel(document.createdAt)}
            {document.uploadedBy ? ` · ${document.uploadedBy}` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Trechos consultáveis pela IA</dt>
          <dd className="font-mono">{document.chunkCount}</dd>
        </div>
      </dl>
    </section>
  );
}

/* ----------------------------------------------------------------- painel */

export function KnowledgeArticlesPanel({
  canUpload = false,
  canApprove = false,
}: {
  canUpload?: boolean;
  canApprove?: boolean;
}) {
  const { data, error, forbidden, loading, refresh, setData } =
    useControlCenterResource(getKnowledgeDocuments);
  const [query, setQuery] = useState('');
  const [layout, setLayout] = useState<Layout>('grid');
  const [showLegacy, setShowLegacy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<KnowledgeDocumentView | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [writeError, setWriteError] = useState('');
  const [reading, setReading] = useState<{ title: string; content: string | null } | null>(null);

  const apply = useCallback(
    (response: KnowledgeDocumentsViewResponse) => {
      setData(response);
      window.dispatchEvent(new Event(KNOWLEDGE_CHANGED_EVENT));
    },
    [setData],
  );

  const allDocuments = useMemo(() => data?.data.documents ?? [], [data]);
  const legacyCount = allDocuments.filter((document) => LEGACY.includes(document.status)).length;
  const articles = useMemo(
    () =>
      allDocuments
        .filter((document) => showLegacy || !LEGACY.includes(document.status))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [allDocuments, showLegacy],
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt-BR');
    if (!needle) return articles;
    return articles.filter((document) =>
      `${document.title} ${document.originalFilename}`.toLocaleLowerCase('pt-BR').includes(needle),
    );
  }, [articles, query]);
  const selected = articles.find((document) => document.id === selectedId) ?? null;
  const processing = articles.some((document) => IN_PROGRESS.includes(document.status));

  // Enquanto algo estiver sendo extraído/indexado, a lista acompanha sem o usuário recarregar.
  useEffect(() => {
    if (!processing) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void getKnowledgeDocuments()
        .then((response) => {
          if (!cancelled) apply(response);
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [processing, apply]);

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

  const policy = data.data.policy;
  const extensions = policy.allowedExtensions?.length
    ? policy.allowedExtensions
    : FALLBACK_EXTENSIONS;
  const maxBytes = policy.maxBytes || FALLBACK_MAX_BYTES;

  async function run(work: () => Promise<string>, fallback: string) {
    setBusy(true);
    setWriteError('');
    try {
      setFeedback(await work());
    } catch (caught) {
      setWriteError(errorMessage(caught, fallback));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemoval() {
    const target = confirmDelete;
    if (!target) return;
    await run(async () => {
      apply(await deleteKnowledgeDocument(target.id));
      setConfirmDelete(null);
      setSelectedId(null);
      return `“${target.title}” foi excluído definitivamente do banco.`;
    }, 'Não foi possível excluir este artigo.');
    setConfirmDelete(null);
  }

  async function openText(document: KnowledgeDocumentView) {
    setReading({ title: document.title, content: null });
    try {
      const response = await getKnowledgeDocumentContent(document.id);
      setReading({ title: document.title, content: response.data.content });
    } catch (caught) {
      setReading(null);
      setWriteError(errorMessage(caught, 'Não foi possível abrir o texto extraído.'));
    }
  }

  return (
    <section aria-labelledby="articles-title">
      <div>
        <h2 id="articles-title" className="text-h2 font-bold">
          Artigos científicos
        </h2>
        <p className="mt-2 max-w-3xl text-label text-muted-foreground">
          Envie estudos e artigos para a IA consultar. O texto é extraído e indexado
          automaticamente, sem aprovação.
        </p>
      </div>

      {feedback ? (
        <div
          role="status"
          className="mt-5 flex items-start gap-3 rounded-xl border border-verde-pulso/50 bg-verde-pulso/10 p-4 text-label"
        >
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <p className="flex-1 font-medium">{feedback}</p>
          <button
            type="button"
            onClick={() => setFeedback('')}
            className="-m-1 flex size-8 items-center justify-center rounded-md opacity-70 hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none"
          >
            <X aria-hidden="true" className="size-4" />
            <span className="sr-only">Dispensar aviso</span>
          </button>
        </div>
      ) : null}
      {writeError ? (
        <p
          role="alert"
          className="mt-5 rounded-xl border border-coral bg-coral/10 p-4 text-label font-medium"
        >
          {writeError}
        </p>
      ) : null}

      {canUpload ? (
        <UploadArea
          extensions={extensions}
          maxBytes={maxBytes}
          onUploaded={(response, sent) => {
            apply(response);
            setWriteError('');
            setFeedback(
              sent === 1
                ? 'Artigo salvo. A IA já pode consultá-lo assim que o processamento terminar.'
                : `${sent} artigos salvos. A IA já pode consultá-los assim que o processamento terminar.`,
            );
          }}
        />
      ) : null}

      <section aria-labelledby="articles-explorer-title" className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="articles-explorer-title" className="text-h3 font-bold">
              Artigos na base{' '}
              <span className="font-mono text-label font-normal text-muted-foreground">
                ({articles.length})
              </span>
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative block">
              <span className="sr-only">Buscar artigo</span>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar artigo"
                className="h-11 w-56 rounded-lg border border-input bg-background pr-3 pl-9 text-label focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none"
              />
            </label>
            <div
              role="group"
              aria-label="Modo de visualização"
              className="flex rounded-lg border border-border p-0.5"
            >
              {(
                [
                  ['grid', 'Ícones', LayoutGrid],
                  ['list', 'Lista', List],
                ] as const
              ).map(([value, label, Icon]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={layout === value ? 'secondary' : 'ghost'}
                  aria-pressed={layout === value}
                  onClick={() => setLayout(value)}
                >
                  <Icon aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">{label}</span>
                </Button>
              ))}
            </div>
          </div>
        </div>

        {legacyCount > 0 ? (
          <label className="mt-3 inline-flex min-h-9 cursor-pointer items-center gap-2 text-label">
            <input
              type="checkbox"
              checked={showLegacy}
              onChange={(event) => setShowLegacy(event.target.checked)}
              className="size-4 accent-[var(--verde-pulso)]"
            />
            Mostrar arquivados e rejeitados ({legacyCount})
          </label>
        ) : null}

        {articles.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border p-10 text-center">
            <FileText aria-hidden="true" className="mx-auto size-10 text-muted-foreground" />
            <p className="mt-3 font-semibold">Nenhum artigo na base ainda</p>
            <p className="mt-1 text-label text-muted-foreground">
              {canUpload
                ? 'Arraste os primeiros artigos para a área acima.'
                : 'Quando houver artigos, eles aparecem aqui.'}
            </p>
          </div>
        ) : visible.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-border p-8 text-center text-label text-muted-foreground">
            Nenhum artigo encontrado para “{query}”.
          </p>
        ) : (
          <ul
            aria-label="Artigos na base"
            className={cn(
              'mt-4',
              layout === 'grid'
                ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
                : 'grid gap-2',
            )}
          >
            {visible.map((document) => (
              <ArticleItem
                key={document.id}
                document={document}
                layout={layout}
                selected={document.id === selectedId}
                canDelete={canUpload}
                onSelect={() => setSelectedId(document.id === selectedId ? null : document.id)}
                onDelete={() => setConfirmDelete(document)}
              />
            ))}
          </ul>
        )}

        {selected ? (
          <ArticleDetails
            document={selected}
            canDelete={canUpload}
            canRetry={canUpload}
            canApprove={canApprove}
            busy={busy}
            onDelete={() => setConfirmDelete(selected)}
            onRetry={() =>
              void run(async () => {
                apply(await retryKnowledgeDocument(selected.id));
                return 'Processamento reiniciado.';
              }, 'Não foi possível reiniciar o processamento.')
            }
            onPublish={() =>
              void run(async () => {
                apply(
                  await reviewKnowledgeDocument({
                    documentId: selected.id,
                    decision: 'APPROVED',
                    note: 'Publicado pelo administrador.',
                  }),
                );
                return `“${selected.title}” foi publicado.`;
              }, 'Não foi possível publicar este artigo.')
            }
            onRead={() => void openText(selected)}
          />
        ) : null}
      </section>

      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmDelete(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir este artigo?</DialogTitle>
            <DialogDescription>
              “{confirmDelete?.title}”, o arquivo enviado e o texto indexado serão apagados do
              banco. A IA deixa de consultá-lo e não há como desfazer; para tê-lo de volta, envie o
              arquivo de novo.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" disabled={busy} onClick={() => setConfirmDelete(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void confirmRemoval()}>
              <Trash2 aria-hidden="true" />
              {busy ? 'Excluindo…' : 'Excluir definitivamente'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={reading !== null} onOpenChange={(open) => !open && setReading(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Texto extraído</DialogTitle>
            <DialogDescription>
              É este texto, e não o arquivo original, que a IA consulta: {reading?.title}.
            </DialogDescription>
          </DialogHeader>
          {reading?.content === null ? (
            <p role="status" className="text-label text-muted-foreground">
              Carregando…
            </p>
          ) : (
            <pre className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-background p-4 text-[13px] leading-6 whitespace-pre-wrap">
              {reading?.content}
            </pre>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
