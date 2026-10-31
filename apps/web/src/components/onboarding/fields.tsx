'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';

import {
  CLOCK_HM,
  CLOCK_HMS,
  CLOCK_SLEEP,
  currencyDigits,
  maskClock,
  maskCurrency,
  maskNumber,
  maskRaceTime,
} from './masks';

const QUESTION_TITLE_CLASS_NAME = 'text-body font-semibold text-foreground';

/**
 * Primitivas de campo do onboarding v2 (Sofia §§2-8) — reusam o padrão de chip
 * (`aria-pressed` + Verde Pulso) já estabelecido em `plan-selector.tsx`,
 * em vez de introduzir uma lib de formulário nova (nenhuma existe no projeto).
 */

export function QuestionField({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('flex flex-col gap-2', className)} {...props} />;
}

export function QuestionStack({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('flex flex-col gap-6', className)} {...props} />;
}

/**
 * Orientação discreta sob o título de toda pergunta: se a resposta é obrigatória ou opcional
 * e, nas perguntas de escolha, quantas opções cabem ("Obrigatória · Escolha 1 opção").
 */
export function QuestionMeta({ optional = false, hint }: { optional?: boolean; hint?: string }) {
  return (
    <p className="text-[0.75rem] leading-4 text-muted-foreground">
      {optional ? 'Opcional' : 'Obrigatória'}
      {hint ? ` · ${hint}` : ''}
    </p>
  );
}

export function selectionHint(multi: boolean, max?: number, count = 0): string {
  if (!multi) return 'Escolha 1 opção';
  if (max === undefined) return 'Escolha quantas quiser';
  return count > 0 ? `Escolha até ${max} · ${count} de ${max}` : `Escolha até ${max}`;
}

export function FieldLabel({
  htmlFor,
  children,
  optional,
  hint,
}: {
  htmlFor?: string;
  children: React.ReactNode;
  optional?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={htmlFor} className={QUESTION_TITLE_CLASS_NAME}>
        {children}
      </label>
      <QuestionMeta optional={optional} hint={hint} />
    </div>
  );
}

export function FieldHelp({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <p id={id} className="text-label text-muted-foreground">
      {children}
    </p>
  );
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

/**
 * Mensagem de formato ou faixa de um campo, exibida só depois que o aluno sai dele: enquanto
 * digita, um valor parcial ("1" a caminho de "170") não é erro.
 */
export function FieldValidation({
  error,
  children,
}: {
  error?: string;
  children: React.ReactNode;
}) {
  const [touched, setTouched] = React.useState(false);
  return (
    <div className="flex flex-col gap-2" onBlur={() => setTouched(true)}>
      {children}
      <FieldError message={touched ? error : undefined} />
    </div>
  );
}

// Controle e inversão de direção (U+202A…U+202E, U+2066…U+2069) não têm uso legítimo aqui e
// servem para disfarçar texto; quebra de linha e tabulação continuam valendo nos textos longos.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g;

export const stripUnsafeChars = (text: string) => text.replace(UNSAFE_CHARS, '');

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
      onChange={(e) => onChange(stripUnsafeChars(e.target.value))}
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
    <div className="flex flex-col gap-1">
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(stripUnsafeChars(e.target.value))}
        maxLength={maxLength}
        rows={rows}
        aria-describedby={maxLength ? `${id}-count` : undefined}
        className="min-h-28 w-full resize-y rounded-xl border border-input bg-white px-4 py-3 text-body text-foreground outline-none placeholder:text-muted-foreground transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-white"
      />
      {maxLength && (
        <p id={`${id}-count`} className="text-right text-[0.75rem] leading-4 text-muted-foreground">
          {value.length} de {maxLength} caracteres
        </p>
      )}
    </div>
  );
}

/** Um item de escolha (single ou multi). */
export interface ChoiceItem<T extends string> {
  value: T;
  label: string;
  /** Linha de apoio sob o rótulo (ajuda a se autoavaliar). */
  description?: string;
}

/** Círculo de seleção: sempre à esquerda da opção, em toda a anamnese. */
function SelectionIndicator({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-full border text-label font-bold',
        selected
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-input text-transparent',
      )}
    >
      ✓
    </span>
  );
}

interface ComboboxBase<T extends string> {
  id: string;
  legend: React.ReactNode;
  items: readonly ChoiceItem<T>[];
  placeholder?: string;
  optional?: boolean;
  /** Texto de apoio entre o título e a lista. */
  help?: React.ReactNode;
  disabled?: boolean;
}

export type ComboboxProps<T extends string> = ComboboxBase<T> &
  (
    | { multiple?: false; value: T | null; onChange: (value: T) => void }
    | {
        multiple: true;
        value: readonly T[];
        /** Liga/desliga um item. */
        onChange: (value: T) => void;
        /** Teto de itens marcados. */
        max?: number;
      }
  );

/**
 * Lista de seleção padronizada. Em `multiple` a lista continua aberta enquanto o aluno marca
 * vários itens.
 */
