'use client';

import * as React from 'react';
import { Check, ChevronDown, CircleAlert } from 'lucide-react';

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

/**
 * Primitivas de campo da anamnese. Cada pergunta é um bloco: título forte, uma linha discreta
 * de orientação (só quando há algo a dizer: "Opcional", "Escolha até 3 · 1 de 3"), o texto de
 * apoio e, logo abaixo, a resposta. Escolha única usa círculo (radio) e múltipla usa quadrado
 * (check), para que o formato do indicador já diga quantas opções cabem.
 */

const QUESTION_TITLE_CLASS_NAME =
  'text-body font-semibold leading-snug tracking-[-0.005em] text-foreground';

/** Entrada suave de um bloco que acabou de aparecer (pergunta condicional, erro). */
const REVEAL_CLASS_NAME =
  'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-300 motion-safe:ease-out';

/** Pergunta que depende da resposta anterior: recuo com um fio verde à esquerda. */
export const FOLLOW_UP_CLASS_NAME = 'border-l-2 border-primary pl-4';

/** Superfície comum de toda entrada de texto: altura, borda, foco e erro iguais. */
const INPUT_CLASS_NAME = cn(
  'h-[52px] w-full rounded-xl border border-input bg-white px-4 text-body text-foreground outline-none placeholder:text-muted-foreground',
  'transition-[border-color,box-shadow] duration-150 hover:border-petroleo/60',
  'focus-visible:border-petroleo focus-visible:ring-[3px] focus-visible:ring-primary/40',
  'aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/25',
);

export function QuestionField({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn(
        // A ajuda logo abaixo do título fica colada nele; a resposta ganha respiro.
        'flex flex-col gap-3 [&>[data-field-help]]:-mt-1.5',
        REVEAL_CLASS_NAME,
        className,
      )}
      {...props}
    />
  );
}

export function QuestionStack({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('flex flex-col gap-8', className)} {...props} />;
}

/**
 * Agrupa perguntas relacionadas de uma etapa: um título curto em caixa-alta e respiro, sem
 * caixa. Seções seguidas ganham um fio fino entre elas.
 */
