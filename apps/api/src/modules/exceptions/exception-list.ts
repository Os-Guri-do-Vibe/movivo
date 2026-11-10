/**
 * Contexto curto de cada caso da lista, para a Fila do Profissional dizer o que está pendente
 * ("Protocolo de treino", "Troca de exercício") sem abrir o caso: o tipo da ação proposta e,
 * nos casos sem proposta, a origem. O `subject` cru não sai na lista.
 */
export interface ListedCaseRow {
  subject: Record<string, string>;
}

export type WithListContext<T extends ListedCaseRow> = Omit<T, 'subject'> & {
  actionType: string | null;
  source: string | null;
};

/** Ids das propostas citadas pelos casos (sem repetição), para uma única leitura. */
export function proposalIdsOf(rows: readonly ListedCaseRow[]): string[] {
  return [
    ...new Set(rows.flatMap((row) => (row.subject.proposalId ? [row.subject.proposalId] : []))),
  ];
}

export function withListContext<T extends ListedCaseRow>(
  rows: readonly T[],
  actionTypeByProposal: ReadonlyMap<string, string>,
): WithListContext<T>[] {
  return rows.map(({ subject, ...row }) => ({
    ...row,
    actionType: subject.proposalId ? (actionTypeByProposal.get(subject.proposalId) ?? null) : null,
    source: typeof subject.source === 'string' ? subject.source : null,
  }));
}
