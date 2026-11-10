'use client';

import type { ColumnSpec, FieldSpec } from '@movivo/shared';
import { AlertTriangle, BookOpen, Info } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';

import { ComboboxField, MultiComboboxField, NumberField, TextAreaField } from './fields';

/**
 * Colunas da tabela a partir de `md` (rótulo da linha + N colunas de valor). Classes completas
 * e fixas: o CSP do painel bloqueia `style` inline e o Tailwind só gera classes escritas por extenso.
 */
const TABLE_GRID: Readonly<Record<number, string>> = {
  1: '@2xl:grid-cols-[minmax(9rem,12rem)_minmax(0,1fr)]',
  2: '@2xl:grid-cols-[minmax(9rem,12rem)_repeat(2,minmax(0,1fr))]',
  3: '@2xl:grid-cols-[minmax(9rem,12rem)_repeat(3,minmax(0,1fr))]',
  4: '@2xl:grid-cols-[minmax(9rem,12rem)_repeat(4,minmax(0,1fr))]',
};

/** Texto curto da faixa usual (o que a literatura e a prática sustentam). */
function plausibleText(
  field: FieldSpec | ColumnSpec,
  override?: readonly [number, number],
): string | null {
  if (field.kind !== 'number' && field.kind !== 'range') return null;
  const plausible = override ?? field.plausible;
  if (!plausible) return null;
  const unit = field.unit ? ` ${field.unit}` : '';
  return `faixa usual ${plausible[0]}–${plausible[1]}${unit}`;
}

function toNumber(raw: string): number | null {
  if (raw.trim() === '') return null;
  const parsed = Number(raw.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Campo numérico que deixa apagar e redigitar: enquanto o profissional digita, o texto fica
 * num rascunho local; só um número válido sobe para o formulário, e ao sair do campo o valor
 * confirmado volta a ser exibido.
 */
function NumericInput({
  value,
  onCommit,
  className,
  invalid,
  ...rest
}: {
  value: number;
  onCommit: (value: number) => void;
  className?: string;
  invalid?: boolean;
  min: number;
  max: number;
  step: number;
  'aria-label': string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <NumberField
      {...rest}
      value={draft ?? (Number.isFinite(value) ? value : '')}
      onChange={(raw) => {
        setDraft(raw);
        const parsed = toNumber(raw);
        if (parsed !== null) onCommit(parsed);
      }}
      onBlur={() => setDraft(null)}
      aria-invalid={invalid || undefined}
      className={cn('w-28', invalid && 'border-coral', className)}
    />
  );
}

/** Lista de itens, um por linha: o texto digitado fica local para a tecla Enter funcionar. */
function LineListInput({
  value,
  onChange,
  maxItems,
  ariaLabel,
}: {
  value: readonly string[];
  onChange: (value: string[]) => void;
  maxItems: number;
  ariaLabel: string;
}) {
  const [raw, setRaw] = useState(value.join('\n'));
  return (
    <TextAreaField
      value={raw}
      aria-label={ariaLabel}
      placeholder="Um item por linha"
      className="min-h-28"
      onChange={(text) => {
        setRaw(text);
        onChange(
          text
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, maxItems),
        );
      }}
    />
  );
}

function Switch({
  checked,
  onChange,
  disabled,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
  ariaLabel: string;
}) {
  return (
    <span className="inline-flex items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-input outline-none motion-safe:transition-colors',
          'focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50',
          checked ? 'border-verde-pulso bg-verde-pulso' : 'bg-secondary',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'inline-block size-5 rounded-full bg-background shadow-xs motion-safe:transition-transform',
            checked ? 'translate-x-6' : 'translate-x-1',
          )}
        />
      </button>
      <span className="text-label font-medium">{checked ? 'Sim' : 'Não'}</span>
    </span>
  );
}

