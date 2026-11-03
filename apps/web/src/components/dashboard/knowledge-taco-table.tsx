'use client';

/**
 * Conferência da TACO importada: todos os alimentos da base numa tabela que se busca, filtra por
 * categoria e ordena por qualquer coluna. Os macros ficam sempre à vista; os micronutrientes entram
 * por um botão, para a tabela não virar uma faixa de 17 colunas.
 *
 * Responde à largura do PRÓPRIO painel: a partir de `@2xl` é uma tabela (com o nome do alimento
 * fixo na rolagem horizontal); abaixo disso, cada alimento vira um cartão com os mesmos números.
 */
import { Columns3, Search } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import type { TacoCatalogFood } from '@movivo/shared';

import { Button } from '@/components/ui/button';
import { getTacoFoods } from '@/lib/control-center-api';
import { cn } from '@/lib/utils';

import {
  CONTROL_H,
  FOCUS_RING,
  ResultCount,
  SortableTh,
  TD,
  TD_NUM,
  THEAD_ROW,
  TableEmptyRow,
  TablePagination,
  TableScroll,
  type SortDirection,
} from './control-center-table';
import { ResourceState, useControlCenterResource } from './control-center-ui';

const PAGE_SIZE = 25;
const NO_VALUE = '—';

const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

interface Column {
  key: string;
  label: string;
  /** Rótulo curto dos cartões, onde não há cabeçalho de coluna. */
  short: string;
  value: (food: TacoCatalogFood) => number | null;
}

const MACROS: readonly Column[] = [
  { key: 'energyKcal', label: 'Energia (kcal)', short: 'kcal', value: (f) => f.per100g.energyKcal },
  { key: 'proteinG', label: 'Proteína (g)', short: 'Prot.', value: (f) => f.per100g.proteinG },
  { key: 'fatG', label: 'Lipídeos (g)', short: 'Lip.', value: (f) => f.per100g.fatG },
  { key: 'carbsG', label: 'Carboidrato (g)', short: 'Carb.', value: (f) => f.per100g.carbsG },
  { key: 'fiberG', label: 'Fibra (g)', short: 'Fibra', value: (f) => f.per100g.fiberG },
];

const micro = (key: string, label: string, short: string): Column => ({
  key,
  label,
  short,
  value: (food) => food.per100g.micros[key] ?? null,
});

const MICROS: readonly Column[] = [
  micro('calcium_mg', 'Cálcio (mg)', 'Cálcio'),
  micro('magnesium_mg', 'Magnésio (mg)', 'Magnésio'),
  micro('iron_mg', 'Ferro (mg)', 'Ferro'),
  micro('sodium_mg', 'Sódio (mg)', 'Sódio'),
  micro('potassium_mg', 'Potássio (mg)', 'Potássio'),
  micro('zinc_mg', 'Zinco (mg)', 'Zinco'),
  micro('vitamin_c_mg', 'Vitamina C (mg)', 'Vit. C'),
  micro('cholesterol_mg', 'Colesterol (mg)', 'Colesterol'),
];

function plain(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');
}

function format(value: number | null): string {
  return value === null ? NO_VALUE : number.format(value);
}

interface Sort {
  key: string;
  direction: SortDirection;
}

function sortFoods(foods: readonly TacoCatalogFood[], sort: Sort, columns: readonly Column[]) {
  const sign = sort.direction === 'asc' ? 1 : -1;
  const column = columns.find((candidate) => candidate.key === sort.key);
  return [...foods].sort((a, b) => {
    if (sort.key === 'code') return sign * a.code.localeCompare(b.code, 'pt-BR', { numeric: true });
    if (!column) {
      const key = sort.key === 'category' ? 'category' : 'name';
      return sign * a[key].localeCompare(b[key], 'pt-BR');
    }
    const x = column.value(a);
    const y = column.value(b);
    // "Não analisado" fica sempre no fim, qualquer que seja o sentido da ordenação.
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return sign * (x - y);
  });
}

const STICKY = 'sticky left-0 z-10 bg-card';

