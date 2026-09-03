'use client';

import {
  TRAINING_LOCATION_LABELS,
  trainingLocationSchema,
  type CatalogExerciseCandidate,
  type ExerciseCatalogEntryVersion,
  type ExerciseCatalogResponse,
  type TrainingLocation,
} from '@movivo/shared';
import { Dumbbell, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  ControlCenterApiError,
  getExerciseCatalog,
  publishExerciseCatalogEntry,
  retireExerciseCatalogEntry,
} from '@/lib/control-center-api';
import { cn } from '@/lib/utils';

import {
  CONTROL_H,
  FIELD_BOX,
  FilterBar,
  FilterField,
  FilterFieldset,
  FilterMultiSelect,
  ICON_BUTTON,
  ResultCount,
  TableFooter,
  TablePagination,
} from './control-center-table';
import type { FilterChip } from './control-center-table';
import { ConfirmAction } from './confirm-action';
import { ResourceState, SectorHeader, useControlCenterResource } from './control-center-ui';

const PAGE_SIZE = 50;

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-body focus-visible:ring-[3px] focus-visible:ring-verde-pulso focus-visible:outline-none';

/** Vocabulário hoje em uso no catálogo (`exercise-catalog.ts`) — texto livre no schema,
 *  lista fechada aqui só pra dar um seletor em vez de digitar à mão. */
const MUSCLE_GROUPS = [
  'peito',
  'costas',
  'ombro',
  'bíceps',
  'tríceps',
  'quadríceps',
  'posterior de coxa',
  'glúteo',
  'panturrilha',
  'adutores',
  'core',
  'lombar',
  'sistema cardiovascular',
] as const;

const MUSCLE_FILTER_OPTIONS = MUSCLE_GROUPS.map((muscle) => ({ value: muscle, label: muscle }));
const LOCATION_FILTER_OPTIONS = trainingLocationSchema.options.map((loc) => ({
  value: loc,
  label: TRAINING_LOCATION_LABELS[loc],
}));

interface ExerciseFilters {
  query: string;
  muscleGroups: string[];
  locations: TrainingLocation[];
}

const EMPTY_FILTERS: ExerciseFilters = { query: '', muscleGroups: [], locations: [] };

/**
 * Campos "técnicos" do exercício (padrão de movimento, nível, contraindicações,
 * substitutos, equipamento) — o modal deste painel só edita nome/músculo/local/vídeo
 * (decisão do fundador, achado 2026-09-02). Editar um exercício EXISTENTE preserva esses
 * campos tal como estavam (nunca zera contraindicação de segurança já cadastrada); só um
 * exercício NOVO nasce com os defaults abaixo — mais permissivo, sem restrição marcada.
 */
const DEFAULT_TECHNICAL_FIELDS: Pick<
  CatalogExerciseCandidate,
  'pattern' | 'minLevel' | 'contraindicatedFor' | 'substitutes' | 'equipment'
> = {
  pattern: 'ISOLATION',
  minLevel: 'INICIANTE',
  contraindicatedFor: [],
  substitutes: [],
  equipment: [],
};

function slugifyExerciseName(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 55);
  return base.length >= 3 && /^[a-z]/.test(base) ? base : `exercicio_${base || 'novo'}`;
}

