'use client';

/**
 * Escolher um exercício DO CATÁLOGO (nunca texto livre) para adicionar ou trocar na edição do
 * protocolo. A lista já vem do servidor só com o que é seguro e viável para este aluno (local,
 * nível, contraindicações, rejeições); aqui só se busca por nome e se filtra por grupo muscular
 * e equipamento. O que já está na sessão aparece desabilitado.
 */
import { Search, Timer } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { equipmentLabel, muscleLabel } from '@/lib/protocol-format';
import {
  catalogFacets,
  filterCatalog,
  type CatalogFilter,
  type CatalogOption,
} from '@/lib/protocol-edit';
import { cn } from '@/lib/utils';

import { CONTROL_H, FIELD_SELECT, FILTER_LABEL, FOCUS_RING } from './control-center-table';

const MAX_RESULTS = 80;
const EMPTY: CatalogFilter = { query: '', muscle: '', equipment: '' };

export function ExercisePicker({
  open,
  onOpenChange,
  title,
  description,
  options,
  excludeIds = [],
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  options: readonly CatalogOption[];
  /** Ids que já estão na sessão (aparecem desabilitados). */
  excludeIds?: readonly string[];
  onSelect: (option: CatalogOption) => void;
}) {
  const [filter, setFilter] = useState<CatalogFilter>(EMPTY);
  const searchId = useId();
  const muscleId = useId();
  const equipmentId = useId();
  const countId = useId();
  const facets = useMemo(() => catalogFacets(options), [options]);
  const results = useMemo(() => filterCatalog(options, filter), [options, filter]);
  const shown = results.slice(0, MAX_RESULTS);
  const filtered = filter.query !== '' || filter.muscle !== '' || filter.equipment !== '';
  const taken = new Set(excludeIds);

  const close = (next: boolean) => {
    if (!next) setFilter(EMPTY);
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[min(44rem,calc(100dvh-2rem))] w-[calc(100%-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border p-5 pr-14">
          <DialogTitle className="text-h3 font-semibold">{title}</DialogTitle>
          <DialogDescription>
            {description ??
              'Só aparecem exercícios do catálogo publicado que são seguros e viáveis para este aluno.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 border-b border-border p-5 sm:grid-cols-[minmax(0,1fr)_11rem_11rem]">
          <div className="grid gap-1">
            <label htmlFor={searchId} className={FILTER_LABEL}>
              Buscar
            </label>
            <div
              className={cn(
                CONTROL_H,
                'flex items-center gap-2 rounded-md border border-input bg-card px-3 focus-within:ring-[3px] focus-within:ring-ring',
              )}
            >
              <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <input
                id={searchId}
                type="search"
                autoFocus
                autoComplete="off"
                placeholder="Nome, músculo ou equipamento"
                value={filter.query}
                aria-describedby={countId}
                onChange={(event) => setFilter({ ...filter, query: event.target.value })}
                className="h-full min-w-0 flex-1 bg-transparent text-label text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>
          <div className="grid gap-1">
            <label htmlFor={muscleId} className={FILTER_LABEL}>
              Grupo muscular
            </label>
            <select
              id={muscleId}
              value={filter.muscle}
              onChange={(event) => setFilter({ ...filter, muscle: event.target.value })}
              className={cn(FIELD_SELECT, CONTROL_H, FOCUS_RING)}
            >
              <option value="">Todos</option>
              {facets.muscles.map((facet) => (
                <option key={facet.value} value={facet.value}>
                  {facet.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <label htmlFor={equipmentId} className={FILTER_LABEL}>
              Equipamento
            </label>
            <select
              id={equipmentId}
              value={filter.equipment}
              onChange={(event) => setFilter({ ...filter, equipment: event.target.value })}
              className={cn(FIELD_SELECT, CONTROL_H, FOCUS_RING)}
            >
              <option value="">Todos</option>
              {facets.equipment.map((facet) => (
                <option key={facet.value} value={facet.value}>
                  {facet.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p
          id={countId}
          role="status"
          className="px-5 pt-3 text-xs text-muted-foreground tabular-nums"
        >
          {results.length === 0
            ? 'Nenhum exercício encontrado'
            : results.length === 1
              ? '1 exercício'
              : `${results.length} exercícios`}
          {results.length > MAX_RESULTS ? ` · mostrando ${MAX_RESULTS}, refine a busca` : ''}
        </p>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-3">
          {shown.length === 0 ? (
            <div className="px-2 py-10 text-center">
              <p className="text-label text-muted-foreground">
                Nenhum exercício do catálogo com esses filtros.
              </p>
              {filtered ? (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3"
                  onClick={() => setFilter(EMPTY)}
                >
                  Limpar filtros
                </Button>
              ) : null}
            </div>
          ) : (
            <ul aria-label="Exercícios do catálogo" className="space-y-1">
              {shown.map((option) => {
                const inSession = taken.has(option.id);
                return (
                  <li key={option.id}>
                    <button
                      type="button"
                      disabled={inSession}
                      onClick={() => {
                        onSelect(option);
                        close(false);
                      }}
                      className={cn(
                        FOCUS_RING,
                        'grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-label font-medium">{option.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {muscleLabel(option.muscleGroups)} · {equipmentLabel(option.equipment)}
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {inSession ? (
                          'Já está na sessão'
                        ) : option.measurement === 'DURATION' ? (
                          <span className="inline-flex items-center gap-1">
                            <Timer aria-hidden="true" className="size-3.5" />
                            Por tempo
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