export function Combobox<T extends string>(props: ComboboxProps<T>) {
  const {
    id,
    legend,
    items,
    placeholder = 'Selecione uma opção',
    optional,
    help,
    disabled,
  } = props;
  const multiple = props.multiple === true;
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const chosen: readonly T[] = props.multiple
    ? props.value
    : props.value === null
      ? []
      : [props.value];
  const max = props.multiple ? props.max : undefined;
  const atLimit = max !== undefined && chosen.length >= max;
  const firstChosenIndex = items.findIndex((item) => chosen.includes(item.value));
  const chosenItems = items.filter((item) => chosen.includes(item.value));

  React.useEffect(() => {
    if (!open) return;

    function closeOnOutsideClick(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener('pointerdown', closeOnOutsideClick);
    optionRefs.current[Math.max(firstChosenIndex, 0)]?.focus();
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
    // Só ao abrir: marcar itens numa lista múltipla não pode devolver o foco ao primeiro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function closeMenu() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function selectOption(item: ChoiceItem<T>) {
    if (multiple && !chosen.includes(item.value) && atLimit) return;
    props.onChange(item.value);
    if (!multiple) closeMenu();
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
  const helpId = `${id}-help`;
  const listboxId = `${id}-listbox`;
  const triggerText =
    chosenItems.length === 0
      ? placeholder
      : chosenItems.length <= 2
        ? chosenItems.map((item) => item.label).join(', ')
        : `${chosenItems.length} selecionadas`;

  return (
    <fieldset className="min-w-0">
      <legend id={legendId} className={QUESTION_TITLE_CLASS_NAME}>
        {legend}
      </legend>
      <div className="mt-0.5">
        <QuestionMeta optional={optional} hint={selectionHint(multiple, max, chosen.length)} />
      </div>
      {help && (
        <div className="mt-2">
          <FieldHelp id={helpId}>{help}</FieldHelp>
        </div>
      )}
      <div ref={rootRef} className="relative mt-2">
        <button
          ref={triggerRef}
          id={id}
          type="button"
          role="combobox"
          disabled={disabled}
          aria-labelledby={legendId}
          aria-describedby={help ? helpId : undefined}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            setOpen(true);
          }}
          className="flex h-[52px] w-full items-center gap-3 rounded-xl border border-input bg-white px-4 text-left text-body font-medium text-foreground outline-none transition-colors hover:border-petroleo hover:bg-secondary focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-input disabled:hover:bg-white"
        >
          <span
            className={cn(
              'min-w-0 flex-1 truncate',
              chosenItems.length === 0 && 'text-muted-foreground',
            )}
          >
            {triggerText}
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
            aria-multiselectable={multiple || undefined}
            className="absolute inset-x-0 top-full z-40 mt-2 max-h-80 w-full overflow-y-auto rounded-2xl border border-border bg-nevoa p-2 shadow-[0_12px_30px_rgba(6,48,42,0.16)]"
          >
            {items.map((item, index) => {
              const isChosen = chosen.includes(item.value);
              const isBlocked = multiple && !isChosen && atLimit;
              return (
                <button
                  key={item.value}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  type="button"
                  role="option"
                  aria-selected={isChosen}
                  aria-disabled={isBlocked || undefined}
                  tabIndex={-1}
                  onClick={() => selectOption(item)}
                  onKeyDown={(event) => handleOptionKeyDown(event, index)}
                  className={cn(
                    'flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-body text-petroleo outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring',
                    isChosen &&
                      (multiple
                        ? 'bg-accent font-semibold'
                        : 'bg-verde-pulso font-semibold hover:bg-verde-pulso'),
                    isBlocked && 'opacity-50',
                  )}
                >
                  {multiple && <SelectionIndicator selected={isChosen} />}
                  <span className="flex min-w-0 flex-col">
                    <span>{item.label}</span>
                    {item.description && (
                      <span className="text-label font-normal text-muted-foreground">
                        {item.description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </fieldset>
  );
}

/** Disposição das opções de um {@link ChoiceGroup}. */
export type ChoiceLayout =
  /** Duas colunas (padrão). */
  | 'grid'
  /** Duas colunas no celular e três a partir de `sm`. */
  | 'columns'
  /** Lista vertical, uma opção abaixo da outra. */
  | 'stack';

const LAYOUT_CLASS: Record<ChoiceLayout, string> = {
  // `auto-rows-fr`: no mobile os rótulos quebram em 2 linhas e cada linha do grid
  // ganhava uma altura diferente. Iguala todas as linhas à mais alta do grupo.
  grid: 'grid auto-rows-fr grid-cols-2 gap-3',
  columns: 'grid auto-rows-fr grid-cols-2 gap-3 sm:grid-cols-3',
  stack: 'grid grid-cols-1 gap-3',
};

/** Grupo de opções — `multi` controla se mais de uma pode ficar marcada, `max` o teto. */
export function ChoiceGroup<T extends string>({
  legend,
  help,
  items,
  selected,
  onToggle,
  multi = false,
  max,
  optional,
  disabledValues,
  layout = 'grid',
}: {
  legend?: string;
  help?: React.ReactNode;
  items: readonly ChoiceItem<T>[];
  selected: readonly T[];
  onToggle: (value: T) => void;
  multi?: boolean;
  /** Teto de opções marcadas (só com `multi`); ao atingi-lo as demais ficam indisponíveis. */
  max?: number;
  optional?: boolean;
  /** Itens indisponíveis permanecem focáveis, com `aria-disabled`, mas a ação fica inerte. */
  disabledValues?: readonly T[];
  layout?: ChoiceLayout;
}) {
  const atLimit = multi && max !== undefined && selected.length >= max;
  return (
    <fieldset className="min-w-0">
      {legend && (
        <>
          <legend className={QUESTION_TITLE_CLASS_NAME}>{legend}</legend>
          <div className="mt-0.5">
            <QuestionMeta optional={optional} hint={selectionHint(multi, max, selected.length)} />
          </div>
        </>
      )}
      <div className="mt-2 flex flex-col gap-2">
        {help && <FieldHelp>{help}</FieldHelp>}
        <div className={LAYOUT_CLASS[layout]}>
          {items.map((item) => {
            const isSelected = selected.includes(item.value);
            const isDisabled =
              !isSelected && ((disabledValues?.includes(item.value) ?? false) || atLimit);
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
                  'inline-flex items-center justify-start gap-3 rounded-xl border text-left font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-white',
                  'min-h-[52px] w-full px-4 py-3 text-body',
                  isSelected
                    ? 'border-petroleo bg-accent text-petroleo'
                    : 'border-input bg-white text-foreground hover:border-petroleo hover:bg-secondary',
                  isDisabled && 'opacity-50',
                )}
              >
                <SelectionIndicator selected={isSelected} />
                <span className="flex min-w-0 flex-col">
                  <span>{item.label}</span>
                  {item.description && (
                    <span className="text-label font-normal text-muted-foreground">
                      {item.description}
                    </span>
                  )}
                </span>
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
  optional,
}: {
  legend: string;
  value: boolean | undefined;
  onChange: (value: boolean) => void;
  optional?: boolean;
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
      optional={optional}
    />
  );
}

const MASKED_INPUT_CLASS_NAME = cn(
  'h-[52px] w-full rounded-xl border border-input bg-white px-4 text-body text-foreground outline-none placeholder:text-muted-foreground',
  'transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-white',
);

/**
 * Campo numérico com a unidade colada ao número enquanto se digita ("39.9 km"). O valor
 * guardado é só o número; a unidade é desenhada logo depois do texto digitado.
 */
export function UnitInput({
  id,
  value,
  onChange,
  unit,
  maxInteger = 3,
  decimals = 0,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Texto fixo ou função do número digitado (ex.: singular/plural). */
  unit: string | ((value: string) => string);
  maxInteger?: number;
  decimals?: number;
  placeholder?: string;
}) {
  const unitText = typeof unit === 'function' ? unit(value) : unit;
  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode={decimals > 0 ? 'decimal' : 'numeric'}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(maskNumber(event.target.value, maxInteger, decimals))}
        className={MASKED_INPUT_CLASS_NAME}
      />
      {value !== '' && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-4 flex items-center whitespace-pre text-body text-foreground"
        >
          <span className="invisible">{value}</span>
          <span className="ml-1.5 text-muted-foreground">{unitText}</span>
        </span>
      )}
    </div>
  );
}

/**
 * Valor em reais com a máscara `R$ 1.234,56` aplicada enquanto se digita. O valor guardado são
 * os dígitos em centavos (`"123456"`), que o rascunho converte em reais.
 */
export function CurrencyInput({
  id,
  value,
  onChange,
}: {
  id: string;
  /** Centavos, só dígitos. */
  value: string;
  onChange: (cents: string) => void;
}) {
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={maskCurrency(value)}
      placeholder="R$ 0,00"
      onChange={(event) => onChange(currencyDigits(event.target.value))}
      className={MASKED_INPUT_CLASS_NAME}
    />
  );
}

/** Tipos de relógio aceitos por {@link ClockInput}. */
export type ClockKind = 'hm' | 'sleep' | 'hms' | 'race';

/** Campo de tempo com os `:` inseridos enquanto o aluno digita. */
export function ClockInput({
  id,
  value,
  onChange,
  kind,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  kind: ClockKind;
  placeholder: string;
}) {
  function apply(input: string) {
    if (kind === 'race') return onChange(maskRaceTime(input, value));
    const fields = kind === 'hms' ? CLOCK_HMS : kind === 'sleep' ? CLOCK_SLEEP : CLOCK_HM;
    return onChange(maskClock(input, value, fields));
  }
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={value}
      placeholder={placeholder}
      onChange={(event) => apply(event.target.value)}
      className={MASKED_INPUT_CLASS_NAME}
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
