'use client';

import * as React from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';

const MONTHS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
] as const;

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;
const FIRST_YEAR = 1900;

interface CalendarMonth {
  year: number;
  month: number;
}

interface CalendarSelectOption {
  value: number;
  label: string;
  disabled?: boolean;
}

function CalendarSelect({
  id,
  label,
  options,
  value,
  open,
  onOpenChange,
  onChange,
}: {
  id: string;
  label: string;
  options: readonly CalendarSelectOption[];
  value: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: number) => void;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const enabledOptions = options.filter((option) => !option.disabled);
  const selected = options.find((option) => option.value === value) ?? enabledOptions[0];

  React.useEffect(() => {
    if (!open) return;

    function closeOnOutsideClick(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    }

    document.addEventListener('pointerdown', closeOnOutsideClick);
    optionRefs.current[options.findIndex((option) => option.value === value)]?.focus();

    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [onOpenChange, open, options, value]);

  function openWithKeyboard(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    onOpenChange(true);
  }

  function selectOption(option: CalendarSelectOption) {
    if (option.disabled) return;
    onChange(option.value);
    onOpenChange(false);
    triggerRef.current?.focus();
  }

  function handleOptionKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    option: CalendarSelectOption,
    optionIndex: number,
  ) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      triggerRef.current?.focus();
      return;
    }

    if (event.key === 'Tab') {
      onOpenChange(false);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectOption(option);
      return;
    }

    const enabledIndexes = options
      .map((candidate, index) => (!candidate.disabled ? index : -1))
      .filter((index) => index >= 0);
    const currentIndex = enabledIndexes.indexOf(optionIndex);
    let nextIndex: number | undefined;

    if (event.key === 'ArrowDown') {
      nextIndex = enabledIndexes[Math.min(currentIndex + 1, enabledIndexes.length - 1)];
    } else if (event.key === 'ArrowUp') {
      nextIndex = enabledIndexes[Math.max(currentIndex - 1, 0)];
    } else if (event.key === 'Home') {
      nextIndex = enabledIndexes[0];
    } else if (event.key === 'End') {
      nextIndex = enabledIndexes.at(-1);
    }

    if (nextIndex === undefined) return;
    event.preventDefault();
    optionRefs.current[nextIndex]?.focus();
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        id={`${id}-trigger`}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        onClick={() => onOpenChange(!open)}
        onKeyDown={openWithKeyboard}
        className="flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-input bg-nevoa py-2 pl-3 pr-3 text-body font-semibold text-petroleo outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="truncate">{selected?.label}</span>
        <ChevronDown
          aria-hidden="true"
          data-testid={`${id}-chevron`}
          className={cn('mr-1 size-4 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div
          id={`${id}-listbox`}
          role="listbox"
          aria-label={`Opções de ${label}`}
          className="absolute inset-x-0 top-full z-40 mt-2 max-h-64 overflow-y-auto rounded-2xl border border-border bg-nevoa p-1.5 shadow-[0_12px_30px_rgba(6,48,42,0.16)]"
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              type="button"
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              tabIndex={option.value === value ? 0 : -1}
              disabled={option.disabled}
              onClick={() => selectOption(option)}
              onKeyDown={(event) => handleOptionKeyDown(event, option, index)}
              className={cn(
                'flex min-h-[52px] w-full items-center rounded-xl px-3 text-left text-label font-semibold text-petroleo outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35',
                option.value === value && 'bg-verde-pulso hover:bg-verde-pulso',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);

  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
    ? date
    : null;
}

function toIsoDate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatDate(value: string) {
  const date = parseIsoDate(value);
  if (!date) return '';
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

function maskDateInput(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join('/');
}

function parseDisplayDate(value: string, minDate: Date, maxDate: Date | null): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]) - 1;
  const year = Number(match[3]);
  const date = new Date(year, month, day);
  const valid =
    year >= FIRST_YEAR &&
    date.getFullYear() === year &&
    date.getMonth() === month &&
    date.getDate() === day &&
    date >= minDate &&
    (!maxDate || date <= maxDate);

  return valid ? date : null;
}

function initialMonth(value: string, today: Date): CalendarMonth {
  const selected = parseIsoDate(value) ?? today;
  return { year: selected.getFullYear(), month: selected.getMonth() };
}

