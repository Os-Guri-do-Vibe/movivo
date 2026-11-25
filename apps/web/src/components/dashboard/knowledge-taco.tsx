'use client';

import { AlertTriangle, CheckCircle2, ChevronRight, FileSpreadsheet } from 'lucide-react';
import { useCallback, useRef, useState, type DragEvent } from 'react';

import { Button } from '@/components/ui/button';
import { getTacoCatalog, importTacoCsv } from '@/lib/control-center-api';
import { cn } from '@/lib/utils';

import { CONTROL_H, FOCUS_RING } from './control-center-table';
import { ResourceState, useControlCenterResource } from './control-center-ui';
import { KNOWLEDGE_CHANGED_EVENT } from './knowledge-base-shell';
import { TacoFoodsTable } from './knowledge-taco-table';
import { PanelHeader, StatStrip, dateLabel } from './knowledge-ui';

const REQUIRED_COLUMNS = [
  'Número do Alimento',
  'Descrição dos alimentos',
  'Energia (kcal)',
  'Proteína (g)',
  'Lipídeos (g)',
  'Carboidrato (g)',
];
const OPTIONAL_COLUMNS = [
  'Categoria',
  'Fibra Alimentar (g)',
  'Cálcio',
  'Ferro',
  'Sódio',
  'Potássio',
  'Magnésio',
  'Zinco',
  'Vitamina C',
  'Colesterol',
  'Fonte',
];

const BOM = String.fromCharCode(0xfeff);

/** CSV exportado do Excel costuma vir em Windows-1252; UTF-8 inválido cai para ele. */
export async function readCsvFile(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  return text.startsWith(BOM) ? text.slice(1) : text;
}

type Outcome = { kind: 'success'; text: string } | { kind: 'error'; text: string };