/** Entrada de um campo simples (também usada nas células de tabela). */
function SimpleInput({
  id,
  field,
  value,
  onChange,
  disabled,
  ariaLabel,
  invalid = false,
  inTable = false,
}: {
  id: string;
  field: ColumnSpec | Exclude<FieldSpec, { kind: 'table' }>;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
  ariaLabel: string;
  invalid?: boolean;
  /** Dentro da tabela a escolha ocupa só a coluna, para não cobrir o campo ao lado. */
  inTable?: boolean;
}) {
  switch (field.kind) {
    case 'number':
      return (
        <div className="flex items-center gap-2">
          <NumericInput
            value={value as number}
            onCommit={onChange}
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            invalid={invalid}
            aria-label={ariaLabel}
          />
          {field.unit ? (
            <span className="text-label text-muted-foreground">{field.unit}</span>
          ) : null}
        </div>
      );
    case 'range': {
      const range = (value as { min: number; max: number } | undefined) ?? {
        min: field.min,
        max: field.max,
      };
      return (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <span className="text-label text-muted-foreground">de</span>
          <NumericInput
            value={range.min}
            onCommit={(min) => onChange({ ...range, min })}
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            invalid={invalid}
            aria-label={`${ariaLabel}, mínimo`}
            className="w-24"
          />
          <span className="text-label text-muted-foreground">até</span>
          <NumericInput
            value={range.max}
            onCommit={(max) => onChange({ ...range, max })}
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            invalid={invalid}
            aria-label={`${ariaLabel}, máximo`}
            className="w-24"
          />
          {field.unit ? (
            <span className="text-label text-muted-foreground">{field.unit}</span>
          ) : null}
        </div>
      );
    }
    case 'boolean':
      return (
        <Switch
          checked={Boolean(value)}
          onChange={onChange}
          disabled={disabled}
          ariaLabel={ariaLabel}
        />
      );
    case 'choice':
      return (
        <ComboboxField
          id={id}
          label={field.label}
          items={field.options}
          value={value as string}
          onChange={onChange}
          className={inTable ? 'w-full' : 'w-full @lg:w-72'}
        />
      );
    case 'multiChoice':
      return (
        <MultiComboboxField
          id={id}
          label={field.label}
          items={field.options}
          selected={(value as string[]) ?? []}
          onChange={onChange}
          max={field.options.length}
          disabled={disabled}
        />
      );
    case 'text':
      return (
        <div>
          <TextAreaField
            value={(value as string) ?? ''}
            aria-label={ariaLabel}
            onChange={onChange}
            maxLength={field.maxLength}
          />
          <p className="mt-1 text-right text-xs text-muted-foreground">
            {((value as string) ?? '').length}/{field.maxLength}
          </p>
        </div>
      );
    case 'textList':
      return (
        <LineListInput
          value={(value as string[]) ?? []}
          maxItems={field.maxItems}
          ariaLabel={ariaLabel}
          onChange={onChange}
        />
      );
  }
}

function UsualChip({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Info aria-hidden="true" className="size-3.5" />
      {text}
    </span>
  );
}

/**
 * Um campo de metodologia com tudo o que o profissional precisa para preencher bem: o que é,
 * como preencher, a faixa usual e a referência. Fora da faixa usual, pede a justificativa ali
 * mesmo, ao lado do valor.
 */
