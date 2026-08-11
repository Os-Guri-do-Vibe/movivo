'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Primitivas de campo do onboarding v2 (Sofia §§2-8) — reusam o padrão de chip
 * (`aria-pressed` + Verde Pulso) já estabelecido em `plan-selector.tsx`/`start-cta.tsx`,
 * em vez de introduzir uma lib de formulário nova (nenhuma existe no projeto).
 */

export function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="text-label font-semibold">
      {children}
    </label>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-label text-destructive">
      {message}
    </p>
  );
}

export function TextInput({
  id,
  value,
  onChange,
  type = 'text',
  placeholder,
  autoComplete,
  inputMode,
  maxLength,
  error,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  maxLength?: number;
  error?: boolean;
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete={autoComplete}
      inputMode={inputMode}
      maxLength={maxLength}
      aria-invalid={error || undefined}
      className={cn(
        'h-11 rounded-lg border border-input bg-background px-4 text-body text-foreground outline-none placeholder:text-muted-foreground',
        'focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        error && 'border-destructive',
      )}
    />
  );
}

export function TextArea({
  id,
  value,
  onChange,
  maxLength,
  rows = 3,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  rows?: number;
}) {
  return (
    <textarea
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={maxLength}
      rows={rows}
      className="rounded-lg border border-input bg-background px-4 py-3 text-body text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    />
  );
}

/** Um item de escolha (single ou multi). */
export interface ChoiceItem<T extends string> {
  value: T;
  label: string;
}

/** Grupo de chips — `multi` controla se mais de um pode ficar pressionado. */
export function ChoiceGroup<T extends string>({
  legend,
  items,
  selected,
  onToggle,
  multi = false,
  disabledValues,
  columns = false,
}: {
  legend?: string;
  items: readonly ChoiceItem<T>[];
  selected: readonly T[];
  onToggle: (value: T) => void;
  multi?: boolean;
  /** Itens além do limite ficam `aria-disabled` mas continuam focáveis/clicáveis (Sofia §3.2). */
  disabledValues?: readonly T[];
  columns?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      {legend && <legend className="text-label font-semibold">{legend}</legend>}
      <div className={cn('flex flex-wrap gap-2', columns && 'grid grid-cols-2 sm:grid-cols-3')}>
        {items.map((item) => {
          const isSelected = selected.includes(item.value);
          const isDisabled = !isSelected && (disabledValues?.includes(item.value) ?? false);
          return (
            <button
              key={item.value}
              type="button"
              role={multi ? undefined : 'radio'}
              aria-pressed={multi ? isSelected : undefined}
              aria-checked={multi ? undefined : isSelected}
              aria-disabled={isDisabled || undefined}
              onClick={() => onToggle(item.value)}
              className={cn(
                'inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-center text-body font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                isSelected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground',
                isDisabled && 'opacity-50',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function YesNo({
  legend,
  value,
  onChange,
}: {
  legend: string;
  value: boolean | undefined;
  onChange: (value: boolean) => void;
}) {
  return (
    <ChoiceGroup
      legend={legend}
      items={[
        { value: 'no', label: 'Não' },
        { value: 'yes', label: 'Sim' },
      ]}
      selected={value === undefined ? [] : [value ? 'yes' : 'no']}
      onToggle={(v) => onChange(v === 'yes')}
    />
  );
}

export function Checkbox({
  id,
  checked,
  onChange,
  children,
  required,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        required={required}
        className="mt-1 size-5 shrink-0 rounded border-input text-primary focus-visible:ring-[3px] focus-visible:ring-ring"
      />
      <label htmlFor={id} className="text-body text-foreground">
        {children}
      </label>
    </div>
  );
}
