'use client';

import { ArrowLeftRight, ChevronsUpDown, Columns2, Rows3 } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { MethodologyVersionView } from '@/lib/control-center-api';
import {
  collapseUnchanged,
  diffLines,
  type DiffItem,
  type DiffLine,
  type DiffSegment,
  type TextDiff,
} from '@/lib/text-diff';
import { cn } from '@/lib/utils';

export type DiffMode = 'unified' | 'split';

/** Verde = entrou, coral = saiu. O sinal (+/−) e o texto para leitor de tela reforçam a cor. */
const ROW_BORDER = {
  add: 'border-l-verde-pulso',
  remove: 'border-l-coral',
  equal: 'border-l-transparent',
} as const;
const ROW_BG = {
  add: 'bg-verde-pulso/12',
  remove: 'bg-coral/12',
  equal: '',
} as const;

const MARK_TONE = {
  add: 'rounded-sm bg-verde-pulso/40 font-semibold',
  remove: 'rounded-sm bg-coral/40 font-semibold line-through decoration-coral/70',
} as const;

function LineText({ line }: { line: DiffLine }) {
  if (line.text === '') return <span aria-hidden="true">&nbsp;</span>;
  const segments: DiffSegment[] | undefined = line.segments;
  if (!segments || line.op === 'equal') return <>{line.text}</>;
  return (
    <>
      {segments.map((segment, index) =>
        segment.changed ? (
          <mark
            key={index}
            className={cn('text-foreground', MARK_TONE[line.op as 'add' | 'remove'])}
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

function OpLabel({ op }: { op: DiffLine['op'] }) {
  if (op === 'equal') return null;
  return <span className="sr-only">{op === 'add' ? 'Adicionada: ' : 'Removida: '}</span>;
}

const GUTTER =
  'select-none px-2 py-0.5 text-right align-top font-mono text-[11px] leading-[22.75px] text-muted-foreground';
const TEXT_CELL =
  'px-3 py-0.5 align-top text-label leading-relaxed break-words whitespace-pre-wrap';

function GapRow({
  item,
  colSpan,
  onExpand,
}: {
  item: Extract<DiffItem, { kind: 'gap' }>;
  colSpan: number;
  onExpand: () => void;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="border-y border-border bg-secondary/60 p-0">
        <button
          type="button"
          onClick={onExpand}
          className="flex min-h-9 w-full items-center justify-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none focus-visible:ring-inset"
        >
          <ChevronsUpDown aria-hidden="true" className="size-3.5" />
          Mostrar {item.hidden.length} linhas sem alteração
        </button>
      </td>
    </tr>
  );
}

/** Agrupa mudanças consecutivas em pares (removida ↔ adicionada) para a visão lado a lado. */
interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

function toSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line) break;
    if (line.op === 'equal') {
      rows.push({ left: line, right: line });
      index++;
      continue;
    }
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    for (let next = lines[index]; next?.op === 'remove'; next = lines[index]) {
      removed.push(next);
      index++;
    }
    for (let next = lines[index]; next?.op === 'add'; next = lines[index]) {
      added.push(next);
      index++;
    }
    const height = Math.max(removed.length, added.length);
    for (let k = 0; k < height; k++)
      rows.push({ left: removed[k] ?? null, right: added[k] ?? null });
  }
  return rows;
}

type SplitItem = { kind: 'rows'; rows: SplitRow[] } | Extract<DiffItem, { kind: 'gap' }>;

function toSplitItems(items: DiffItem[]): SplitItem[] {
  const result: SplitItem[] = [];
  let buffer: DiffLine[] = [];
  const flush = () => {
    if (buffer.length) result.push({ kind: 'rows', rows: toSplitRows(buffer) });
    buffer = [];
  };
  for (const item of items) {
    if (item.kind === 'line') buffer.push(item.line);
    else {
      flush();
      result.push(item);
    }
  }
  flush();
  return result;
}

function UnifiedTable({
  items,
  expanded,
  expand,
}: {
  items: DiffItem[];
  expanded: Set<string>;
  expand: (id: string) => void;
}) {
  return (
    <table className="w-full table-fixed border-collapse">
      <caption className="sr-only">Comparação linha a linha entre as duas versões</caption>
      <colgroup>
        <col className="w-11" />
        <col className="w-11" />
        <col className="w-6" />
        <col />
      </colgroup>
      <tbody>
        {items.flatMap((item) => {
          if (item.kind === 'gap') {
            if (!expanded.has(item.id))
              return [
                <GapRow key={item.id} item={item} colSpan={4} onExpand={() => expand(item.id)} />,
              ];
            return item.hidden.map((line, index) => (
              <UnifiedRow key={`${item.id}-${index}`} line={line} />
            ));
          }
          return [
            <UnifiedRow key={`${item.line.oldNumber}-${item.line.newNumber}`} line={item.line} />,
          ];
        })}
      </tbody>
    </table>
  );
}

function UnifiedRow({ line }: { line: DiffLine }) {
  return (
    <tr className={cn('border-l-4', ROW_BORDER[line.op], ROW_BG[line.op])}>
      <td className={GUTTER}>{line.oldNumber ?? ''}</td>
      <td className={GUTTER}>{line.newNumber ?? ''}</td>
      <td
        aria-hidden="true"
        className="select-none text-center align-top font-mono text-label font-bold"
      >
        {line.op === 'add' ? '+' : line.op === 'remove' ? '−' : ''}
      </td>
      <td className={TEXT_CELL}>
        <OpLabel op={line.op} />
        <LineText line={line} />
      </td>
    </tr>
  );
}

function SplitCell({ line, side }: { line: DiffLine | null; side: 'left' | 'right' }) {
  const op = line?.op === 'equal' ? 'equal' : side === 'left' ? 'remove' : 'add';
  return (
    <>
      <td
        className={cn(
          GUTTER,
          'border-l-4',
          line ? [ROW_BORDER[op], ROW_BG[op]] : 'border-l-transparent bg-secondary/40',
        )}
      >
        {side === 'left' ? (line?.oldNumber ?? '') : (line?.newNumber ?? '')}
      </td>
      <td
        className={cn(
          TEXT_CELL,
          line ? ROW_BG[op] : 'bg-secondary/40',
          side === 'left' && 'border-r border-border',
        )}
      >
        {line ? (
          <>
            <OpLabel op={line.op} />
            <LineText line={line} />
          </>
        ) : null}
      </td>
    </>
  );
}

function SplitTable({
  items,
  expanded,
  expand,
}: {
  items: SplitItem[];
  expanded: Set<string>;
  expand: (id: string) => void;
}) {
  return (
    <table className="w-full table-fixed border-collapse">
      <caption className="sr-only">Comparação lado a lado entre as duas versões</caption>
      <colgroup>
        <col className="w-12" />
        <col />
        <col className="w-12" />
        <col />
      </colgroup>
      <tbody>
        {items.flatMap((item, itemIndex) => {
          if (item.kind === 'gap') {
            if (!expanded.has(item.id))
              return [
                <GapRow key={item.id} item={item} colSpan={4} onExpand={() => expand(item.id)} />,
              ];
            return toSplitRows(item.hidden).map((row, index) => (
              <tr key={`${item.id}-${index}`}>
                <SplitCell line={row.left} side="left" />
                <SplitCell line={row.right} side="right" />
              </tr>
            ));
          }
          return item.rows.map((row, index) => (
            <tr key={`${itemIndex}-${index}`}>
              <SplitCell line={row.left} side="left" />
              <SplitCell line={row.right} side="right" />
            </tr>
          ));
        })}
      </tbody>
    </table>
  );
}

/** Resumo "+N / −M" reutilizado no editor, no banner de rascunho e no histórico. */
export function DiffStat({
  added,
  removed,
  className,
}: {
  added: number;
  removed: number;
  className?: string;
}) {
  return (
    <span
      className={cn('inline-flex items-center gap-2 font-mono text-xs font-semibold', className)}
    >
      <span className="inline-flex items-center gap-1 rounded-md bg-verde-pulso/20 px-1.5 py-0.5">
        <span aria-hidden="true">+{added}</span>
        <span className="sr-only">{added} linhas adicionadas</span>
      </span>
      <span className="inline-flex items-center gap-1 rounded-md bg-coral/20 px-1.5 py-0.5">
        <span aria-hidden="true">−{removed}</span>
        <span className="sr-only">{removed} linhas removidas</span>
      </span>
    </span>
  );
}

function useIsWide(): boolean {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(min-width: 1024px)');
    const update = () => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}

export function MethodologyDiffView({
  before,
  after,
  mode,
  diff: precomputed,
  maxHeightClass = 'max-h-[50vh]',
}: {
  before: string;
  after: string;
  mode: DiffMode;
  diff?: TextDiff;
  maxHeightClass?: string;
}) {
  const wide = useIsWide();
  const deferredBefore = useDeferredValue(before);
  const deferredAfter = useDeferredValue(after);
  const diff = useMemo(
    () => precomputed ?? diffLines(deferredBefore, deferredAfter),
    [precomputed, deferredBefore, deferredAfter],
  );
  const items = useMemo(() => collapseUnchanged(diff.lines), [diff]);
  const splitItems = useMemo(() => toSplitItems(items), [items]);
  // Trocar de par de versões recomeça com os trechos iguais recolhidos.
  const [opened, setOpened] = useState<{ diff: TextDiff; ids: Set<string> } | null>(null);
  const expanded = opened?.diff === diff ? opened.ids : NO_GAPS;
  const expand = (id: string) => setOpened({ diff, ids: new Set(expanded).add(id) });

  if (diff.added === 0 && diff.removed === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center">
        <p className="font-semibold">Estas duas versões são idênticas</p>
        <p className="mt-1 text-label text-muted-foreground">
          Nenhuma linha foi adicionada ou removida.
        </p>
      </div>
    );
  }

  const split = mode === 'split' && wide;
  return (
    <div>
      {diff.approximate ? (
        <p className="mb-2 rounded-md border border-border bg-secondary p-2 text-xs text-muted-foreground">
          O texto mudou demais para um comparativo linha a linha preciso; trechos reescritos
          aparecem como removidos e adicionados por inteiro.
        </p>
      ) : null}
      <div className={cn('overflow-auto rounded-lg border border-border bg-card', maxHeightClass)}>
        {split ? (
          <SplitTable items={splitItems} expanded={expanded} expand={expand} />
        ) : (
          <UnifiedTable items={items} expanded={expanded} expand={expand} />
        )}
      </div>
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: DiffMode; onChange: (mode: DiffMode) => void }) {
  const options: Array<{ value: DiffMode; label: string; icon: ReactNode }> = [
    { value: 'unified', label: 'Unificado', icon: <Rows3 aria-hidden="true" /> },
    { value: 'split', label: 'Lado a lado', icon: <Columns2 aria-hidden="true" /> },
  ];
  return (
    <div
      role="group"
      aria-label="Modo de visualização"
      className="hidden rounded-lg border border-border p-0.5 lg:flex"
    >
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={mode === option.value ? 'secondary' : 'ghost'}
          aria-pressed={mode === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {option.label}
        </Button>
      ))}
    </div>
  );
}