export function QuestionSection({
  title,
  description,
  className,
  children,
}: {
  title?: string;
  description?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const titleId = React.useId();
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      className={cn('flex flex-col gap-8 [&+&]:border-t [&+&]:border-border [&+&]:pt-8', className)}
    >
      {(title || description) && (
        <header className="-mb-2 flex flex-col gap-1">
          {title && (
            <h2
              id={titleId}
              className="text-[0.8125rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
            >
              {title}
            </h2>
          )}
          {description && <p className="text-label text-muted-foreground">{description}</p>}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * Orientação discreta sob o título. Toda pergunta é obrigatória salvo indicação, então só se
 * marca o que é opcional (padrão do GOV.UK Design System); em múltipla escolha vem o teto e a
 * contagem ("Escolha até 3 · 1 de 3"). Sem nada a dizer, não desenha nada.
 */
export function QuestionMeta({
  optional = false,
  hint,
  live = false,
}: {
  optional?: boolean;
  hint?: string;
  /** Anuncia mudanças (ex.: a contagem "1 de 3") a leitores de tela. */
  live?: boolean;
}) {
  const text = [optional ? 'Opcional' : '', hint ?? ''].filter(Boolean).join(' · ');
  if (!text) return null;
  return (
    <p
      aria-live={live ? 'polite' : undefined}
      className="text-[0.8125rem] leading-[1.125rem] tabular-nums text-muted-foreground"
    >
      {text}
    </p>
  );
}

/**
 * Orientação de uma pergunta de escolha. Escolha única não precisa de texto: o círculo já diz
 * "uma opção".
 */
export function selectionHint(multi: boolean, max?: number, count = 0): string {
  if (!multi) return '';
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
    <p id={id} data-field-help="" className="text-label text-muted-foreground">
      {children}
    </p>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className={cn(
        'flex items-start gap-2 text-label font-medium text-foreground',
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-200',
      )}
    >
      <CircleAlert
        aria-hidden="true"
        strokeWidth={2.25}
        className="mt-px size-4 shrink-0 text-coral"
      />
      <span>{message}</span>
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
const UNSAFE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g;

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
      className={INPUT_CLASS_NAME}
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
    <div className="flex flex-col gap-1.5">
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(stripUnsafeChars(e.target.value))}
        maxLength={maxLength}
        rows={rows}
        aria-describedby={maxLength ? `${id}-count` : undefined}
        className={cn(INPUT_CLASS_NAME, 'h-auto min-h-28 resize-y py-3 leading-relaxed')}
      />
      {maxLength && (
        <p
          id={`${id}-count`}
          className="text-right text-[0.75rem] leading-4 tabular-nums text-muted-foreground"
        >
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

/**
 * Indicador de seleção, sempre à esquerda da opção: círculo com ponto para escolha única,
 * quadrado com check para múltipla.
 */
export function SelectionIndicator({
  selected,
  multi = false,
  className,
}: {
  selected: boolean;
  multi?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-indicator={multi ? 'check' : 'radio'}
      data-state={selected ? 'checked' : 'unchecked'}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center border-[1.5px] transition-colors duration-150',
        multi ? 'rounded-md' : 'rounded-full',
        selected
          ? multi
            ? 'border-petroleo bg-petroleo'
            : 'border-petroleo bg-white'
          : 'border-input bg-white',
        className,
      )}
    >
      {multi ? (
        <Check
          strokeWidth={3.25}
          className={cn(
            'size-3.5 text-primary transition-transform duration-150',
            selected ? 'scale-100' : 'scale-0',
          )}
        />
      ) : (
        <span
          className={cn(
            'size-2.5 rounded-full bg-petroleo transition-transform duration-150',
            selected ? 'scale-100' : 'scale-0',
          )}
        />
      )}
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
    chosenItems.length === 0 ? placeholder : chosenItems.map((item) => item.label).join(', ');

  return (
    <fieldset className={cn('min-w-0', REVEAL_CLASS_NAME)}>
      <legend id={legendId} className={QUESTION_TITLE_CLASS_NAME}>
        {legend}
      </legend>
      <div className="mt-0.5">
        <QuestionMeta
          optional={optional}
          hint={selectionHint(multiple, max, chosen.length)}
          live={max !== undefined}
        />
      </div>
      {help && (
        <div className="mt-1.5">
          <FieldHelp id={helpId}>{help}</FieldHelp>
        </div>
      )}
      <div ref={rootRef} className="relative mt-3">
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
          className={cn(
            'flex min-h-[52px] w-full items-center gap-3 rounded-xl border border-input bg-white px-4 py-2.5 text-left text-body text-foreground outline-none',
            'transition-[border-color,box-shadow] duration-150 hover:border-petroleo/60',
            'focus-visible:border-petroleo focus-visible:ring-[3px] focus-visible:ring-primary/40',
            'disabled:cursor-not-allowed disabled:bg-nevoa disabled:hover:border-input',
            open && 'border-petroleo ring-[3px] ring-primary/40',
          )}
        >
          <span
            className={cn(
              'min-w-0 flex-1 truncate',
              chosenItems.length === 0 ? 'text-muted-foreground' : 'font-medium',
            )}
          >
            {triggerText}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-[18px] shrink-0 text-petroleo transition-transform duration-200',
              open && 'rotate-180',
              disabled && 'text-muted-foreground',
            )}
          />
        </button>

        {open && (
          <div
            id={listboxId}
            role="listbox"
            aria-labelledby={legendId}
            aria-multiselectable={multiple || undefined}
            className={cn(
              'absolute inset-x-0 top-full z-40 mt-2 max-h-80 w-full origin-top overflow-y-auto overscroll-contain rounded-2xl border border-border bg-white p-1.5',
              'shadow-[0_18px_40px_-16px_rgba(6,48,42,0.28),0_2px_6px_rgba(6,48,42,0.06)]',
              'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-[0.98] motion-safe:duration-150',
            )}
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
                  aria-labelledby={item.description ? `${listboxId}-${index}` : undefined}
                  aria-describedby={
                    item.description ? `${listboxId}-${index}-description` : undefined
                  }
                  tabIndex={-1}
                  onClick={() => selectOption(item)}
                  onKeyDown={(event) => handleOptionKeyDown(event, index)}
                  className={cn(
                    'flex min-h-[52px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-body text-foreground outline-none transition-colors duration-100',
                    'hover:bg-nevoa focus-visible:bg-nevoa focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    isChosen && 'bg-accent font-medium text-petroleo hover:bg-accent',
                    isBlocked && 'cursor-not-allowed opacity-50 hover:bg-transparent',
                  )}
                >
                  {multiple && <SelectionIndicator selected={isChosen} multi />}
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span id={`${listboxId}-${index}`}>{item.label}</span>
                    {item.description && (
                      <span
                        id={`${listboxId}-${index}-description`}
                        className="text-label font-normal text-muted-foreground"
                      >
                        {item.description}
                      </span>
                    )}
                  </span>
                  {!multiple && (
                    <Check
                      aria-hidden="true"
                      strokeWidth={2.75}
                      className={cn('size-4 shrink-0 text-petroleo', !isChosen && 'invisible')}
                    />
                  )}
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
  /** Duas colunas. */
  | 'grid'
  /** Duas colunas no celular e três a partir de `sm`. */
  | 'columns'
  /** Lista vertical, uma opção abaixo da outra. */
  | 'stack';

const LAYOUT_CLASS: Record<ChoiceLayout, string> = {
  // `auto-rows-fr`: no mobile os rótulos quebram em 2 linhas e cada linha do grid
  // ganhava uma altura diferente. Iguala todas as linhas à mais alta do grupo.
  grid: 'grid auto-rows-fr grid-cols-2 gap-2.5',
  columns: 'grid auto-rows-fr grid-cols-2 gap-2.5 sm:grid-cols-3',
  stack: 'grid grid-cols-1 gap-2.5',
};

/**
 * Sem `layout` explícito, rótulos longos ou com descrição vão em lista: em duas colunas, numa
 * tela de 360px, sobram ~12 caracteres por linha e a opção vira um bloco de três linhas.
 */
const LONG_LABEL = 18;

function autoLayout(items: readonly ChoiceItem<string>[]): ChoiceLayout {
  return items.some((item) => item.description || item.label.length > LONG_LABEL)
    ? 'stack'
    : 'grid';
}

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
  layout,
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
  /** Sem valor, escolhe sozinho entre duas colunas e lista conforme o tamanho dos rótulos. */
  layout?: ChoiceLayout;
}) {
  const legendId = React.useId();
  const optionId = React.useId();
  const optionsRef = React.useRef<HTMLDivElement>(null);
  const atLimit = multi && max !== undefined && selected.length >= max;

  /** Setas movem o foco entre as opções, como num grupo de rádios nativo. */
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const options = Array.from(
      optionsRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [],
    );
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    event.preventDefault();
    const last = options.length - 1;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : event.key === 'ArrowDown' || event.key === 'ArrowRight'
            ? Math.min(index + 1, last)
            : Math.max(index - 1, 0);
    options[next]?.focus();
  }

  return (
    <fieldset className={cn('min-w-0', REVEAL_CLASS_NAME)}>
      {legend && (
        <>
          <legend id={legendId} className={QUESTION_TITLE_CLASS_NAME}>
            {legend}
          </legend>
          <div className="mt-0.5">
            <QuestionMeta
              optional={optional}
              hint={selectionHint(multi, max, selected.length)}
              live={max !== undefined}
            />
          </div>
        </>
      )}
      {help && (
        <div className="mt-1.5">
          <FieldHelp>{help}</FieldHelp>
        </div>
      )}
      <div
        ref={optionsRef}
        role={multi ? undefined : 'radiogroup'}
        aria-labelledby={!multi && legend ? legendId : undefined}
        onKeyDown={handleKeyDown}
        className={cn(LAYOUT_CLASS[layout ?? autoLayout(items)], legend || help ? 'mt-3' : '')}
      >
        {items.map((item, index) => {
          const isSelected = selected.includes(item.value);
          const labelId = `${optionId}-${index}`;
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
              aria-labelledby={item.description ? labelId : undefined}
              aria-describedby={item.description ? `${labelId}-description` : undefined}
              onClick={() => !isDisabled && onToggle(item.value)}
              className={cn(
                'flex min-h-[52px] w-full justify-start gap-3 rounded-xl border px-4 py-3 text-left text-body font-medium outline-none',
                // Com descrição, o indicador acompanha a primeira linha em vez do meio do bloco.
                item.description ? 'items-start' : 'items-center',
                'transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-white',
                isSelected
                  ? 'border-petroleo bg-accent text-petroleo shadow-[inset_0_0_0_1px_var(--petroleo-vivo)]'
                  : 'border-border bg-white text-foreground shadow-[0_1px_2px_rgba(6,48,42,0.05)] hover:border-input hover:bg-nevoa',
                isDisabled
                  ? 'cursor-not-allowed opacity-50 hover:border-border hover:bg-white'
                  : 'motion-safe:active:scale-[0.985]',
              )}
            >
              <SelectionIndicator
                selected={isSelected}
                multi={multi}
                className={item.description ? 'mt-0.5' : undefined}
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span id={labelId}>{item.label}</span>
                {item.description && (
                  <span
                    id={`${labelId}-description`}
                    className="text-label font-normal text-muted-foreground"
                  >
                    {item.description}
                  </span>
                )}
              </span>
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
      layout="grid"
    />
  );
}

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
        className={cn(INPUT_CLASS_NAME, 'tabular-nums')}
      />
      {value !== '' && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-4 flex items-center whitespace-pre text-body tabular-nums text-foreground"
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
      className={cn(INPUT_CLASS_NAME, 'tabular-nums')}
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
      className={cn(INPUT_CLASS_NAME, 'tabular-nums')}
    />
  );
}

/**
 * Caixa de confirmação em cartão: o cartão inteiro é o rótulo (alvo grande), e o quadrado segue
 * o mesmo desenho do check das escolhas múltiplas.
 */
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
    <label
      htmlFor={id}
      className={cn(
        'flex min-h-[52px] cursor-pointer items-start gap-3 rounded-xl border bg-white px-4 py-3.5 text-body text-foreground transition-colors duration-150',
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-white',
        checked
          ? 'border-petroleo bg-accent/50'
          : 'border-border hover:border-input hover:bg-nevoa',
      )}
    >
      <span className="relative mt-0.5 flex size-5 shrink-0">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          required={required}
          className="peer size-5 cursor-pointer appearance-none rounded-md border-[1.5px] border-input bg-white outline-none transition-colors duration-150 checked:border-petroleo checked:bg-petroleo"
        />
        <Check
          aria-hidden="true"
          strokeWidth={3.25}
          className="pointer-events-none absolute inset-0 m-auto size-3.5 scale-0 text-primary transition-transform duration-150 peer-checked:scale-100"
        />
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}
