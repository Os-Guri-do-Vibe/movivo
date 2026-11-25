'use client';

/**
 * Artigos científicos: um explorador de arquivos no estilo do Finder. Os arquivos aparecem como
 * ícones ou como lista; selecionar um abre o painel de detalhes (à direita quando há espaço, logo
 * abaixo no celular); a barra de baixo resume o que está na tela; e dá para soltar arquivos em
 * qualquer ponto do explorador para enviá-los.
 *
 * O layout responde à largura do PRÓPRIO painel (container query), não à da janela: com a barra
 * lateral aberta, um MacBook 14" tem ~1160px de painel, e é isso que decide quantas colunas cabem.
 */
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  LayoutGrid,
  List,
  Loader2,
  MousePointerClick,
  RefreshCw,
  Rocket,
  ScanText,
  Search,
  Trash2,
  Upload,
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

import { CONTROL_H, FOCUS_RING, StatusBadge } from './control-center-table';
import { ResourceState, useControlCenterResource } from './control-center-ui';
import { KNOWLEDGE_CHANGED_EVENT } from './knowledge-base-shell';
import { IN_PROGRESS, PanelHeader, dateLabel, documentStatus, formatBytes } from './knowledge-ui';

/** Formatos aceitos (espelha `ARTICLE_FORMATS` da API; a API é quem decide de verdade). */
const FALLBACK_EXTENSIONS = ['.pdf', '.docx', '.xlsx', '.csv', '.md', '.txt'];
const FALLBACK_MAX_BYTES = 10 * 1024 * 1024;
const POLL_MS = 4_000;

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

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof ControlCenterApiError ? caught.message : fallback;
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

