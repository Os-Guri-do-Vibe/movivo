'use client';

import type { ColumnSpec, FieldSpec } from '@movivo/shared';
import { AlertTriangle, BookOpen } from 'lucide-react';

import { cn } from '@/lib/utils';

import { ComboboxField, MultiComboboxField, NumberField, TextAreaField } from './fields';

/** Texto curto da faixa plausível (o que a literatura e a prática sustentam). */
export function plausibleText(field: FieldSpec | ColumnSpec): string | null {
  if ((field.kind !== 'number' && field.kind !== 'range') || !field.plausible) return null;
  const unit = field.unit ? ` ${field.unit}` : '';
  return `faixa usual ${field.plausible[0]}–${field.plausible[1]}${unit}`;
}

function toNumber(raw: string, fallback: number): number {
  const parsed = Number(raw.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Entrada de um campo simples (também usada nas células de tabela). */
function SimpleInput({
  id,
  field,
  value,
  onChange,
  disabled,
}: {
  id: string;
  field: ColumnSpec | Exclude<FieldSpec, { kind: 'table' }>;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
}) {
  switch (field.kind) {
    case 'number':
      return (
        <div className="flex items-center gap-2">
          <NumberField
            value={(value as number) ?? ''}
            onChange={(raw) => onChange(toNumber(raw, value as number))}
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            className="w-28"
          />
          {field.unit ? <span className="text-xs text-muted-foreground">{field.unit}</span> : null}
        </div>
      );
    case 'range': {
      const range = (value as { min: number; max: number }) ?? { min: field.min, max: field.max };
      return (
        <div className="flex items-center gap-2">
          <NumberField
            value={range.min}
            onChange={(raw) => onChange({ ...range, min: toNumber(raw, range.min) })}
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            className="w-24"
          />
          <span className="text-xs text-muted-foreground">a</span>
          <NumberField
            value={range.max}
            onChange={(raw) => onChange({ ...range, max: toNumber(raw, range.max) })}
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            className="w-24"
          />
          {field.unit ? <span className="text-xs text-muted-foreground">{field.unit}</span> : null}
        </div>
      );
    }
    case 'boolean':
      return (
        <input
          id={id}
          type="checkbox"
          className="size-4 accent-verde-pulso"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
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
          className="w-64"
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
        <TextAreaField
          value={(value as string) ?? ''}
          onChange={onChange}
          maxLength={field.maxLength}
        />
      );
    case 'textList':
      return (
        <TextAreaField
          value={((value as string[]) ?? []).join('\n')}
          onChange={(raw) =>
            onChange(
              raw
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .slice(0, field.maxItems),
            )
          }
          placeholder="Um item por linha"
        />
      );
  }
}

/**
 * Um campo de metodologia com tudo o que o profissional precisa para preencher bem: rótulo,
 * dica, referência e faixa usual. Fora da faixa usual, pede a justificativa ali mesmo.
 */
export function MethodologyField({
  id,
  field,
  value,
  onChange,
  disabled,
  outOfRange,
  justification,
  onJustify,
}: {
  id: string;
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
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card p-4',
        outOfRange.length > 0 && 'border-coral/70',
      )}
    >
      <label htmlFor={id} className="text-label font-semibold">
        {field.label}
      </label>
      {field.hint ? <p className="mt-1 text-xs text-muted-foreground">{field.hint}</p> : null}
      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        {range ? <span>{range}</span> : null}
        {field.reference ? (
          <span className="inline-flex items-center gap-1">
            <BookOpen className="size-3.5" aria-hidden /> {field.reference}
          </span>
        ) : null}
      </div>

      <div className="mt-3">
        {field.kind === 'table' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-label">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-4 font-medium" />
                  {Object.entries(field.columns).map(([key, column]) => (
                    <th key={key} className="py-1 pr-4 font-medium">
                      {column.label}
                      {plausibleText(column) ? (
                        <span className="block font-normal">{plausibleText(column)}</span>
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {field.rows.map((row) => {
                  const rowValue =
                    (value as Record<string, Record<string, unknown>>)?.[row.key] ?? {};
                  return (
                    <tr key={row.key} className="border-t border-border">
                      <th scope="row" className="py-2 pr-4 text-left font-medium">
                        {row.label}
                      </th>
                      {Object.entries(field.columns).map(([key, column]) => (
                        <td key={key} className="py-2 pr-4">
                          <SimpleInput
                            id={`${id}-${row.key}-${key}`}
                            field={column}
                            value={rowValue[key]}
                            disabled={disabled}
                            onChange={(cell) =>
                              onChange({
                                ...(value as object),
                                [row.key]: { ...rowValue, [key]: cell },
                              })
                            }
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <SimpleInput
            id={id}
            field={field}
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
        )}
      </div>

      {outOfRange.map((path) => (
        <div key={path} className="mt-3 rounded-lg border border-coral bg-coral/10 p-3">
          <p className="inline-flex items-center gap-2 text-xs font-semibold">
            <AlertTriangle className="size-3.5" aria-hidden />
            Fora da faixa usual
            {path.split('.').length > 2 ? ` (${path.split('.').slice(2).join(' · ')})` : ''}:
            justifique para poder testar e publicar.
          </p>
          <TextAreaField
            value={justification(path)}
            onChange={(text) => onJustify(path, text)}
            maxLength={1000}
            placeholder="Por que este valor para os alunos da MOVIVO?"
            className="mt-2"
          />
        </div>
      ))}
    </div>
  );
}
