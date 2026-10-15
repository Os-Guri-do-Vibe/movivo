'use client';

/**
 * Campo de exercício com autocomplete do catálogo oficial (achado 2026-10-15, produção).
 *
 * O editor de protocolo tinha um campo de nome em texto livre: o RT digitou "Abdominal na
 * Prancha", o item virou `manual-<uuid>` e a assinatura recusou "exercício fora da base". Aqui
 * o nome só muda por SELEÇÃO de um exercício publicado — a seleção grava o `exerciseId`
 * oficial e o nome com a grafia do catálogo. Texto digitado sem selecionar fica pendente
 * (`onPendingChange`) e o editor não salva até o profissional escolher uma opção; Esc
 * devolve a escolha atual, nunca a sobrescreve em silêncio.
 *
 * A busca é por termo no servidor (`searchCatalog`): "abdominal prancha" encontra "Prancha" e
 * os abdominais. Debounce + cancelamento da requisição anterior evitam rajadas.
 */
import { Loader2, Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { DashboardApiError, searchExerciseCatalog } from '@/lib/dashboard-api';
import type { ExerciseCatalogOption } from '@/lib/dashboard-types';
import { cn } from '@/lib/utils';

export const CATALOG_SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

const PATTERN_LABELS: Record<string, string> = {
  HORIZONTAL_PUSH: 'Empurrar horizontal',
  VERTICAL_PUSH: 'Empurrar vertical',
  HORIZONTAL_PULL: 'Puxar horizontal',
  VERTICAL_PULL: 'Puxar vertical',
  SQUAT: 'Agachar',
  HINGE: 'Dobradiça de quadril',
  LUNGE: 'Avanço',
  CORE: 'Core',
  CARDIO: 'Cardio',
  ISOLATION: 'Isolado',
};

/** Id que nunca foi escolhido no catálogo: item novo do editor ou legado digitado à mão. */
export function isUnlinkedExerciseId(exerciseId: string): boolean {
  return exerciseId.startsWith('pending-') || exerciseId.startsWith('manual-');
}

function optionDetails(option: ExerciseCatalogOption): string {
  return [
    PATTERN_LABELS[option.pattern] ?? option.pattern,
    option.muscleGroups.join(', '),
    option.equipment.length ? option.equipment.join(', ') : 'sem equipamento',
    option.measurement === 'DURATION' ? 'por tempo' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function ExerciseCatalogPicker({
  exerciseId,
  name,
  protocolId,
  onSelect,
  onPendingChange,
}: {
  exerciseId: string;
  name: string;
  /** Protocolo em edição — a busca marca o que é contraindicado para este aluno. */
  protocolId: string;
  onSelect: (option: ExerciseCatalogOption) => void;
  /** `true` enquanto há texto digitado que não virou seleção (o editor bloqueia o salvar). */
  onPendingChange: (pending: boolean) => void;
}) {
  const listboxId = useId();
  const hintId = useId();
  const [text, setText] = useState(name);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ExerciseCatalogOption[]>([]);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState('');
  const unlinked = isUnlinkedExerciseId(exerciseId) || !name.trim();
  const pending = text.trim() !== name.trim();
  // Item fora do catálogo abre a busca com o próprio texto: "Abdominal na Prancha" já mostra
  // "Prancha" e os abdominais ao focar, sem precisar redigitar.
  const searchable = pending || unlinked;

  // A escolha vigente veio de fora (seleção, cancelar edição, recarregar): o campo a reflete.
  useEffect(() => {
    setText(name);
  }, [exerciseId, name]);

  const onPendingChangeRef = useRef(onPendingChange);
  onPendingChangeRef.current = onPendingChange;
  useEffect(() => {
    onPendingChangeRef.current(pending);
  }, [pending]);
  useEffect(() => () => onPendingChangeRef.current(false), []);

  const query = text.trim();
  useEffect(() => {
    if (!open || !searchable || query.length < MIN_QUERY_LENGTH) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      searchExerciseCatalog(query, { protocolId, signal: controller.signal })
        .then((found) => {
          setOptions(found);
          setActive(found.length ? 0 : -1);
          setSearched(query);
          setError('');
        })
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === 'AbortError') return;
          setOptions([]);
          setError(
            caught instanceof DashboardApiError
              ? caught.message
              : 'Não foi possível buscar no catálogo.',
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, CATALOG_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, searchable, protocolId, query]);

  function choose(option: ExerciseCatalogOption) {
    onSelect(option);
    setText(option.name);
    setOpen(false);
    setOptions([]);
  }

  function revert() {
    setText(name);
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      revert();
      return;
    }
    if (!open || options.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[active];
      if (option) choose(option);
    }
  }

  const showList = open && searchable && query.length >= MIN_QUERY_LENGTH;
  const settled = !loading && searched === query;
  const activeId = active >= 0 ? `${listboxId}-${active}` : undefined;

  return (
    <div className="relative min-w-0">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="text"
          role="combobox"
          aria-label="Exercício do catálogo"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listboxId}
          aria-activedescendant={showList ? activeId : undefined}
          aria-describedby={hintId}
          aria-invalid={unlinked || pending}
          autoComplete="off"
          maxLength={80}
          value={text}
          placeholder="Busque o exercício no catálogo"
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (searchable) setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={handleKeyDown}
          className={cn(
            'h-11 w-full rounded-xl border border-input bg-background pr-9 pl-9 text-label font-medium text-foreground outline-none placeholder:text-muted-foreground',
            'transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring',
            (unlinked || pending) && 'border-coral',
          )}
        />
        {loading ? (
          <Loader2
            aria-hidden="true"
            className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
          />
        ) : null}
      </div>

      {showList ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Exercícios do catálogo"
          className="absolute inset-x-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-lg"
        >
          {error ? (
            <p role="alert" className="px-3 py-2 text-label text-destructive">
              {error}
            </p>
          ) : settled && options.length === 0 ? (
            <p className="px-3 py-2 text-label text-muted-foreground">
              Nenhum exercício encontrado para “{query}”. Ajuste a busca: use outra palavra ou parte
              do nome.
            </p>
          ) : (
            options.map((option, index) => (
              <div
                key={option.id}
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={index === active}
                // `mousedown` (não `click`) e sem roubar o foco: o `blur` do campo fecharia a
                // lista antes do clique chegar.
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(option);
                }}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  'flex min-h-11 cursor-pointer flex-col justify-center rounded-lg px-3 py-1.5 text-left text-popover-foreground',
                  index === active && 'bg-accent text-accent-foreground',
                )}
              >
                <span className="text-label font-semibold">{option.name}</span>
                <span className="text-xs text-muted-foreground">{optionDetails(option)}</span>
              </div>
            ))
          )}
        </div>
      ) : null}

      <p id={hintId} className="mt-1 text-xs">
        {pending ? (
          <span className="text-coral">
            {query.length < MIN_QUERY_LENGTH
              ? 'Digite ao menos 2 letras e escolha um exercício da lista.'
              : 'Escolha um exercício da lista para confirmar. Esc mantém o atual.'}
          </span>
        ) : unlinked ? (
          <span className="text-coral">
            Exercício fora do catálogo. Busque e selecione uma opção oficial antes de salvar.
          </span>
        ) : (
          <span className="text-muted-foreground">Exercício do catálogo oficial.</span>
        )}
      </p>
    </div>
  );
}