/** Fila de envio: o que foi escolhido ou solto, ainda não salvo. Um arquivo por vez na API. */
function useUploadQueue({
  extensions,
  maxBytes,
  onUploaded,
}: {
  extensions: string[];
  maxBytes: number;
  onUploaded: (response: KnowledgeDocumentsViewResponse, sent: number) => void;
}) {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [saving, setSaving] = useState(false);
  const readable = extensions.map((ext) => ext.slice(1).toUpperCase()).join(', ');

  function add(list: FileList | File[]) {
    const incoming: PendingFile[] = [...list].map((file) => {
      const id = `file-${++pendingSequence}`;
      if (!extensions.includes(`.${extensionOf(file.name)}`)) {
        return { id, file, state: 'error', error: `Formato não aceito. Envie ${readable}.` };
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

  function remove(id: string) {
    setFiles((previous) => previous.filter((entry) => entry.id !== id));
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

  return {
    files,
    saving,
    readable,
    readyCount: files.filter((item) => item.state === 'ready').length,
    add,
    remove,
    clear: () => setFiles([]),
    save,
  };
}

function FileIcon({ format, className }: { format: Format; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('flex shrink-0 items-center justify-center', format.tint, className)}
    >
      <format.icon className="size-1/2" />
    </span>
  );
}

function PendingQueue({
  queue,
  retrievalEnabled,
}: {
  queue: ReturnType<typeof useUploadQueue>;
  retrievalEnabled: boolean;
}) {
  const { files, saving, readyCount } = queue;
  return (
    <section
      aria-label="Arquivos prontos para enviar"
      className="rounded-xl border border-border bg-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-3">
        <h3 className="text-label font-semibold">
          Prontos para enviar{' '}
          <span className="font-mono text-muted-foreground">({files.length})</span>
        </h3>
        <p className="text-xs text-muted-foreground">
          {retrievalEnabled
            ? 'Ao salvar, o artigo entra na base e a IA passa a consultá-lo.'
            : 'Ao salvar, o artigo é indexado. A IA só o consulta quando a busca (RAG) for ligada.'}
        </p>
      </div>
      <ul className="divide-y divide-border">
        {files.map((item) => {
          const format = formatOf(item.file.name);
          return (
            <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
              <FileIcon format={format} className="size-9 rounded-lg" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-label font-medium">{item.file.name}</p>
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
                  onClick={() => queue.remove(item.id)}
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50',
                    FOCUS_RING,
                  )}
                >
                  <X aria-hidden="true" className="size-4" />
                  <span className="sr-only">Remover {item.file.name} da lista</span>
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border p-3">
        <Button type="button" variant="ghost" disabled={saving} onClick={queue.clear}>
          Limpar
        </Button>
        <Button
          type="button"
          disabled={saving || readyCount === 0}
          onClick={() => void queue.save()}
        >
          {saving ? 'Salvando…' : readyCount > 1 ? `Salvar ${readyCount} artigos` : 'Salvar artigo'}
        </Button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- explorador */

type Layout = 'grid' | 'list';
type Sort = 'recent' | 'name' | 'size';
type Group = 'all' | 'active' | 'processing' | 'failed';

const SORTS: ReadonlyArray<{ id: Sort; label: string }> = [
  { id: 'recent', label: 'Mais recentes' },
  { id: 'name', label: 'Nome (A–Z)' },
  { id: 'size', label: 'Maiores' },
];

function groupOf(document: KnowledgeDocumentView): Exclude<Group, 'all'> | 'other' {
  if (document.status === 'PUBLISHED') return 'active';
  if (document.status === 'FAILED') return 'failed';
  if (IN_PROGRESS.includes(document.status)) return 'processing';
  return 'other';
}

function sorter(sort: Sort) {
  if (sort === 'name')
    return (a: KnowledgeDocumentView, b: KnowledgeDocumentView) =>
      a.title.localeCompare(b.title, 'pt-BR');
  if (sort === 'size')
    return (a: KnowledgeDocumentView, b: KnowledgeDocumentView) => b.sizeBytes - a.sizeBytes;
  return (a: KnowledgeDocumentView, b: KnowledgeDocumentView) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

const ITEM_BASE = 'transition-colors';
const ITEM_SELECTED = 'bg-accent/70 ring-1 ring-verde-pulso/60';
const ITEM_IDLE = 'hover:bg-muted/60';

function StatusLabel({ document }: { document: KnowledgeDocumentView }) {
  const status = documentStatus(document);
  return (
    <StatusBadge tone={status.tone}>
      {status.label}
      {status.busy ? (
        <Loader2
          aria-hidden="true"
          className="size-3 text-muted-foreground motion-safe:animate-spin"
        />
      ) : null}
    </StatusBadge>
  );
}

function ArticleTile({
  document,
  selected,
  onSelect,
  onOpen,
}: {
  document: KnowledgeDocumentView;
  selected: boolean;
  onSelect: () => void;
  onOpen?: () => void;
}) {
  const format = formatOf(document.originalFilename);
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        onDoubleClick={onOpen}
        className={cn(
          'flex h-full w-full flex-col items-center gap-2 rounded-lg p-3 text-center',
          ITEM_BASE,
          FOCUS_RING,
          selected ? ITEM_SELECTED : ITEM_IDLE,
        )}
      >
        <span className="relative">
          <FileIcon format={format} className="size-14 rounded-xl" />
          <span
            aria-hidden="true"
            className="absolute -right-2 -bottom-1.5 rounded border border-border bg-card px-1 font-mono text-[10px] leading-4 font-bold"
          >
            {format.label}
          </span>
        </span>
        <span className="line-clamp-2 text-label leading-snug font-medium break-words">
          {document.title}
        </span>
        <span className="text-xs text-muted-foreground">
          <StatusLabel document={document} />
        </span>
      </button>
    </li>
  );
}

const LIST_COLUMNS =
  'grid-cols-[auto_minmax(0,1fr)_auto] @xl:grid-cols-[auto_minmax(0,1fr)_9.5rem_5.5rem_8rem]';

function ArticleRow({
  document,
  selected,
  onSelect,
  onOpen,
}: {
  document: KnowledgeDocumentView;
  selected: boolean;
  onSelect: () => void;
  onOpen?: () => void;
}) {
  const format = formatOf(document.originalFilename);
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        onDoubleClick={onOpen}
        className={cn(
          'grid w-full items-center gap-x-3 rounded-lg px-3 py-2 text-left',
          LIST_COLUMNS,
          ITEM_BASE,
          FOCUS_RING,
          selected ? ITEM_SELECTED : ITEM_IDLE,
        )}
      >
        <FileIcon format={format} className="size-9 rounded-lg" />
        <span className="min-w-0">
          <span className="block truncate text-label font-medium">{document.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {document.originalFilename}
            <span className="@xl:hidden">
              {' '}
              · {formatBytes(document.sizeBytes)} · {dateLabel(document.createdAt)}
            </span>
          </span>
        </span>
        <span className="justify-self-end text-xs @xl:justify-self-start">
          <StatusLabel document={document} />
        </span>
        <span className="hidden text-right text-xs tabular-nums text-muted-foreground @xl:block">
          {formatBytes(document.sizeBytes)}
        </span>
        <span className="hidden text-xs tabular-nums text-muted-foreground @xl:block">
          {dateLabel(document.createdAt)}
        </span>
      </button>
    </li>
  );
}

function ListHeader() {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'hidden gap-x-3 border-b border-border px-3 pb-2 text-xs font-medium text-muted-foreground @xl:grid',
        LIST_COLUMNS,
      )}
    >
      <span className="col-span-2">Nome</span>
      <span>Situação</span>
      <span className="text-right">Tamanho</span>
      <span>Enviado</span>
    </div>
  );
}

function Inspector({
  document,
  canDelete,
  canRetry,
  canApprove,
  busy,
  onClose,
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
  onClose: () => void;
  onDelete: () => void;
  onRetry: () => void;
  onPublish: () => void;
  onRead: () => void;
}) {
  const format = formatOf(document.originalFilename);
  const retryable =
    document.status === 'FAILED' &&
    (document.canRetry ?? true) &&
    RETRYABLE_ERRORS.has(document.errorCode ?? document.processingError ?? 'PROCESSING_FAILED');
  const legacyPending = document.status === 'READY_FOR_REVIEW' || document.status === 'PENDING';
  const extractedReady = document.status === 'PUBLISHED' || legacyPending;
  const rows: Array<[string, React.ReactNode]> = [
    ['Situação', <StatusLabel key="status" document={document} />],
    ['Formato', format.label],
    ['Tamanho', formatBytes(document.sizeBytes)],
    ['Enviado', dateLabel(document.createdAt)],
  ];
  if (document.uploadedBy) rows.push(['Enviado por', document.uploadedBy]);
  rows.push([
    'Trechos indexados',
    <span key="chunks" className="font-mono">
      {document.chunkCount}
    </span>,
  ]);

  return (
    <section aria-label={`Detalhes de ${document.title}`} className="p-4">
      <div className="flex items-start gap-3">
        <FileIcon format={format} className="size-12 rounded-xl" />
        <div className="min-w-0 flex-1">
          <h3 className="text-label leading-snug font-semibold break-words">{document.title}</h3>
          <p className="mt-0.5 text-xs break-all text-muted-foreground">
            {document.originalFilename}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={cn(
            '-mt-1 -mr-1 flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground',
            FOCUS_RING,
          )}
        >
          <X aria-hidden="true" className="size-4" />
          <span className="sr-only">Fechar detalhes</span>
        </button>
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

      <div className="mt-4 flex flex-wrap gap-2">
        {legacyPending && canApprove ? (
          <Button size="sm" disabled={busy} onClick={onPublish}>
            <Rocket aria-hidden="true" />
            Publicar
          </Button>
        ) : null}
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
        {canDelete ? (
          <Button
            size="sm"
            variant="outline"
            className="border-coral/60 hover:border-coral hover:bg-coral/15"
            disabled={busy}
            onClick={onDelete}
          >
            <Trash2 aria-hidden="true" />
            Excluir
          </Button>
        ) : null}
      </div>

      <dl className="mt-4 grid border-t border-border text-label @2xl:grid-cols-2 @2xl:gap-x-10 @4xl:grid-cols-1">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-4 border-b border-border py-2"
          >
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="min-w-0 text-right break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function EmptyExplorer({
  canUpload,
  readable,
  maxBytes,
  onPick,
}: {
  canUpload: boolean;
  readable: string;
  maxBytes: number;
  onPick: () => void;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground"
      >
        <UploadCloud className="size-6" />
      </span>
      <p className="mt-3 font-semibold">Nenhum artigo na base ainda</p>
      <p className="mt-1 max-w-sm text-label text-muted-foreground">
        {canUpload
          ? 'Arraste os estudos até aqui ou escolha no computador.'
          : 'Quando houver artigos, eles aparecem aqui.'}
      </p>
      {canUpload ? (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            {readable} · até {formatBytes(maxBytes)} cada
          </p>
          <Button type="button" variant="outline" className="mt-4" onClick={onPick}>
            Escolher arquivos
          </Button>
        </>
      ) : null}
    </div>
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
  const inputRef = useRef<HTMLInputElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [layout, setLayout] = useState<Layout>('grid');
  const [sort, setSort] = useState<Sort>('recent');
  const [group, setGroup] = useState<Group>('all');
  const [showLegacy, setShowLegacy] = useState(false);
  const [dragging, setDragging] = useState(false);
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

  const policy = data?.data.policy;
  const extensions = policy?.allowedExtensions?.length
    ? policy.allowedExtensions
    : FALLBACK_EXTENSIONS;
  const maxBytes = policy?.maxBytes || FALLBACK_MAX_BYTES;
  const retrievalEnabled = policy?.retrievalEnabled ?? false;

  const queue = useUploadQueue({
    extensions,
    maxBytes,
    onUploaded: (response, sent) => {
      apply(response);
      setWriteError('');
      setFeedback(
        sent === 1
          ? retrievalEnabled
            ? 'Artigo salvo. A IA já pode consultá-lo assim que o processamento terminar.'
            : 'Artigo salvo e indexado assim que o processamento terminar. A IA só o consulta quando a busca (RAG) for ligada.'
          : retrievalEnabled
            ? `${sent} artigos salvos. A IA já pode consultá-los assim que o processamento terminar.`
            : `${sent} artigos salvos e indexados assim que o processamento terminar. A IA só os consulta quando a busca (RAG) for ligada.`,
      );
    },
  });

  const allDocuments = useMemo(() => data?.data.documents ?? [], [data]);
  const legacyCount = allDocuments.filter((document) => LEGACY.includes(document.status)).length;
  const articles = useMemo(
    () => allDocuments.filter((document) => showLegacy || !LEGACY.includes(document.status)),
    [allDocuments, showLegacy],
  );
  const counts = useMemo(() => {
    const result = { active: 0, processing: 0, failed: 0 };
    for (const document of articles) {
      const kind = groupOf(document);
      if (kind !== 'other') result[kind]++;
    }
    return result;
  }, [articles]);
  // Um filtro que esvaziou (ex.: a falha foi reprocessada) volta sozinho para "Todos".
  const activeGroup: Group = group !== 'all' && counts[group] === 0 ? 'all' : group;
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt-BR');
    return articles
      .filter((document) => activeGroup === 'all' || groupOf(document) === activeGroup)
      .filter(
        (document) =>
          !needle ||
          `${document.title} ${document.originalFilename}`
            .toLocaleLowerCase('pt-BR')
            .includes(needle),
      )
      .sort(sorter(sort));
  }, [articles, query, activeGroup, sort]);
  const selected = articles.find((document) => document.id === selectedId) ?? null;
  const processing = articles.some((document) => IN_PROGRESS.includes(document.status));
  const totalBytes = visible.reduce((sum, document) => sum + document.sizeBytes, 0);

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

  // No celular os detalhes aparecem abaixo da lista: leva o olhar até eles ao selecionar.
  useEffect(() => {
    if (!selectedId) return;
    inspectorRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId]);

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

  /** Duplo clique abre o texto extraído, como "abrir" no Finder; só para quem pode revisar. */
  const openerFor = (document: KnowledgeDocumentView) =>
    canApprove &&
    (document.status === 'PUBLISHED' ||
      document.status === 'READY_FOR_REVIEW' ||
      document.status === 'PENDING')
      ? () => void openText(document)
      : undefined;

  const pick = () => inputRef.current?.click();

  function hasFiles(event: DragEvent) {
    return [...event.dataTransfer.types].includes('Files');
  }

  const dropProps = canUpload
    ? {
        onDragOver: (event: DragEvent) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          if (!queue.saving) setDragging(true);
        },
        onDragLeave: (event: DragEvent) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        },
        onDrop: (event: DragEvent) => {
          event.preventDefault();
          setDragging(false);
          if (queue.saving) return;
          if (event.dataTransfer.files.length) queue.add(event.dataTransfer.files);
        },
      }
    : {};

  const groups: ReadonlyArray<{ id: Group; label: string; count: number }> = [
    { id: 'all', label: 'Todos', count: articles.length },
    { id: 'active', label: 'Ativos', count: counts.active },
    { id: 'processing', label: 'Em andamento', count: counts.processing },
    { id: 'failed', label: 'Com falha', count: counts.failed },
  ];
  const showGroups = groups.filter((item) => item.id !== 'all' && item.count > 0).length > 0;
  const hasArticles = articles.length > 0;

  return (
    <section aria-labelledby="articles-title" className="space-y-5">
      <PanelHeader
        id="articles-title"
        title="Artigos científicos"
        description={
          retrievalEnabled
            ? 'Estudos que a IA consulta ao responder dúvidas dos alunos. O texto é extraído e indexado automaticamente, sem aprovação.'
            : 'Estudos indexados para a IA. A busca (RAG) está desligada: os artigos ficam guardados e prontos, e a IA só passa a consultá-los quando ela for ligada.'
        }
        actions={
          canUpload ? (
            <Button type="button" className={CONTROL_H} disabled={queue.saving} onClick={pick}>
              <Upload aria-hidden="true" />
              Enviar arquivos
            </Button>
          ) : null
        }
      />

      {canUpload ? (
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept={extensions.join(',')}
          data-testid="articles-file-input"
          onChange={(event) => {
            if (event.target.files) queue.add(event.target.files);
            event.target.value = '';
          }}
        />
      ) : null}

      {feedback ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-verde-pulso/50 bg-verde-pulso/10 p-4 text-label"
        >
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <p className="flex-1 font-medium">{feedback}</p>
          <button
            type="button"
            onClick={() => setFeedback('')}
            className={cn(
              '-m-1 flex size-8 items-center justify-center rounded-md opacity-70 hover:opacity-100',
              FOCUS_RING,
            )}
          >
            <X aria-hidden="true" className="size-4" />
            <span className="sr-only">Dispensar aviso</span>
          </button>
        </div>
      ) : null}
      {writeError ? (
        <p
          role="alert"
          className="rounded-xl border border-coral bg-coral/10 p-4 text-label font-medium"
        >
          {writeError}
        </p>
      ) : null}

      {queue.files.length ? (
        <PendingQueue queue={queue} retrievalEnabled={retrievalEnabled} />
      ) : null}

      <div
        {...dropProps}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && selectedId) setSelectedId(null);
        }}
        className="relative @container rounded-xl border border-border bg-card"
      >
        {dragging ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-verde-pulso bg-background/85 backdrop-blur-sm"
          >
            <UploadCloud className="size-8 text-verde-pulso" />
            <p className="font-semibold">Solte para enviar</p>
            <p className="text-xs text-muted-foreground">{queue.readable}</p>
          </div>
        ) : null}

        {hasArticles ? (
          <div className="space-y-3 border-b border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative block min-w-52 grow basis-full @xl:basis-0">
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
                  className={cn(
                    'w-full rounded-md border border-input bg-background pr-3 pl-9 text-label',
                    CONTROL_H,
                    FOCUS_RING,
                  )}
                />
              </label>
              <label className="block grow @xl:grow-0">
                <span className="sr-only">Ordenar por</span>
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as Sort)}
                  className={cn(
                    'w-full rounded-md border border-input bg-background px-3 text-label',
                    CONTROL_H,
                    FOCUS_RING,
                  )}
                >
                  {SORTS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <div
                role="group"
                aria-label="Modo de visualização"
                className={cn('flex rounded-md border border-input bg-background p-0.5', CONTROL_H)}
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
                    className="h-full"
                  >
                    <Icon aria-hidden="true" />
                    <span className="sr-only @md:not-sr-only">{label}</span>
                  </Button>
                ))}
              </div>
            </div>
            {showGroups ? (
              <div
                role="group"
                aria-label="Filtrar por situação"
                className="flex flex-wrap gap-1.5"
              >
                {groups
                  .filter((item) => item.id === 'all' || item.count > 0)
                  .map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={activeGroup === item.id}
                      onClick={() => setGroup(item.id)}
                      className={cn(
                        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
                        FOCUS_RING,
                        activeGroup === item.id
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                      )}
                    >
                      {item.label}
                      <span className="font-mono tabular-nums opacity-70">{item.count}</span>
                    </button>
                  ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div
          className={cn('grid', hasArticles ? '@4xl:grid-cols-[minmax(0,1fr)_21rem]' : undefined)}
        >
          <div className="@container min-w-0 p-3 @4xl:max-h-[min(70vh,44rem)] @4xl:min-h-72 @4xl:overflow-y-auto">
            {!hasArticles ? (
              <EmptyExplorer
                canUpload={canUpload}
                readable={queue.readable}
                maxBytes={maxBytes}
                onPick={pick}
              />
            ) : visible.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-8 text-center text-label text-muted-foreground">
                {query.trim()
                  ? `Nenhum artigo encontrado para “${query}”.`
                  : 'Nenhum artigo nesta situação.'}
              </p>
            ) : layout === 'grid' ? (
              <ul
                aria-label="Artigos na base"
                className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-1"
              >
                {visible.map((document) => (
                  <ArticleTile
                    key={document.id}
                    document={document}
                    selected={document.id === selectedId}
                    onSelect={() => setSelectedId(document.id === selectedId ? null : document.id)}
                    onOpen={openerFor(document)}
                  />
                ))}
              </ul>
            ) : (
              <div>
                <ListHeader />
                <ul aria-label="Artigos na base" className="mt-1 grid gap-0.5">
                  {visible.map((document) => (
                    <ArticleRow
                      key={document.id}
                      document={document}
                      selected={document.id === selectedId}
                      onSelect={() =>
                        setSelectedId(document.id === selectedId ? null : document.id)
                      }
                      onOpen={openerFor(document)}
                    />
                  ))}
                </ul>
              </div>
            )}
          </div>

          {hasArticles ? (
            <div
              ref={inspectorRef}
              className={cn(
                'border-t border-border @4xl:max-h-[min(70vh,44rem)] @4xl:overflow-y-auto @4xl:border-t-0 @4xl:border-l',
                !selected && 'hidden @4xl:block',
              )}
            >
              {selected ? (
                <Inspector
                  document={selected}
                  canDelete={canUpload}
                  canRetry={canUpload}
                  canApprove={canApprove}
                  busy={busy}
                  onClose={() => setSelectedId(null)}
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
              ) : (
                <div className="flex h-full min-h-72 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
                  <MousePointerClick aria-hidden="true" className="size-6" />
                  <p className="max-w-52 text-label">
                    Selecione um artigo para ver os detalhes e as ações.
                  </p>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {hasArticles ? (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border px-4 py-2 text-xs text-muted-foreground">
            <p>
              {visible.length === articles.length
                ? `${articles.length} ${articles.length === 1 ? 'artigo' : 'artigos'}`
                : `${visible.length} de ${articles.length} artigos`}{' '}
              · {formatBytes(totalBytes)}
            </p>
            {legacyCount > 0 ? (
              <label className="inline-flex min-h-8 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={showLegacy}
                  onChange={(event) => setShowLegacy(event.target.checked)}
                  className="size-4 accent-[var(--verde-pulso)]"
                />
                Mostrar arquivados e rejeitados ({legacyCount})
              </label>
            ) : null}
          </div>
        ) : null}
      </div>

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
              {retrievalEnabled
                ? 'É este texto, e não o arquivo original, que a IA consulta: '
                : 'É este texto, e não o arquivo original, que fica indexado para a IA: '}
              {reading?.title}.
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
