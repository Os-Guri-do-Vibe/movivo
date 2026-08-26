'use client';

import * as React from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Primitivas de campo do dashboard (achado 2026-08-22, a pedido do fundador — item 1/2/5
 * do backlog de ajustes da tela de edição de protocolo). Mesmo padrão visual e mesma
 * lógica de `components/onboarding/fields.tsx` (Combobox acessível por teclado, chip de
 * escolha), mas com tokens semânticos (`bg-background`/`bg-card`/`text-foreground`) em vez
 * de `bg-white` fixo — o onboarding é uma experiência deliberadamente só clara
 * (`.onboarding-light`), o dashboard suporta modo escuro (`ThemeToggle` no shell), então
 * copiar aquele arquivo aqui quebraria visualmente no escuro.
 */

const FIELD_LABEL_CLASS = 'text-label font-semibold text-foreground';

export function TextField({
  value,
  onChange,
  type = 'text',
  placeholder,
  maxLength,
  min,
  max,
  className,
  ...rest
}: {
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  maxLength?: number;
  min?: number;
  max?: number;
  className?: string;
} & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type' | 'placeholder' | 'maxLength' | 'min' | 'max' | 'className'
>) {
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      min={min}
      max={max}
      className={cn(
        'min-h-11 w-full rounded-xl border border-input bg-background px-3 text-label text-foreground outline-none placeholder:text-muted-foreground',
        'transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring',
        className,
      )}
      {...rest}
    />
  );
}

/** Campo numérico com stepper próprio (substitui as setas nativas do navegador, que não seguem o padrão visual movivo e têm alvo de clique inconsistente entre browsers). */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  className,
  ...rest
}: {
  value: string | number;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
} & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type' | 'min' | 'max' | 'step' | 'className'
>) {
  const numeric = typeof value === 'number' ? value : Number(value);
  const atMin = min !== undefined && Number.isFinite(numeric) && numeric <= min;
  const atMax = max !== undefined && Number.isFinite(numeric) && numeric >= max;

  function stepBy(delta: number) {
    const base = Number.isFinite(numeric) ? numeric : (min ?? 0);
    let next = base + delta;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    onChange(String(next));
  }

  return (
    <div
      className={cn(
        'flex min-h-11 w-full items-stretch rounded-xl border border-input bg-background outline-none',
        'transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring',
        className,
      )}
    >
      <input
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 rounded-l-xl bg-transparent px-3 text-label text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        {...rest}
      />
      <div className="flex flex-col border-l border-input">
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          disabled={atMax}
          onClick={() => stepBy(step)}
          className="flex flex-1 items-center justify-center rounded-tr-[11px] px-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronUp aria-hidden="true" className="size-3" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          disabled={atMin}
          onClick={() => stepBy(-step)}
          className="flex flex-1 items-center justify-center rounded-br-[11px] border-t border-input px-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronDown aria-hidden="true" className="size-3" />
        </button>
      </div>
    </div>
  );
}

export function TextAreaField({
  value,
  onChange,
  placeholder,
  maxLength,
  className,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  className?: string;
} & Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  'value' | 'onChange' | 'placeholder' | 'maxLength' | 'className'
>) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      className={cn(
        'min-h-16 w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-label text-foreground outline-none placeholder:text-muted-foreground',
        'transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring',
        className,
      )}
      {...rest}
    />
  );
}

export interface FieldOption<T extends string> {
  value: T;
  label: string;
}

/** Combobox acessível (mesma lógica de teclado/foco de `onboarding/fields.tsx`). */
export function ComboboxField<T extends string>({
  id,
  label,
  items,
  value,
  onChange,
  placeholder = 'Selecione uma opção',
  className,
}: {
  id: string;
  label: string;
  items: readonly FieldOption<T>[];
  value: T;
  onChange: (value: T) => void;
  placeholder?: string;
  className?: string;
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

  function selectOption(item: FieldOption<T>) {
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
      selectOption(items[index] as FieldOption<T>);
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

  const labelId = `${id}-label`;
  const listboxId = `${id}-listbox`;

  return (
    <div className={cn('min-w-0', className)}>
      <span id={labelId} className={FIELD_LABEL_CLASS}>
        {label}
      </span>
      <div ref={rootRef} className="relative mt-1">
        <button
          ref={triggerRef}
          id={id}
          type="button"
          role="combobox"
          aria-labelledby={labelId}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            setOpen(true);
          }}
          className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-input bg-background px-3 text-left text-label font-medium text-foreground outline-none transition-colors hover:border-primary hover:bg-secondary focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-muted-foreground')}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn('size-4 shrink-0 text-primary transition-transform', open && 'rotate-180')}
          />
        </button>

        {open && (
          <div
            id={listboxId}
            role="listbox"
            aria-labelledby={labelId}
            className="absolute inset-x-0 top-full z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-lg"
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
                  'flex min-h-10 w-full items-center rounded-lg px-3 py-1.5 text-left text-label text-popover-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring',
                  item.value === value && 'bg-accent font-semibold text-accent-foreground',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Fileira compacta de chips numéricos (ex.: frequência semanal 1–7x). */
export function ChipGroupField<T extends string>({
  label,
  items,
  value,
  onChange,
  className,
}: {
  label: string;
  items: readonly FieldOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend className={FIELD_LABEL_CLASS}>{label}</legend>
      <div className="mt-1 flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
        {items.map((item) => {
          const isSelected = item.value === value;
          return (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onChange(item.value)}
              className={cn(
                'inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border px-2.5 text-label font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring',
                isSelected
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background text-foreground hover:border-primary hover:bg-secondary',
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
