'use client';

/**
 * Campos compactos da edição do protocolo: rótulo pequeno em cima, caixa de 44px no toque e
 * 40px no ponteiro fino, mesmos tokens do painel. O número aceita apagar e redigitar (o valor só
 * vai para o rascunho quando é um número) e volta ao último válido ao sair do campo.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { CONTROL_H, FIELD_SELECT, FOCUS_RING } from './control-center-table';

const BOX = cn(
  CONTROL_H,
  'w-full min-w-0 rounded-md border border-input bg-background px-2.5 text-label text-foreground tabular-nums outline-none',
  'focus-visible:ring-[3px] focus-visible:ring-ring aria-invalid:border-destructive',
);

export function FieldLabel({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid min-w-0 content-start gap-1', className)}>
      <label htmlFor={htmlFor} className="truncate text-xs text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

export function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  ariaLabel,
  className,
  allowEmpty = false,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min: number;
  max: number;
  step?: number;
  /** Nome completo para o leitor de tela ("Séries de Agachamento"); o visível é o `label`. */
  ariaLabel?: string;
  className?: string;
  /** Campo opcional (ex.: RIR): vazio vira `undefined`. */
  allowEmpty?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => {
    setText(value === undefined ? '' : String(value));
  }, [value]);
  return (
    <FieldLabel label={label} htmlFor={id} className={className}>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={text}
        aria-label={ariaLabel}
        onChange={(event) => {
          const raw = event.target.value;
          setText(raw);
          if (raw === '') {
            if (allowEmpty) onChange(undefined);
            return;
          }
          const parsed = Number(raw);
          if (Number.isFinite(parsed)) onChange(parsed);
        }}
        onBlur={() => setText(value === undefined ? '' : String(value))}
        className={cn(
          BOX,
          '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
        )}
      />
    </FieldLabel>
  );
}

export function TextInput({
  label,
  value,
  onChange,
  maxLength,
  ariaLabel,
  className,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  ariaLabel?: string;
  className?: string;
  multiline?: boolean;
}) {
  const id = useId();
  return (
    <FieldLabel label={label} htmlFor={id} className={className}>
      {multiline ? (
        <textarea
          id={id}
          rows={3}
          value={value}
          maxLength={maxLength}
          aria-label={ariaLabel}
          onChange={(event) => onChange(event.target.value)}
          className={cn(BOX, 'h-auto min-h-20 resize-y py-2 lg:h-auto')}
        />
      ) : (
        <input
          id={id}
          value={value}
          maxLength={maxLength}
          aria-label={ariaLabel}
          onChange={(event) => onChange(event.target.value)}
          className={BOX}
        />
      )}
    </FieldLabel>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  ariaLabel?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <FieldLabel label={label} htmlFor={id} className={className}>
      <select
        id={id}
        value={value}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value as T)}
        className={cn(FIELD_SELECT, CONTROL_H, FOCUS_RING, 'bg-background')}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldLabel>
  );
}

/** Problemas do servidor apontados para esta linha. */
export function RowIssues({ messages }: { messages: readonly string[] | undefined }) {
  if (!messages || messages.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-xs text-foreground">
      {messages.map((message) => (
        <li key={message} className="flex gap-1.5">
          <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-coral" />
          {message}
        </li>
      ))}
    </ul>
  );
}
