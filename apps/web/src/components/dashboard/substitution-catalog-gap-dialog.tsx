'use client';

/**
 * "Adicionar exercício ao catálogo" (achado 2026-09-09, pedido do fundador) — só aparece
 * numa proposta de substituição `catalogGap`: o aluno pediu um exercício que não existe em
 * nenhum lugar da base. Publica o exercício (mesmos campos simplificados do modal "Novo
 * exercício" da tela Exercícios — `ExerciseEditorDialog` em `ai-exercise-catalog.tsx`,
 * reaproveitando `slugifyExerciseName`/`uniqueExerciseKey`/`CATALOG_MUSCLE_GROUPS` de lá pra
 * não duplicar) e aprova a troca no mesmo gesto (`addCatalogExerciseAndApproveSubstitution`,
 * um único endpoint que faz as duas coisas atomicamente do lado do servidor).
 */
import {
  TRAINING_LOCATION_LABELS,
  trainingLocationSchema,
  type TrainingLocation,
} from '@movivo/shared';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getExerciseCatalog } from '@/lib/control-center-api';
import { addCatalogExerciseAndApproveSubstitution, DashboardApiError } from '@/lib/dashboard-api';
import { cn } from '@/lib/utils';

import {
  CATALOG_INPUT_CLASS,
  CATALOG_MUSCLE_GROUPS,
  slugifyExerciseName,
  uniqueExerciseKey,
} from './ai-exercise-catalog';

interface Form {
  name: string;
  muscleGroups: string[];
  locations: TrainingLocation[];
  videoUrl: string;
}

export function SubstitutionCatalogGapDialog({
  substitutionId,
  requestedName,
  onClose,
  onSaved,
}: {
  substitutionId: string;
  requestedName: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState<Form>({
    name: requestedName,
    muscleGroups: [],
    locations: [],
    videoUrl: '',
  });
  const [existingKeys, setExistingKeys] = useState<ReadonlySet<string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Busca as chaves já usadas no catálogo pra nunca gerar uma `exerciseKey` colidindo com um
  // exercício existente (o backend trataria como uma NOVA VERSÃO daquela chave — sobrescreveria
  // o exercício errado). Mesma cautela de `AiExerciseCatalogDashboard`.
  useEffect(() => {
    let cancelled = false;
    void getExerciseCatalog()
      .then((response) => {
        if (cancelled) return;
        setExistingKeys(new Set(response.data.versions.map((v) => v.exerciseKey)));
      })
      .catch(() => {
        if (!cancelled) setExistingKeys(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const canSave =
    existingKeys !== null &&
    form.name.trim().length >= 2 &&
    form.muscleGroups.length > 0 &&
    form.locations.length > 0;

  const muscleSummary =
    form.muscleGroups.length > 0 ? form.muscleGroups.join(', ') : 'Selecione o(s) músculo(s)';

  async function save() {
    if (!existingKeys) return;
    setSaving(true);
    setError('');
    try {
      const exerciseKey = uniqueExerciseKey(slugifyExerciseName(form.name), existingKeys);
      await addCatalogExerciseAndApproveSubstitution(substitutionId, {
        exerciseKey,
        changeNote: 'Adicionado a partir de pedido de aluno via WhatsApp (fila de substituição)',
        name: form.name.trim(),
        // Campos técnicos (padrão de movimento, nível, contraindicações, substitutos,
        // equipamento) nascem com o MESMO default conservador do "Novo exercício" da tela
        // Exercícios — quem prescreve daqui pra frente valida de novo pelo `ValidationService`
        // de qualquer forma; ajuste fino de categorização é edição posterior, não bloqueia
        // esta aprovação.
        pattern: 'ISOLATION',
        minLevel: 'INICIANTE',
        contraindicatedFor: [],
        substitutes: [],
        equipment: [],
        muscleGroups: form.muscleGroups,
        locations: form.locations,
        videoUrl: form.videoUrl.trim() || undefined,
      });
      onSaved(`"${form.name.trim()}" adicionado ao catálogo e a troca foi aplicada.`);
    } catch (caught) {
      setError(
        caught instanceof DashboardApiError
          ? caught.message
          : 'Não foi possível adicionar o exercício e aprovar a troca.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar exercício ao catálogo</DialogTitle>
        </DialogHeader>

        <p className="text-label text-muted-foreground">
          O aluno pediu este exercício e ele ainda não está na nossa base. Publique-o pra aplicar a
          troca — vira uma opção real do catálogo daqui pra frente.
        </p>

        {error ? (
          <p role="alert" className="rounded-lg border border-coral bg-card p-3 text-label">
            {error}
          </p>
        ) : null}

        <div className="grid gap-4">
          <label htmlFor="catalog-gap-name" className="text-label font-semibold">
            Nome do exercício
            <input
              id="catalog-gap-name"
              className={CATALOG_INPUT_CLASS}
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
                {CATALOG_MUSCLE_GROUPS.map((muscle) => {
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

          <label htmlFor="catalog-gap-video" className="text-label font-semibold">
            Link do vídeo de execução (opcional)
            <input
              id="catalog-gap-video"
              type="url"
              className={CATALOG_INPUT_CLASS}
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
            {saving ? 'Adicionando…' : 'Adicionar e aprovar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