/** Selo de um complemento: valores de outra fonte, não da TACO. */
function OriginBadge({ origin }: { origin: string }) {
  return (
    <span
      title={`Complemento: valores de ${origin}, não da TACO`}
      className="ml-2 inline-flex h-5 items-center rounded-full border border-border bg-secondary px-2 align-middle text-[11px] font-medium whitespace-nowrap text-secondary-foreground"
    >
      {origin}
    </span>
  );
}

/** Ordenação dos cartões (sem cabeçalho de coluna): o essencial, com o sentido que mais ajuda. */
const SORT_OPTIONS: ReadonlyArray<{ key: string; label: string; direction: SortDirection }> = [
  { key: 'code', label: 'Ordem da tabela', direction: 'asc' },
  { key: 'name', label: 'Nome (A–Z)', direction: 'asc' },
  { key: 'energyKcal', label: 'Mais calóricos', direction: 'desc' },
  { key: 'proteinG', label: 'Mais proteína', direction: 'desc' },
  { key: 'fatG', label: 'Mais lipídeos', direction: 'desc' },
  { key: 'carbsG', label: 'Mais carboidrato', direction: 'desc' },
];

export function TacoFoodsTable() {
  const load = useCallback((signal?: AbortSignal) => getTacoFoods(signal), []);
  const { data, error, forbidden, loading, refresh } = useControlCenterResource(load);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [micros, setMicros] = useState(false);
  const [sort, setSort] = useState<Sort>({ key: 'code', direction: 'asc' });
  const [page, setPage] = useState(1);

  const foods = useMemo(() => data?.data.foods ?? [], [data]);
  const columns = useMemo(() => (micros ? [...MACROS, ...MICROS] : MACROS), [micros]);
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const food of foods) counts.set(food.category, (counts.get(food.category) ?? 0) + 1);
    return [...counts].sort(([a], [b]) => a.localeCompare(b, 'pt-BR'));
  }, [foods]);

  const rows = useMemo(() => {
    const needle = plain(query.trim());
    const filtered = foods.filter(
      (food) =>
        (!category || food.category === category) &&
        (!needle || plain(`${food.name} ${food.code}`).includes(needle)),
    );
    return sortFoods(filtered, sort, [...MACROS, ...MICROS]);
  }, [foods, query, category, sort]);

  if (!data) {
    return (
      <ResourceState
        loading={loading}
        error={error}
        forbidden={forbidden}
        onRetry={() => void refresh()}
      />
    );
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const first = (current - 1) * PAGE_SIZE;
  const visible = rows.slice(first, first + PAGE_SIZE);
  const filtered = Boolean(query.trim() || category);

  function sortBy(key: string, numeric: boolean) {
    setPage(1);
    setSort((previous) =>
      previous.key === key
        ? { key, direction: previous.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: numeric ? 'desc' : 'asc' },
    );
  }

  const header = (key: string, label: string, numeric: boolean, className?: string) => (
    <SortableTh
      key={key}
      label={label}
      active={sort.key === key}
      direction={sort.direction}
      onSort={() => sortBy(key, numeric)}
      className={className}
    />
  );

  return (
    <section aria-labelledby="taco-foods-title" className="@container">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="taco-foods-title" className="text-label font-semibold">
          Alimentos importados
        </h3>
        <p className="text-xs text-muted-foreground">
          Composição por 100 g de parte comestível. “—” é não analisado.
          {foods.some((food) => food.origin)
            ? ' Itens com selo são complementos de outra fonte, não da TACO.'
            : ''}
        </p>
      </div>

      <div className="mt-3 rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <label className="relative block min-w-52 grow basis-full @xl:basis-0">
            <span className="sr-only">Buscar alimento</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Buscar por nome ou número"
              className={cn(
                'w-full rounded-md border border-input bg-background pr-3 pl-9 text-label',
                CONTROL_H,
                FOCUS_RING,
              )}
            />
          </label>
          <label className="block min-w-0 grow @xl:grow-0">
            <span className="sr-only">Filtrar por categoria</span>
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setPage(1);
              }}
              className={cn(
                'w-full rounded-md border border-input bg-background px-3 text-label @xl:max-w-64',
                CONTROL_H,
                FOCUS_RING,
              )}
            >
              <option value="">Todas as categorias</option>
              {categories.map(([name, count]) => (
                <option key={name} value={name}>
                  {name} ({count})
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0 grow @2xl:hidden">
            <span className="sr-only">Ordenar por</span>
            <select
              value={sort.key}
              onChange={(event) => {
                const key = event.target.value;
                setPage(1);
                setSort({
                  key,
                  direction: SORT_OPTIONS.find((o) => o.key === key)?.direction ?? 'asc',
                });
              }}
              className={cn(
                'w-full rounded-md border border-input bg-background px-3 text-label',
                CONTROL_H,
                FOCUS_RING,
              )}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
              {!SORT_OPTIONS.some((option) => option.key === sort.key) ? (
                <option value={sort.key}>Outra coluna</option>
              ) : null}
            </select>
          </label>
          <Button
            type="button"
            variant={micros ? 'secondary' : 'outline'}
            aria-pressed={micros}
            className={CONTROL_H}
            onClick={() => setMicros((previous) => !previous)}
          >
            <Columns3 aria-hidden="true" />
            Micronutrientes
          </Button>
        </div>

        <div className="hidden @2xl:block">
          <TableScroll label="Tabela de alimentos da TACO">
            <table className="w-full text-label">
              <caption className="sr-only">Alimentos da TACO importados, por 100 g</caption>
              <thead>
                <tr className={THEAD_ROW}>
                  {header('code', 'Nº', false)}
                  {header('name', 'Alimento', false, cn(STICKY, 'text-left'))}
                  {header('category', 'Categoria', false)}
                  {columns.map((column) => header(column.key, column.label, true))}
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <TableEmptyRow colSpan={3 + columns.length}>
                    Nenhum alimento encontrado com esses filtros.
                  </TableEmptyRow>
                ) : (
                  visible.map((food) => (
                    <tr
                      key={food.id}
                      className="group divide-x divide-border border-b border-border last:border-b-0"
                    >
                      <td
                        className={cn(
                          TD_NUM,
                          'text-muted-foreground transition-colors group-hover:bg-muted',
                        )}
                      >
                        {food.code}
                      </td>
                      <td
                        className={cn(
                          TD,
                          STICKY,
                          'min-w-64 font-medium transition-colors group-hover:bg-muted',
                        )}
                      >
                        {food.name}
                        {food.origin ? <OriginBadge origin={food.origin} /> : null}
                      </td>
                      <td
                        className={cn(
                          TD,
                          'whitespace-nowrap text-muted-foreground transition-colors group-hover:bg-muted',
                        )}
                      >
                        {food.category}
                      </td>
                      {columns.map((column) => (
                        <td
                          key={column.key}
                          className={cn(TD_NUM, 'transition-colors group-hover:bg-muted')}
                        >
                          {format(column.value(food))}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableScroll>
        </div>

        <div className="@2xl:hidden">
          {visible.length === 0 ? (
            <p className="px-4 py-10 text-center text-label text-muted-foreground">
              Nenhum alimento encontrado com esses filtros.
            </p>
          ) : (
            <ul aria-label="Alimentos da TACO" className="divide-y divide-border">
              {visible.map((food) => (
                <li key={food.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 text-label font-medium break-words">
                      {food.name}
                      {food.origin ? <OriginBadge origin={food.origin} /> : null}
                    </p>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      Nº {food.code}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{food.category}</p>
                  <dl className="mt-2 grid grid-cols-5 gap-2">
                    {MACROS.map((column) => (
                      <div key={column.key} className="min-w-0">
                        <dt className="text-xs text-muted-foreground">{column.short}</dt>
                        <dd className="font-mono text-label tabular-nums">
                          {format(column.value(food))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {micros ? (
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-2">
                      {MICROS.map((column) => (
                        <div key={column.key} className="flex items-baseline justify-between gap-2">
                          <dt className="text-xs text-muted-foreground">{column.short}</dt>
                          <dd className="font-mono text-xs tabular-nums">
                            {format(column.value(food))}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-4 py-2.5">
          <ResultCount
            from={rows.length === 0 ? 0 : first + 1}
            to={first + visible.length}
            total={rows.length}
            noun={filtered ? `alimento(s) filtrado(s)` : 'alimento(s)'}
          />
          {totalPages > 1 ? (
            <TablePagination
              label="Páginas da tabela da TACO"
              page={current}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
