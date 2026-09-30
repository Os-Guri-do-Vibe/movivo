'use client';

/**
 * Tela única de revisão de uma proposta de substituição (achado 2026-09-30, troca em lote):
 * a proposta tem de 1 a 3 trocas e o profissional decide cada uma individualmente. Por item ele
 * pode manter a troca proposta, trocar por outra opção SEGURA para este aluno (recomputada no
 * servidor contra o protocolo vivo), descartar o item, ou, quando o aluno pediu um exercício
 * que não existe no catálogo, adicioná-lo ao catálogo. A decisão final é uma só ("Aprovar
 * agora"), e o servidor revalida a estrutura inteira do protocolo antes de aplicar.
 *
 * Só apresentação e estado local dos rascunhos de decisão: as ações (aprovar, recusar) vivem
 * em `QueueDetail`, junto do `ConfirmAction`.
 */
import { Plus, ShieldAlert, Undo2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { SubstitutionDetail, SubstitutionItemEdit } from '@/lib/dashboard-types';

/** Rascunho da decisão do profissional sobre um item (enquanto a proposta está pendente). */
export interface ItemDraft {
  discarded: boolean;
  /** Outro exercício no lugar do proposto; `null` mantém o proposto. */
  toExerciseId: string | null;
}

export type ItemDrafts = Readonly<Record<number, ItemDraft | undefined>>;

const KEEP_PROPOSED = '';

/** Decisões a enviar na aprovação: só o que o profissional mexeu, mais os descartes. */
export function buildItemEdits(
  substitution: SubstitutionDetail,
  drafts: ItemDrafts,
): SubstitutionItemEdit[] {
  return substitution.items.flatMap((item): SubstitutionItemEdit[] => {
    const draft = drafts[item.index];
    if (draft?.discarded) return [{ index: item.index, action: 'DISCARD' }];
    if (draft?.toExerciseId) {
      return [{ index: item.index, action: 'APPROVE', toExerciseId: draft.toExerciseId }];
    }
    return [];
  });
}

/** Itens que ainda precisam de decisão antes de aprovar: pedido de catálogo não resolvido. */
export function unresolvedItemIndexes(
  substitution: SubstitutionDetail,
  drafts: ItemDrafts,
): number[] {
  return substitution.items
    .filter((item) => item.to.id === null && !drafts[item.index]?.discarded)
    .map((item) => item.index);
}

export function allItemsDiscarded(substitution: SubstitutionDetail, drafts: ItemDrafts): boolean {
  return substitution.items.every((item) => drafts[item.index]?.discarded === true);
}

export function SubstitutionItemsReview({
  substitution,
  drafts,
  onChange,
  onAddCatalog,
}: {
  substitution: SubstitutionDetail;
  drafts: ItemDrafts;
  onChange: (index: number, draft: ItemDraft) => void;
  onAddCatalog: (index: number) => void;
}) {
  const pending = substitution.status === 'PENDING';
  const multiple = substitution.items.length > 1;
  return (
    <section
      aria-labelledby="substitution-title"
      className="rounded-xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="substitution-title" className="text-h3 font-semibold">
          {multiple ? 'Trocas propostas' : 'Troca proposta'}
        </h2>
        {substitution.reviewUrgency === 'MANDATORY' ? (
          // Coral só na borda (elemento gráfico) — texto em `--foreground`, mesma regra de
          // contraste de `FieldError`/`FieldWarning` (WCAG 1.4.3: coral em texto pequeno
          // sobre fundo claro reprova AA).
          <span className="flex items-center gap-1.5 rounded-full border border-coral px-2.5 py-1 text-xs font-semibold text-foreground">
            <ShieldAlert aria-hidden="true" className="size-3.5 text-coral" />
            Revisão obrigatória
          </span>
        ) : null}
      </div>

      <ul className="mt-4 space-y-4">
        {substitution.items.map((item) => {
          const draft = drafts[item.index];
          const discarded = pending ? draft?.discarded === true : item.decision === 'DISCARDED';
          const gap = item.to.id === null;
          const alternatives = item.options.filter((option) => option.id !== item.to.id);
          return (
            <li
              key={item.index}
              className="rounded-lg border border-border p-3 sm:p-4"
              aria-label={`Troca ${item.index + 1}: ${item.from.name}`}
            >
              <div className="flex flex-wrap items-center gap-3 text-body">
                <span className="rounded-lg bg-secondary px-3 py-1.5 font-medium line-through decoration-2">
                  {item.from.name}
                </span>
                <span aria-hidden="true" className="text-muted-foreground">
                  →
                </span>
                {gap ? (
                  <span className="rounded-lg border border-dashed border-coral px-3 py-1.5 font-semibold text-foreground">
                    “{item.to.name}” (fora do catálogo)
                  </span>
                ) : (
                  <span
                    className={
                      discarded
                        ? 'rounded-lg bg-secondary px-3 py-1.5 font-semibold text-muted-foreground line-through'
                        : 'rounded-lg bg-accent px-3 py-1.5 font-semibold text-accent-foreground'
                    }
                  >
                    {item.to.name}
                  </span>
                )}
                {item.mandatory && !gap && substitution.reviewUrgency !== 'MANDATORY' ? (
                  <span className="text-label text-muted-foreground">Exige decisão</span>
                ) : null}
                {discarded ? (
                  <span className="text-label font-semibold text-muted-foreground">
                    Item descartado
                  </span>
                ) : null}
              </div>

              {pending && !discarded ? (
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  {!gap && alternatives.length > 0 ? (
                    <label
                      htmlFor={`substitution-item-${item.index}-to`}
                      className="text-label font-semibold"
                    >
                      Trocar por outra opção segura
                      <select
                        id={`substitution-item-${item.index}-to`}
                        className="mt-1 block min-h-11 w-full min-w-56 rounded-lg border border-border bg-card px-3 text-body"
                        value={draft?.toExerciseId ?? KEEP_PROPOSED}
                        onChange={(event) =>
                          onChange(item.index, {
                            discarded: false,
                            toExerciseId: event.target.value || null,
                          })
                        }
                      >
                        <option value={KEEP_PROPOSED}>Manter a proposta</option>
                        {alternatives.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {gap ? (
                    <Button
                      variant="outline"
                      onClick={() => onAddCatalog(item.index)}
                      aria-label={`Adicionar ao catálogo: ${item.to.name}`}
                    >
                      <Plus aria-hidden="true" /> Adicionar exercício ao catálogo
                    </Button>
                  ) : null}
                  {multiple || gap ? (
                    <Button
                      variant="outline"
                      onClick={() => onChange(item.index, { discarded: true, toExerciseId: null })}
                      aria-label={`Descartar a troca de ${item.from.name}`}
                    >
                      <X aria-hidden="true" /> Descartar item
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {pending && discarded ? (
                <div className="mt-3">
                  <Button
                    variant="outline"
                    onClick={() => onChange(item.index, { discarded: false, toExerciseId: null })}
                    aria-label={`Desfazer o descarte da troca de ${item.from.name}`}
                  >
                    <Undo2 aria-hidden="true" /> Desfazer descarte
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {substitution.diff && substitution.diff.sessionsAffected.length > 0 ? (
        <p className="mt-3 text-label text-muted-foreground">
          Dias afetados: {substitution.diff.sessionsAffected.join(', ')}
        </p>
      ) : null}
      <p className="mt-3 text-label text-muted-foreground">{substitution.changeReason}</p>
    </section>
  );
}