function ColumnList({ title, columns }: { title: string; columns: readonly string[] }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {columns.map((column) => (
          <li
            key={column}
            className="rounded-md border border-border bg-background px-2 py-0.5 font-mono text-xs"
          >
            {column}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function KnowledgeTacoPanel({ canImport = false }: { canImport?: boolean }) {
  const { data, error, forbidden, loading, refresh, setData } =
    useControlCenterResource(getTacoCatalog);
  const inputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // Sobe a cada importação concluída: a tabela de conferência recarrega em vez de mostrar a lista antiga.
  const [imports, setImports] = useState(0);

  const upload = useCallback(
    async (file: File) => {
      setSaving(true);
      setOutcome(null);
      try {
        const csv = await readCsvFile(file);
        const response = await importTacoCsv({ csv, fileName: file.name });
        setData(response);
        const { imported, skipped } = response.data.lastImport ?? { imported: 0, skipped: 0 };
        setOutcome({
          kind: 'success',
          text:
            `${imported} alimento(s) importado(s) de ${file.name}.` +
            (skipped ? ` ${skipped} linha(s) sem dados mínimos foram ignoradas.` : ''),
        });
        setImports((previous) => previous + 1);
        window.dispatchEvent(new Event(KNOWLEDGE_CHANGED_EVENT));
      } catch (caught) {
        setOutcome({
          kind: 'error',
          text: caught instanceof Error ? caught.message : 'Não foi possível importar a TACO.',
        });
      } finally {
        setSaving(false);
      }
    },
    [setData],
  );

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

  const { tacoCount, otherCount, lastImportedAt, categories } = data.data;
  const largest = Math.max(1, ...categories.map((category) => category.count));

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !saving) void upload(file);
  }

  return (
    <section aria-labelledby="taco-title" className="space-y-5">
      <PanelHeader
        id="taco-title"
        title="TACO"
        description="Tabela Brasileira de Composição de Alimentos (NEPA/UNICAMP). É a base que os agentes de nutrição usam para montar refeições e que calcula os totais do registro alimentar."
      />

      <StatStrip
        stats={[
          { label: 'Alimentos da TACO', value: String(tacoCount) },
          { label: 'Outros alimentos', value: String(otherCount) },
          {
            label: 'Última importação',
            value: lastImportedAt ? dateLabel(lastImportedAt) : '—',
            text: true,
          },
        ]}
      />

      {canImport ? (
        <div className="space-y-3">
          <div
            onDragOver={(event) => {
              if (![...event.dataTransfer.types].includes('Files')) return;
              event.preventDefault();
              if (!saving) setDragging(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                setDragging(false);
            }}
            onDrop={onDrop}
            className={cn(
              'flex flex-col gap-4 rounded-xl border border-dashed p-4 transition-colors @lg:flex-row @lg:items-center @lg:justify-between @lg:p-5',
              dragging ? 'border-verde-pulso bg-verde-pulso/10' : 'border-border bg-card',
            )}
          >
            <div className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground"
              >
                <FileSpreadsheet className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-label font-semibold">Importar planilha da TACO (CSV)</p>
                <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">
                  Arraste o arquivo até aqui ou escolha no computador. Reimportar atualiza os
                  alimentos pelo número, sem duplicar.
                </p>
              </div>
            </div>
            <input
              ref={inputRef}
              type="file"
              hidden
              accept=".csv,text/csv"
              data-testid="taco-file-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void upload(file);
              }}
            />
            <Button
              type="button"
              variant="outline"
              className={cn('shrink-0', CONTROL_H)}
              disabled={saving}
              onClick={() => inputRef.current?.click()}
            >
              {saving ? 'Importando…' : 'Escolher arquivo CSV'}
            </Button>
          </div>

          <details className="group rounded-xl border border-border bg-card">
            <summary
              className={cn(
                'flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 text-label font-medium [&::-webkit-details-marker]:hidden',
                FOCUS_RING,
              )}
            >
              <ChevronRight
                aria-hidden="true"
                className="size-4 text-muted-foreground transition-transform group-open:rotate-90"
              />
              Formato esperado do CSV
            </summary>
            <div className="space-y-4 border-t border-border p-4">
              <ColumnList title="Colunas obrigatórias" columns={REQUIRED_COLUMNS} />
              <ColumnList title="Colunas opcionais" columns={OPTIONAL_COLUMNS} />
              <p className="text-xs text-muted-foreground">
                “Tr” (traço) vale 0. “NA”, “*” e célula vazia ficam como não analisado, e o alimento
                que não tem energia e macronutrientes é ignorado.
              </p>
            </div>
          </details>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-border p-4 text-label text-muted-foreground">
          Seu papel pode consultar a base, mas não importar a TACO.
        </p>
      )}

      {outcome ? (
        <p
          role={outcome.kind === 'error' ? 'alert' : 'status'}
          className="flex items-start gap-2 text-label"
        >
          {outcome.kind === 'error' ? (
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-coral" />
          ) : (
            <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-verde-pulso" />
          )}
          {outcome.text}
        </p>
      ) : null}

      {tacoCount + otherCount > 0 ? (
        <TacoFoodsTable key={imports} />
      ) : (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-label text-muted-foreground">
          Nenhum alimento da TACO importado ainda. Depois da importação, eles aparecem aqui numa
          tabela para conferência.
        </p>
      )}

      {categories.length ? (
        <section
          aria-labelledby="taco-categories-title"
          className="rounded-xl border border-border bg-card"
        >
          <div className="flex items-baseline justify-between gap-4 border-b border-border px-4 py-3">
            <h3 id="taco-categories-title" className="text-label font-semibold">
              Categorias importadas
            </h3>
            <span className="font-mono text-xs text-muted-foreground">{categories.length}</span>
          </div>
          <ul className="grid gap-x-10 gap-y-4 p-4 @3xl:grid-cols-2">
            {categories.map((category) => (
              <li key={category.name}>
                <div className="flex items-baseline justify-between gap-3 text-label">
                  <span className="min-w-0 break-words">{category.name}</span>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {category.count}
                  </span>
                </div>
                <div aria-hidden="true" className="mt-1.5 h-1 rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-verde-pulso"
                    style={{ width: `${(category.count / largest) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
