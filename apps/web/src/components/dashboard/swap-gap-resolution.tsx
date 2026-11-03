'use client';

/**
 * Troca de exercício sem equivalente seguro no catálogo: a equipe escolhe um exercício seguro
 * para o aluno (a troca entra no protocolo e o aluno recebe o protocolo atualizado) ou
 * adiciona o exercício que falta ao catálogo e escolhe em seguida.
 */
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { getExerciseCatalog, getSwapOptions, substituteExercise } from '@/lib/control-center-api';

import { ExerciseEditorDialog } from './ai-exercise-catalog';
import { ConfirmAction } from './confirm-action';
import { ResourceState, useControlCenterResource } from './control-center-ui';

export function SwapGapResolution({
  caseId,
  canAct,
  onChanged,
}: {
  caseId: string;
  canAct: boolean;
  onChanged: () => Promise<void>;
}) {
  const load = useCallback((signal?: AbortSignal) => getSwapOptions(caseId, signal), [caseId]);
  const { data, error, forbidden, loading, refresh } = useControlCenterResource(load);
  const [choice, setChoice] = useState('');
  const [adding, setAdding] = useState(false);
  const [keys, setKeys] = useState<ReadonlySet<string>>(new Set());
  const [feedback, setFeedback] = useState('');

  // As chaves do catálogo evitam colisão ao criar o exercício novo.
  useEffect(() => {
    if (!adding) return;
    let alive = true;
    getExerciseCatalog()
      .then((response) => {
        if (alive) setKeys(new Set(response.data.versions.map((v) => v.exerciseKey)));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [adding]);

  const chosenName = useMemo(
    () => data?.options.find((option) => option.id === choice)?.name ?? '',
    [data, choice],
  );

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
    <section
      className="rounded-xl border border-border bg-card p-4 sm:p-5"
      aria-label="Troca sem equivalente"
    >
      <h2 className="text-h3 font-semibold">Escolher o exercício da troca</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        O aluno quer trocar <strong>{data.fromName}</strong> e o sistema não achou um equivalente
        seguro. Escolha entre os exercícios seguros para ele ou adicione o que falta ao catálogo.
      </p>
      {feedback ? (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          {feedback}
        </p>
      ) : null}
      {canAct ? (
        <>
          <label className="mt-4 block text-xs font-medium text-muted-foreground">
            Exercício no lugar de {data.fromName}
            <select
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-card px-2 py-1.5 text-label text-foreground"
            >
              <option value="">Selecione…</option>
              {data.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-4 flex flex-wrap gap-3">
            <ConfirmAction
              triggerLabel="Trocar e enviar protocolo"
              title="Trocar no protocolo do aluno?"
              description={`${data.fromName} sai e ${chosenName || 'o exercício escolhido'} entra no protocolo. O aluno recebe o protocolo atualizado no WhatsApp.`}
              confirmLabel="Trocar"
              disabled={!choice}
              onConfirm={async () => {
                await substituteExercise(caseId, choice);
                await onChanged();
              }}
            />
            <Button type="button" variant="outline" onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" />
              Adicionar ao catálogo
            </Button>
          </div>
        </>
      ) : null}
      {adding ? (
        <ExerciseEditorDialog
          mode={{ kind: 'create' }}
          existingKeys={keys}
          onClose={() => setAdding(false)}
          onSaved={(message) => {
            setAdding(false);
            setFeedback(`${message} Escolha-o na lista para concluir a troca.`);
            void refresh();
          }}
        />
      ) : null}
    </section>
  );
}
