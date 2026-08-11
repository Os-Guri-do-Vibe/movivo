'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';

const QUESTION_TITLE_CLASS_NAME = 'text-body font-semibold text-foreground';

/**
 * Primitivas de campo do onboarding v2 (Sofia §§2-8) — reusam o padrão de chip
 * (`aria-pressed` + Verde Pulso) já estabelecido em `plan-selector.tsx`/`start-cta.tsx`,
 * em vez de introduzir uma lib de formulário nova (nenhuma existe no projeto).
 */

export function QuestionField({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('flex flex-col gap-2', className)} {...props} />;
}

export function QuestionStack({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('flex flex-col gap-6', className)} {...props} />;
}

export function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className={QUESTION_TITLE_CLASS_NAME}>
      {children}
    </label>
  );
}

export function FieldHelp({ children }: { children: React.ReactNode }) {
  return <p className="text-label text-muted-foreground">{children}</p>;
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-lg border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-label text-petroleo"
    >
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
        'h-[52px] w-full rounded-xl border border-input bg-white px-4 text-body text-foreground outline-none placeholder:text-muted-foreground',
        'transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-white',
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
      className="min-h-28 w-full resize-y rounded-xl border border-input bg-white px-4 py-3 text-body text-foreground outline-none placeholder:text-muted-foreground transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-white"
    />
  );
}

/** Um item de escolha (single ou multi). */
export interface ChoiceItem<T extends string> {
  value: T;
  label: string;
}

export function Combobox<T extends string>({
  id,
  legend,
  items,
  value,
  onChange,
  placeholder = 'Selecione uma opção',
}: {
  id: string;
  legend: string;
  items: readonly ChoiceItem<T>[];
  value: T | null;
  onChange: (value: T) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = items.findIndex((item) => item.value === value);
  const selected = selectedIndex >= 0 ? items[selectedIndex] : undefined;

  React.useEffect(() => {
    if (!open) return;

    function closeOnOutsideClick(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener('pointerdown', closeOnOutsideClick);
    optionRefs.current[Math.max(selectedIndex, 0)]?.focus();
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [open, selectedIndex]);

  function closeMenu() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function selectOption(item: ChoiceItem<T>) {
    onChange(item.value);
    closeMenu();
  }

  function handleOptionKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectOption(items[index] as ChoiceItem<T>);
      return;
    }

    let nextIndex: number | undefined;
    if (event.key === 'ArrowDown') nextIndex = Math.min(index + 1, items.length - 1);
    if (event.key === 'ArrowUp') nextIndex = Math.max(index - 1, 0);
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    optionRefs.current[nextIndex]?.focus();
  }

  const legendId = `${id}-label`;
  const listboxId = `${id}-listbox`;

  return (
    <fieldset className="min-w-0">
      <legend id={legendId} className={QUESTION_TITLE_CLASS_NAME}>
        {legend}
      </legend>
      <div ref={rootRef} className="relative mt-2">
        <button
          ref={triggerRef}
          id={id}
          type="button"
          role="combobox"
          aria-labelledby={legendId}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            setOpen(true);
          }}
          className="flex h-[52px] w-full items-center gap-3 rounded-xl border border-input bg-white px-4 text-left text-body font-medium text-foreground outline-none transition-colors hover:border-petroleo hover:bg-secondary focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-white"
        >
          <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-muted-foreground')}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'mr-1 size-4 shrink-0 text-petroleo transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>

        {open && (
          <div
            id={listboxId}
            role="listbox"
            aria-labelledby={legendId}
            className="absolute inset-x-0 top-full z-40 mt-2 max-h-80 w-full overflow-y-auto rounded-2xl border border-border bg-nevoa p-2 shadow-[0_12px_30px_rgba(6,48,42,0.16)]"
          >
            {items.map((item, index) => (
              <button
                key={item.value}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                type="button"
                role="option"
                aria-selected={item.value === value}
                tabIndex={-1}
                onClick={() => selectOption(item)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
                className={cn(
                  'flex min-h-[52px] w-full items-center rounded-xl px-3 py-2 text-left text-body text-petroleo outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring',
                  item.value === value && 'bg-verde-pulso font-semibold hover:bg-verde-pulso',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </fieldset>
  );
}

/** Grupo de chips — `multi` controla se mais de um pode ficar pressionado. */
export function ChoiceGroup<T extends string>({
  legend,
  help,
  items,
  selected,
  onToggle,
  multi = false,
  disabledValues,
  columns = false,
  stack = false,
  indicatorSide = 'right',
}: {
  legend?: string;
  help?: React.ReactNode;
  items: readonly ChoiceItem<T>[];
  selected: readonly T[];
  onToggle: (value: T) => void;
  multi?: boolean;
  /** Itens indisponíveis permanecem focáveis, com `aria-disabled`, mas a ação fica inerte. */
  disabledValues?: readonly T[];
  columns?: boolean;
  /** Lista vertical para opções longas, como objetivos e níveis de experiência. */
  stack?: boolean;
  /** Lado do círculo de seleção dentro do botão. Padrão `'right'`. */
  indicatorSide?: 'left' | 'right';
}) {
  return (
    <fieldset className="min-w-0">
      {legend && <legend className={QUESTION_TITLE_CLASS_NAME}>{legend}</legend>}
      <div className="mt-2 flex flex-col gap-2">
        {help && <FieldHelp>{help}</FieldHelp>}
        <div
          className={cn(
            'grid grid-cols-2 gap-3',
            columns && 'sm:grid-cols-3',
            stack && 'grid-cols-1',
          )}
        >
          {items.map((item) => {
            const isSelected = selected.includes(item.value);
            const isDisabled = !isSelected && (disabledValues?.includes(item.value) ?? false);
            const indicator = (
              <span
                key="indicator"
                aria-hidden="true"
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full border text-label font-bold',
                  isSelected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input text-transparent',
                )}
              >
                ✓
              </span>
            );
            return (
              <button
                key={item.value}
                type="button"
                role={multi ? undefined : 'radio'}
                aria-pressed={multi ? isSelected : undefined}
                aria-checked={multi ? undefined : isSelected}
                aria-disabled={isDisabled || undefined}
                onClick={() => !isDisabled && onToggle(item.value)}
                className={cn(
                  'inline-flex min-h-[52px] w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-body font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-white',
                  indicatorSide === 'left' ? 'justify-start' : 'justify-between',
                  isSelected
                    ? 'border-petroleo bg-accent text-petroleo'
                    : 'border-input bg-white text-foreground hover:border-petroleo hover:bg-secondary',
                  isDisabled && 'opacity-50',
                )}
              >
                {indicatorSide === 'left' && indicator}
                {item.label}
                {indicatorSide === 'right' && indicator}
              </button>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}

export function YesNo({
  legend,
  value,
  onChange,
  indicatorSide = 'right',
}: {
  legend: string;
  value: boolean | undefined;
  onChange: (value: boolean) => void;
  indicatorSide?: 'left' | 'right';
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
      indicatorSide={indicatorSide}
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
    <div className="flex min-h-[52px] items-start gap-3 rounded-xl border border-border bg-white p-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        required={required}
        className="mt-0.5 size-6 shrink-0 rounded-md border-input accent-primary focus-visible:ring-2 focus-visible:ring-ring"
      />
      <label htmlFor={id} className="text-body text-foreground">
        {children}
      </label>
    </div>
  );
}