export function MethodologyField({
  id,
  path: fieldPath,
  field,
  value,
  onChange,
  disabled,
  outOfRange,
  justification,
  onJustify,
}: {
  id: string;
  /** `seção.campo`: base dos caminhos usados nas justificativas. */
  path: string;
  field: FieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
  /** Caminhos (dentro deste campo) com valor fora da faixa usual. */
  outOfRange: string[];
  justification: (path: string) => string;
  onJustify: (path: string, text: string) => void;
}) {
  const range = plausibleText(field);
  const labelId = `${id}-label`;
  const columnCount = field.kind === 'table' ? Object.keys(field.columns).length : 0;
  const rowGrid = TABLE_GRID[Math.min(Math.max(columnCount, 1), 4)];

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className={cn(
        'rounded-lg border bg-card p-5 @lg:p-6',
        outOfRange.length > 0 ? 'border-coral/60' : 'border-border',
      )}
    >
      <h3 id={labelId} className="text-body font-semibold tracking-tight">
        {field.label}
      </h3>
      {field.hint ? <p className="mt-1 text-label text-muted-foreground">{field.hint}</p> : null}
      {range || field.reference ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {range ? <UsualChip text={range} /> : null}
          {field.reference ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <BookOpen aria-hidden="true" className="size-3.5" /> {field.reference}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5">
        {field.kind === 'table' ? (
          <div className="overflow-hidden rounded-md border border-border">
            <div
              aria-hidden="true"
              className={cn(
                'hidden gap-4 border-b border-border bg-secondary/40 px-4 py-2.5 text-xs font-medium text-muted-foreground @2xl:grid',
                rowGrid,
              )}
            >
              <span />
              {Object.values(field.columns).map((column) => (
                <span key={column.label}>
                  {column.label}
                  {plausibleText(column) ? (
                    <span className="block font-normal">{plausibleText(column)}</span>
                  ) : null}
                </span>
              ))}
            </div>
            {field.rows.map((row) => {
              const rowValue = (value as Record<string, Record<string, unknown>>)?.[row.key] ?? {};
              return (
                <div
                  key={row.key}
                  role="group"
                  aria-label={row.label}
                  className={cn(
                    'grid gap-3 border-b border-border px-4 py-3.5 last:border-b-0 @2xl:items-center @2xl:gap-4',
                    rowGrid,
                  )}
                >
                  <div>
                    <p className="text-label font-medium">{row.label}</p>
                    {row.plausible ? (
                      <p className="text-xs text-muted-foreground">
                        {Object.values(field.columns).map((column) =>
                          plausibleText(column, row.plausible),
                        )[0] ?? null}
                      </p>
                    ) : null}
                  </div>
                  {Object.entries(field.columns).map(([key, column]) => (
                    <div key={key}>
                      <p
                        aria-hidden="true"
                        className="mb-1 text-xs text-muted-foreground @2xl:hidden"
                      >
                        {column.label}
                        {plausibleText(column, row.plausible)
                          ? ` · ${plausibleText(column, row.plausible)}`
                          : ''}
                      </p>
                      <SimpleInput
                        id={`${id}-${row.key}-${key}`}
                        field={column}
                        value={rowValue[key]}
                        disabled={disabled}
                        ariaLabel={`${row.label}, ${column.label}`}
                        inTable
                        invalid={outOfRange.includes(`${fieldPath}.${row.key}.${key}`)}
                        onChange={(cell) =>
                          onChange({
                            ...(value as object),
                            [row.key]: { ...rowValue, [key]: cell },
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ) : (
          <SimpleInput
            id={id}
            field={field}
            value={value}
            onChange={onChange}
            disabled={disabled}
            ariaLabel={field.label}
            invalid={outOfRange.length > 0}
          />
        )}
      </div>

      {outOfRange.map((path) => (
        <div key={path} className="mt-5 rounded-md border border-coral/60 bg-coral/10 p-4">
          <p className="flex items-start gap-2 text-label font-semibold">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              Valor fora da faixa usual{cellLabel(field, fieldPath, path)}. Explique por que ele faz
              sentido para os alunos da MOVIVO; sem isso não é possível testar nem publicar.
            </span>
          </p>
          <TextAreaField
            value={justification(path)}
            onChange={(text) => onJustify(path, text)}
            maxLength={1000}
            aria-label={`Justificativa: ${field.label}`}
            placeholder="Por que este valor para os alunos da MOVIVO?"
            className="mt-3"
          />
        </div>
      ))}
    </div>
  );
}

/** " (Iniciante · Séries/semana)" para uma célula de tabela; vazio para campos simples. */
function cellLabel(field: FieldSpec, fieldPath: string, path: string): string {
  if (field.kind !== 'table') return '';
  const [rowKey, columnKey] = path.slice(fieldPath.length + 1).split('.');
  const row = field.rows.find((r) => r.key === rowKey)?.label;
  const column = columnKey ? field.columns[columnKey]?.label : undefined;
  const parts = [row, column].filter(Boolean);
  return parts.length > 0 ? ` (${parts.join(' · ')})` : '';
}
