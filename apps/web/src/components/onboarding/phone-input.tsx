'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';

import {
  getPhoneCountry,
  maskNationalPhone,
  SUPPORTED_PHONE_COUNTRIES,
  type PhoneCountryIso,
} from '@/lib/anamnesis-api';
import { cn } from '@/lib/utils';

export function PhoneInput({
  id,
  countryIso,
  value,
  onChange,
  onCountryChange,
}: {
  id: string;
  countryIso: PhoneCountryIso;
  value: string;
  onChange: (value: string) => void;
  onCountryChange: (countryIso: PhoneCountryIso, remaskedValue: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const focusSelectedOnOpenRef = React.useRef(false);
  const country = getPhoneCountry(countryIso);
  const filteredCountries = React.useMemo(() => {
    const normalizedQuery = normalizeSearch(query);
    if (!normalizedQuery) return SUPPORTED_PHONE_COUNTRIES;
    return SUPPORTED_PHONE_COUNTRIES.filter((option) =>
      normalizeSearch(`${option.name} ${option.iso} ${option.callingCode}`).includes(
        normalizedQuery,
      ),
    );
  }, [query]);
  const selectedIndex = filteredCountries.findIndex((item) => item.iso === countryIso);

  React.useEffect(() => {
    if (!open) return;

    function closeOnOutsideClick(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideClick);
    if (focusSelectedOnOpenRef.current) {
      optionRefs.current[Math.max(selectedIndex, 0)]?.focus();
    } else {
      searchRef.current?.focus();
    }
    focusSelectedOnOpenRef.current = false;
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [open, selectedIndex]);

  function closeMenu() {
    setOpen(false);
    setQuery('');
    triggerRef.current?.focus();
  }

  function selectCountry(nextIso: PhoneCountryIso) {
    onCountryChange(nextIso, maskNationalPhone(nextIso, value));
    closeMenu();
  }

  function handleOptionKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
    iso: PhoneCountryIso,
  ) {
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
      selectCountry(iso);
      return;
    }

    let nextIndex: number | undefined;
    if (event.key === 'ArrowDown') {
      nextIndex = Math.min(index + 1, filteredCountries.length - 1);
    } else if (event.key === 'ArrowUp') {
      if (index === 0) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      nextIndex = index - 1;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = filteredCountries.length - 1;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    optionRefs.current[nextIndex]?.focus();
  }

  return (
    <div ref={rootRef} className="relative w-full">
      <div
        data-testid="phone-field"
        className="flex h-[52px] w-full overflow-hidden rounded-xl border border-input bg-white transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-white"
      >
        <button
          ref={triggerRef}
          type="button"
          aria-label={`País e DDI: ${country.name}, ${country.callingCode}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={`${id}-country-listbox`}
          onClick={() => {
            if (open) {
              setOpen(false);
              setQuery('');
              return;
            }
            focusSelectedOnOpenRef.current = false;
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            focusSelectedOnOpenRef.current = true;
            setQuery('');
            setOpen(true);
          }}
          className="flex h-full w-[150px] shrink-0 items-center gap-2 border-r border-input bg-nevoa pl-3 pr-2 text-label font-semibold text-petroleo outline-none transition-colors hover:bg-secondary sm:w-[170px] sm:text-body"
        >
          <span
            className="min-w-0 flex-1 truncate text-left"
            title={`${country.name} ${country.callingCode}`}
          >
            {country.name} {country.callingCode}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'ml-auto mr-1 size-4 shrink-0 transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>

        <input
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder={country.placeholder}
          value={value}
          onChange={(event) => onChange(maskNationalPhone(countryIso, event.target.value))}
          className="h-full min-w-0 flex-1 bg-white px-4 text-body text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 flex max-h-80 w-full flex-col overflow-hidden rounded-2xl border border-border bg-nevoa p-2 shadow-[0_12px_30px_rgba(6,48,42,0.16)]">
          <input
            ref={searchRef}
            type="search"
            aria-label="Buscar país ou DDI"
            placeholder="Buscar país ou DDI"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeMenu();
              } else if (event.key === 'ArrowDown' && filteredCountries.length > 0) {
                event.preventDefault();
                optionRefs.current[Math.max(selectedIndex, 0)]?.focus();
              }
            }}
            className="mb-2 h-[52px] shrink-0 rounded-xl border border-input bg-white px-4 text-body text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div
            id={`${id}-country-listbox`}
            role="listbox"
            aria-label="Países e DDIs disponíveis"
            className="min-h-0 overflow-y-auto"
          >
            {filteredCountries.map((option, index) => (
              <button
                key={option.iso}
                ref={(element) => {
                  optionRefs.current[index] = element;
                }}
                type="button"
                role="option"
                aria-label={`${option.name}, DDI ${option.callingCode}`}
                aria-selected={option.iso === countryIso}
                tabIndex={-1}
                onClick={() => selectCountry(option.iso)}
                onKeyDown={(event) => handleOptionKeyDown(event, index, option.iso)}
                className={cn(
                  'flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-label text-petroleo outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring',
                  option.iso === countryIso && 'bg-verde-pulso hover:bg-verde-pulso',
                )}
              >
                <span className="min-w-0 flex-1 truncate font-semibold">{option.name}</span>
                <span className="shrink-0 font-mono">{option.callingCode}</span>
              </button>
            ))}
            {filteredCountries.length === 0 && (
              <p role="status" className="px-3 py-4 text-center text-label text-muted-foreground">
                Nenhum país encontrado.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
}