function uniqueExerciseKey(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 100; suffix++) {
    const candidate = `${base}_${suffix}`.slice(0, 60);
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`.slice(0, 60);
}

interface EditableFields {
  name: string;
  muscleGroups: string[];
  locations: TrainingLocation[];
  videoUrl: string;
}

function ExerciseEditorDialog({
  mode,
  existingKeys,
  onClose,
  onSaved,
}: {
  mode: { kind: 'create' } | { kind: 'edit'; entry: ExerciseCatalogEntryVersion };
  existingKeys: ReadonlySet<string>;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isCreate = mode.kind === 'create';
  const [form, setForm] = useState<EditableFields>(() =>
    isCreate
      ? { name: '', muscleGroups: [], locations: [], videoUrl: '' }
      : {
          name: mode.entry.name,
          muscleGroups: mode.entry.muscleGroups,
          locations: mode.entry.locations,
          videoUrl: mode.entry.videoUrl ?? '',
        },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const canSave =
    form.name.trim().length >= 2 && form.muscleGroups.length > 0 && form.locations.length > 0;

  const muscleSummary =
    form.muscleGroups.length > 0 ? form.muscleGroups.join(', ') : 'Selecione o(s) músculo(s)';

  async function save() {
    setSaving(true);
    setError('');
    try {
      const technical = isCreate ? DEFAULT_TECHNICAL_FIELDS : mode.entry;
      const exerciseKey = isCreate
        ? uniqueExerciseKey(slugifyExerciseName(form.name), existingKeys)
        : mode.entry.exerciseKey;
      const candidate: CatalogExerciseCandidate = {
        name: form.name.trim(),
        muscleGroups: form.muscleGroups,
        locations: form.locations,
        videoUrl: form.videoUrl.trim() || undefined,
        pattern: technical.pattern,
        minLevel: technical.minLevel,
        contraindicatedFor: technical.contraindicatedFor,
        substitutes: technical.substitutes,
        equipment: technical.equipment,
      };
      await publishExerciseCatalogEntry({
        exerciseKey,
        ...candidate,
        changeNote: isCreate
          ? 'Criado pelo painel de Exercícios'
          : 'Editado pelo painel de Exercícios',
      });
      onSaved(isCreate ? 'Exercício criado.' : 'Exercício atualizado.');
    } catch (caught) {
      setError(
        caught instanceof ControlCenterApiError
          ? caught.message
          : 'Não foi possível salvar o exercício.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isCreate ? 'Novo exercício' : `Editar “${mode.entry.name}”`}</DialogTitle>
        </DialogHeader>

        {error ? (
          <p role="alert" className="rounded-lg border border-coral bg-card p-3 text-label">
            {error}
          </p>
        ) : null}

        <div className="grid gap-4">
          <label htmlFor="exercise-modal-name" className="text-label font-semibold">
            Nome do exercício
            <input
              id="exercise-modal-name"
              className={INPUT_CLASS}
              value={form.name}
              maxLength={120}
              autoFocus
              onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
            />
          </label>

          <div className="text-label font-semibold">
            Músculo
            <details className="group mt-1 rounded-lg border border-border bg-card">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-body font-normal marker:content-none">
                <span className="truncate text-muted-foreground group-open:text-foreground">
                  {muscleSummary}
                </span>
                <span aria-hidden="true" className="ml-2 text-muted-foreground">
                  ▾
                </span>
              </summary>
              <div className="grid gap-1 border-t border-border p-2">
                {MUSCLE_GROUPS.map((muscle) => {
                  const checked = form.muscleGroups.includes(muscle);
                  return (
                    <label
                      key={muscle}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-label hover:bg-secondary"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setForm((f) => ({
                            ...f,
                            muscleGroups: checked
                              ? f.muscleGroups.filter((m) => m !== muscle)
                              : [...f.muscleGroups, muscle],
                          }))
                        }
                      />
                      {muscle}
                    </label>
                  );
                })}
              </div>
            </details>
          </div>

          <fieldset>
            <legend className="text-label font-semibold">Local disponível</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {trainingLocationSchema.options.map((loc) => {
                const checked = form.locations.includes(loc);
                return (
                  <label
                    key={loc}
                    className={cn(
                      'flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-label',
                      checked ? 'border-verde-pulso bg-accent' : 'border-border bg-card',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setForm((f) => ({
                          ...f,
                          locations: checked
                            ? f.locations.filter((l) => l !== loc)
                            : [...f.locations, loc],
                        }))
                      }
                    />
                    {TRAINING_LOCATION_LABELS[loc]}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <label htmlFor="exercise-modal-video" className="text-label font-semibold">
            Link do vídeo de execução (opcional)
            <input
              id="exercise-modal-video"
              type="url"
              className={INPUT_CLASS}
              value={form.videoUrl}
              maxLength={500}
              placeholder="https://…"
              onChange={(event) => setForm((f) => ({ ...f, videoUrl: event.target.value }))}
            />
          </label>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button disabled={!canSave || saving} onClick={() => void save()}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AiExerciseCatalogDashboard({ canWrite = false }: { canWrite?: boolean }) {
  const { data, error, forbidden, loading, refresh } =
    useControlCenterResource<ExerciseCatalogResponse>(getExerciseCatalog);
  const [modal, setModal] = useState<
    { kind: 'create' } | { kind: 'edit'; entry: ExerciseCatalogEntryVersion } | null
  >(null);
  const [feedback, setFeedback] = useState('');
  const [retiringKey, setRetiringKey] = useState<string | null>(null);
  // `form` é o rascunho editado nos campos; `applied` só muda ao clicar "Buscar" (ou
  // "Limpar filtro"/remover um chip, que sincronizam os dois) — mesmo padrão da Base de
  // Alunos (`StudentsDashboard`).
  const [form, setForm] = useState<ExerciseFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<ExerciseFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);

  const versions = useMemo(() => data?.data.versions ?? [], [data]);
  // "Se excluir, deve ser removido da lista" — só a linha PUBLISHED mais recente de cada
  // chave aparece; retirado some da tela (o histórico continua no banco, não na UI).
  const published = useMemo(
    () => versions.filter((v) => v.current && v.status === 'PUBLISHED'),
    [versions],
  );
  const existingKeys = useMemo(() => new Set(versions.map((v) => v.exerciseKey)), [versions]);

  function searchExercises(event: FormEvent) {
    event.preventDefault();
    setApplied(form);
  }

  function clearFilters() {
    setForm(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
  }

  /** Remover um chip age no rascunho E no aplicado de uma vez — o chip representa o que
   *  já está valendo, então tirá-lo muda a lista na hora, sem exigir "Buscar" de novo. */
  function removeFilter(patch: Partial<ExerciseFilters>) {
    setForm((current) => ({ ...current, ...patch }));
    setApplied((current) => ({ ...current, ...patch }));
  }

  const filtered = useMemo(() => {
    const q = applied.query.trim().toLowerCase();
    return published.filter((v) => {
      if (
        applied.muscleGroups.length > 0 &&
        !applied.muscleGroups.some((m) => v.muscleGroups.includes(m))
      )
        return false;
      if (applied.locations.length > 0 && !applied.locations.some((l) => v.locations.includes(l)))
        return false;
      if (!q) return true;
      return v.name.toLowerCase().includes(q);
    });
  }, [published, applied]);

  const chips: FilterChip[] = (() => {
    const active: FilterChip[] = [];
    const query = applied.query.trim();
    if (query) {
      active.push({
        key: 'query',
        label: `Nome: "${query}"`,
        removeLabel: 'Remover filtro Nome',
        onRemove: () => removeFilter({ query: '' }),
      });
    }
    if (applied.muscleGroups.length > 0) {
      active.push({
        key: 'muscleGroups',
        label: `Músculo: ${applied.muscleGroups.join(', ')}`,
        removeLabel: 'Remover filtro Músculo',
        onRemove: () => removeFilter({ muscleGroups: [] }),
      });
    }
    if (applied.locations.length > 0) {
      active.push({
        key: 'locations',
        label: `Local: ${applied.locations.map((l) => TRAINING_LOCATION_LABELS[l]).join(', ')}`,
        removeLabel: 'Remover filtro Local',
        onRemove: () => removeFilter({ locations: [] }),
      });
    }
    return active;
  })();

  // Nova busca volta pra página 1 — senão o item fica "perdido" numa página que pode
  // nem existir mais no recorte atual.
  useEffect(() => {
    setPage(1);
  }, [applied]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageEntries = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const rangeStart = filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, filtered.length);

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

  return (
    <div>
      <SectorHeader
        title="Exercícios"
        headingLevel="h2"
        description="A base de referência que a IA pode usar para montar um protocolo — nenhum exercício fora desta lista é prescrito."
        meta={data.meta}
        refreshing={loading}
        onRefresh={() => void refresh()}
      />

      {feedback ? (
        <p
          role="status"
          className="mt-4 rounded-lg border border-border bg-secondary p-3 text-label"
        >
          {feedback}
        </p>
      ) : null}

      <FilterBar
        label="Filtros do catálogo de exercícios"
        onSubmit={searchExercises}
        chips={chips}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={CONTROL_H}
              onClick={clearFilters}
            >
              Limpar filtro
            </Button>
            <Button type="submit" size="sm" className={CONTROL_H}>
              <Search aria-hidden="true" />
              Buscar
            </Button>
          </>
        }
      >
        <FilterField label="Nome" className="lg:w-64">
          <span className={cn(FIELD_BOX, CONTROL_H)}>
            <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <input
              type="search"
              value={form.query}
              onChange={(event) =>
                setForm((current) => ({ ...current, query: event.target.value }))
              }
              className="min-w-0 flex-1 bg-transparent text-label outline-none"
              placeholder="Nome do exercício"
            />
          </span>
        </FilterField>

        <FilterFieldset legend="Músculo" className="lg:w-56">
          <FilterMultiSelect
            options={MUSCLE_FILTER_OPTIONS}
            selected={form.muscleGroups}
            onChange={(next) => setForm((current) => ({ ...current, muscleGroups: next }))}
          />
        </FilterFieldset>

        <FilterFieldset legend="Local disponível" className="lg:w-56">
          <FilterMultiSelect
            options={LOCATION_FILTER_OPTIONS}
            selected={form.locations}
            onChange={(next) =>
              setForm((current) => ({ ...current, locations: next as TrainingLocation[] }))
            }
          />
        </FilterFieldset>
      </FilterBar>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-label text-muted-foreground">
          <span className="font-mono font-semibold text-foreground">{filtered.length}</span>{' '}
          {chips.length > 0
            ? 'exercício(s) encontrado(s) para o filtro aplicado.'
            : 'exercício(s) cadastrado(s) no total.'}
        </p>
        {canWrite ? (
          <Button onClick={() => setModal({ kind: 'create' })}>
            <Plus aria-hidden="true" />
            Novo exercício
          </Button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-border bg-card px-4 py-8 text-center text-label text-muted-foreground">
          Nenhum exercício encontrado.
        </p>
      ) : (
        <ol className="mt-4 space-y-3" aria-label="Catálogo de exercícios">
          {pageEntries.map((entry) => (
            <li
              key={entry.exerciseKey}
              className="rounded-xl border border-l-4 border-border bg-card p-4 text-card-foreground"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground"
                  >
                    <Dumbbell aria-hidden="true" className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-body font-semibold">{entry.name}</h3>
                    <p className="mt-1 truncate text-label text-muted-foreground">
                      {entry.muscleGroups.join(', ')} |{' '}
                      {entry.locations.map((loc) => TRAINING_LOCATION_LABELS[loc]).join(', ')}
                    </p>
                  </div>
                </div>
                {canWrite ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setModal({ kind: 'edit', entry })}
                      className={cn(
                        buttonVariants({ variant: 'ghost', size: 'icon' }),
                        ICON_BUTTON,
                      )}
                      aria-label={`Editar ${entry.name}`}
                      title="Editar"
                    >
                      <Pencil aria-hidden="true" />
                    </button>
                    <ConfirmAction
                      triggerLabel={`Excluir ${entry.name}`}
                      triggerIcon={Trash2}
                      triggerVariant="ghost"
                      triggerSize="icon"
                      destructive
                      disabled={retiringKey === entry.exerciseKey}
                      title={`Excluir “${entry.name}”?`}
                      description="A IA para de prescrever este exercício em novos protocolos. O item some desta lista; o histórico continua registrado."
                      confirmLabel="Excluir"
                      onConfirm={async () => {
                        setRetiringKey(entry.exerciseKey);
                        try {
                          await retireExerciseCatalogEntry({
                            exerciseKey: entry.exerciseKey,
                            changeNote: 'Excluído pelo painel de Exercícios',
                          });
                          setFeedback(`“${entry.name}” removido do catálogo.`);
                          await refresh();
                        } finally {
                          setRetiringKey(null);
                        }
                      }}
                    />
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}

      {filtered.length > 0 ? (
        <TableFooter>
          <ResultCount
            from={rangeStart}
            to={rangeEnd}
            total={filtered.length}
            noun="exercício(s)"
          />
          {totalPages > 1 ? (
            <TablePagination
              label="Paginação do catálogo de exercícios"
              page={currentPage}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          ) : null}
        </TableFooter>
      ) : null}

      {modal ? (
        <ExerciseEditorDialog
          mode={modal}
          existingKeys={existingKeys}
          onClose={() => setModal(null)}
          onSaved={(message) => {
            setModal(null);
            setFeedback(message);
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}