export function DatePicker({
  id,
  value,
  onChange,
  error = false,
  minDate,
  maxDate,
  autoComplete = 'off',
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error?: boolean;
  minDate?: Date;
  maxDate?: Date | null;
  autoComplete?: string;
}) {
  const [today] = React.useState(() => new Date());
  const lowerDate = minDate ?? new Date(FIRST_YEAR, 0, 1);
  const initialReferenceDate = lowerDate > today ? lowerDate : today;
  const [open, setOpen] = React.useState(false);
  const [openSelect, setOpenSelect] = React.useState<'month' | 'year' | null>(null);
  const [view, setView] = React.useState(() => initialMonth(value, initialReferenceDate));
  const [inputValue, setInputValue] = React.useState(() => formatDate(value));
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const calendarRef = React.useRef<HTMLDivElement>(null);
  const emittedValueRef = React.useRef(value);
  const focusCalendarOnOpenRef = React.useRef(false);
  const suppressOpenOnFocusRef = React.useRef(false);
  const selectedDate = parseIsoDate(value);
  const upperDate = maxDate === undefined ? today : maxDate;
  const firstYear = lowerDate.getFullYear();
  const lastYear = upperDate?.getFullYear() ?? Math.max(today.getFullYear() + 100, view.year);
  const years = React.useMemo(
    () => Array.from({ length: lastYear - firstYear + 1 }, (_, index) => lastYear - index),
    [firstYear, lastYear],
  );
  const monthOptions = MONTHS.map((month, index) => ({
    value: index,
    label: month,
    disabled:
      (view.year === firstYear && index < lowerDate.getMonth()) ||
      (upperDate !== null && view.year === upperDate.getFullYear() && index > upperDate.getMonth()),
  }));
  const yearOptions = years.map((year) => ({ value: year, label: String(year) }));

  React.useEffect(() => {
    if (!open) return;

    function closeOnOutsideClick(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setOpenSelect(null);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      setOpenSelect(null);
      focusInputWithoutOpening();
    }

    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    if (focusCalendarOnOpenRef.current) {
      calendarRef.current?.querySelector<HTMLElement>('[data-selected="true"]')?.focus();
    }
    focusCalendarOnOpenRef.current = false;

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  React.useEffect(() => {
    if (value !== emittedValueRef.current) setInputValue(formatDate(value));
    emittedValueRef.current = value;
    const selected = parseIsoDate(value);
    if (selected) setView({ year: selected.getFullYear(), month: selected.getMonth() });
  }, [value]);

  const firstWeekday = new Date(view.year, view.month, 1).getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const cells = Array.from({ length: firstWeekday + daysInMonth }, (_, index) =>
    index < firstWeekday ? null : index - firstWeekday + 1,
  );
  const isFirstMonth = view.year === firstYear && view.month === lowerDate.getMonth();
  const isLastMonth =
    upperDate !== null &&
    view.year === upperDate.getFullYear() &&
    view.month === upperDate.getMonth();

  function changeMonth(offset: number) {
    const next = new Date(view.year, view.month + offset, 1);
    setView({ year: next.getFullYear(), month: next.getMonth() });
  }

  function selectDay(day: number) {
    const nextValue = toIsoDate(view.year, view.month, day);
    emittedValueRef.current = nextValue;
    setInputValue(formatDate(nextValue));
    onChange(nextValue);
    setOpen(false);
    setOpenSelect(null);
    focusInputWithoutOpening();
  }

  function focusInputWithoutOpening() {
    if (document.activeElement === inputRef.current) return;
    suppressOpenOnFocusRef.current = true;
    inputRef.current?.focus();
  }

  function changeInput(nextInput: string) {
    const maskedValue = maskDateInput(nextInput);
    const date = parseDisplayDate(maskedValue, lowerDate, upperDate);
    const nextValue = date ? toIsoDate(date.getFullYear(), date.getMonth(), date.getDate()) : '';

    setInputValue(maskedValue);
    emittedValueRef.current = nextValue;
    onChange(nextValue);
    if (date) {
      setView({ year: date.getFullYear(), month: date.getMonth() });
      setOpen(false);
      setOpenSelect(null);
    }
  }

  return (
    <div ref={rootRef} className="relative w-full">
      <div
        className={cn(
          'flex h-[52px] w-full overflow-hidden rounded-xl border border-input bg-white transition-colors',
          'focus-within:border-ring focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-white',
          error && 'border-destructive',
        )}
      >
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete={autoComplete}
          maxLength={10}
          placeholder="dd/mm/aaaa"
          value={inputValue}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-invalid={error || undefined}
          aria-controls={`${id}-calendar`}
          onFocus={() => {
            if (suppressOpenOnFocusRef.current) {
              suppressOpenOnFocusRef.current = false;
              return;
            }
            focusCalendarOnOpenRef.current = false;
            setOpen(true);
          }}
          onChange={(event) => changeInput(event.target.value)}
          className="h-full min-w-0 flex-1 bg-white px-4 text-body text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          aria-label="Abrir calendário"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={`${id}-calendar`}
          onClick={() => {
            focusCalendarOnOpenRef.current = !open;
            setOpen((current) => !current);
          }}
          className="flex h-full w-[52px] shrink-0 items-center justify-center text-petroleo outline-none transition-colors hover:bg-secondary"
        >
          <CalendarDays aria-hidden="true" className="size-5" strokeWidth={2} />
        </button>
      </div>

      {open && (
        <div
          id={`${id}-calendar`}
          ref={calendarRef}
          role="dialog"
          aria-label="Escolha uma data"
          className="absolute inset-x-0 top-full z-30 mt-2 w-full rounded-2xl border border-border bg-white p-3 text-foreground shadow-[0_12px_30px_rgba(6,48,42,0.12)] sm:p-4"
        >
          <div className="grid grid-cols-[44px_minmax(0,1fr)_104px_44px] items-center gap-2">
            <button
              type="button"
              aria-label="Mês anterior"
              disabled={isFirstMonth}
              onClick={() => changeMonth(-1)}
              className="flex size-11 items-center justify-center rounded-xl border border-border text-petroleo transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35"
            >
              <ChevronLeft aria-hidden="true" className="size-5" />
            </button>

            <CalendarSelect
              id={`${id}-month`}
              label="Mês"
              options={monthOptions}
              value={view.month}
              open={openSelect === 'month'}
              onOpenChange={(selectOpen) => setOpenSelect(selectOpen ? 'month' : null)}
              onChange={(month) => setView({ ...view, month })}
            />

            <CalendarSelect
              id={`${id}-year`}
              label="Ano"
              options={yearOptions}
              value={view.year}
              open={openSelect === 'year'}
              onOpenChange={(selectOpen) => setOpenSelect(selectOpen ? 'year' : null)}
              onChange={(year) => {
                let month = view.month;
                if (year === firstYear) month = Math.max(month, lowerDate.getMonth());
                if (upperDate !== null && year === upperDate.getFullYear()) {
                  month = Math.min(month, upperDate.getMonth());
                }
                setView({ year, month });
              }}
            />

            <button
              type="button"
              aria-label="Próximo mês"
              disabled={isLastMonth}
              onClick={() => changeMonth(1)}
              className="flex size-11 items-center justify-center rounded-xl border border-border text-petroleo transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35"
            >
              <ChevronRight aria-hidden="true" className="size-5" />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-7 text-center">
            {WEEKDAYS.map((weekday) => (
              <span
                key={weekday}
                className="py-1 font-mono text-label font-semibold text-muted-foreground"
              >
                {weekday}
              </span>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 place-items-center">
            {cells.map((day, index) => {
              if (day === null) return <span key={`empty-${index}`} aria-hidden="true" />;

              const isoDate = toIsoDate(view.year, view.month, day);
              const selected = selectedDate ? isoDate === value : false;
              const beforeLowerBound = new Date(view.year, view.month, day) < lowerDate;
              const afterUpperBound =
                upperDate !== null && new Date(view.year, view.month, day) > upperDate;

              return (
                <button
                  key={isoDate}
                  type="button"
                  data-selected={selected}
                  aria-label={`${day} de ${MONTHS[view.month]} de ${view.year}`}
                  aria-pressed={selected}
                  disabled={beforeLowerBound || afterUpperBound}
                  onClick={() => selectDay(day)}
                  className={cn(
                    'flex aspect-square w-full items-center justify-center rounded-xl text-body font-medium text-foreground outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring disabled:text-muted-foreground/35',
                    selected && 'bg-primary font-bold text-primary-foreground hover:bg-primary',
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