const NO_GAPS: Set<string> = new Set();
const EMPTY = 'empty';
const SELECT_CLASS =
  'mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 text-label focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none';

const STATUS_SHORT: Record<MethodologyVersionView['status'], string> = {
  DRAFT: 'Rascunho',
  IN_REVIEW: 'Em revisão',
  APPROVED: 'Aprovada',
  PUBLISHED: 'Publicada',
  REJECTED: 'Rejeitada',
  ARCHIVED: 'Arquivada',
};

function optionLabel(version: MethodologyVersionView): string {
  return `v${version.version} · ${version.current ? 'Vigente' : STATUS_SHORT[version.status]}`;
}

function CompareBody({
  versions,
  initialBaseId,
  initialTargetId,
}: {
  versions: MethodologyVersionView[];
  initialBaseId: string | null;
  initialTargetId: string | null;
}) {
  const [baseId, setBaseId] = useState(initialBaseId ?? EMPTY);
  const [targetId, setTargetId] = useState(initialTargetId ?? EMPTY);
  const [mode, setMode] = useState<DiffMode>('unified');

  const textOf = (id: string) => versions.find((version) => version.id === id)?.content ?? '';
  const before = textOf(baseId);
  const after = textOf(targetId);
  const diff = useMemo(() => diffLines(before, after), [before, after]);

  const select = (label: string, value: string, onChange: (id: string) => void) => (
    <label className="block min-w-0 flex-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      {label}
      <select
        className={cn(SELECT_CLASS, 'font-normal tracking-normal text-foreground normal-case')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value={EMPTY}>Nenhuma (texto vazio)</option>
        {versions.map((version) => (
          <option key={version.id} value={version.id}>
            {optionLabel(version)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="grid gap-4 p-5 sm:p-6">
      <DialogHeader>
        <DialogTitle>Comparar versões</DialogTitle>
        <DialogDescription>
          <span className="font-semibold text-foreground">Verde</span> é o que entrou na versão
          nova; <span className="font-semibold text-foreground">vermelho</span>, o que saiu da
          versão base.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        {select('Versão base', baseId, setBaseId)}
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="self-center sm:self-end"
          onClick={() => {
            setBaseId(targetId);
            setTargetId(baseId);
          }}
        >
          <ArrowLeftRight aria-hidden="true" />
          <span className="sr-only">Inverter a comparação</span>
        </Button>
        {select('Versão nova', targetId, setTargetId)}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3" role="status">
          <DiffStat added={diff.added} removed={diff.removed} />
          <span className="text-xs text-muted-foreground">linhas em relação à base</span>
        </div>
        <ModeToggle mode={mode} onChange={setMode} />
      </div>

      <MethodologyDiffView before={before} after={after} mode={mode} diff={diff} />
    </div>
  );
}

/** Comparação entre quaisquer duas versões, em diálogo: o que entrou (verde) e o que saiu (vermelho). */
export function MethodologyCompareDialog({
  open,
  onOpenChange,
  versions,
  initialBaseId,
  initialTargetId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Mais recente primeiro. */
  versions: MethodologyVersionView[];
  initialBaseId: string | null;
  initialTargetId: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* O corpo só monta com o diálogo aberto: cada abertura recomeça no par pedido. */}
      <DialogContent className="max-w-6xl p-0 sm:w-[calc(100vw-3rem)]">
        <CompareBody
          versions={versions}
          initialBaseId={initialBaseId}
          initialTargetId={initialTargetId}
        />
      </DialogContent>
    </Dialog>
  );
}
