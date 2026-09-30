/**
 * Itens de uma proposta de substituição de exercício (achado 2026-09-30, troca em lote).
 *
 * Uma proposta (`protocol_substitution_requests`) carrega de 1 a `MAX_SUBSTITUTION_ITEMS`
 * trocas no MESMO registro, e o profissional aprova, edita ou descarta cada uma delas na tela
 * única da proposta. A coluna `items` é aditiva: propostas de item único anteriores a ela só
 * têm as colunas `from_*`/`to_*`, e `itemsOf` deriva o item delas — um único caminho de leitura
 * para dados novos e legados.
 *
 * Sem I/O e sem LLM: transformações puras, testáveis sem harness do Nest.
 */
import { MAX_SUBSTITUTION_ITEMS } from '@movivo/shared';
import { z } from 'zod';

export { MAX_SUBSTITUTION_ITEMS };

export type SubstitutionItemDecision = 'PENDING' | 'APPROVED' | 'DISCARDED';

export interface SubstitutionItem {
  fromExerciseId: string;
  fromExerciseName: string;
  /** `null` quando o aluno pediu um exercício que ainda não existe no catálogo. */
  toExerciseId: string | null;
  /** Com `toExerciseId === null`, o texto exatamente como o aluno pediu. */
  toExerciseName: string;
  /** Exercício pedido inexistente no catálogo — liga "Adicionar ao catálogo" na revisão. */
  catalogGap: boolean;
  /** Este item exige decisão humana (fora da curadoria segura, ou catálogo). */
  mandatory: boolean;
  decision: SubstitutionItemDecision;
}

const itemSchema = z.object({
  fromExerciseId: z.string().min(1).max(100),
  fromExerciseName: z.string().min(1).max(200),
  toExerciseId: z.string().min(1).max(100).nullable(),
  toExerciseName: z.string().min(1).max(200),
  catalogGap: z.boolean(),
  mandatory: z.boolean(),
  decision: z.enum(['PENDING', 'APPROVED', 'DISCARDED']),
});
const itemsSchema = z.array(itemSchema).min(1).max(MAX_SUBSTITUTION_ITEMS);

/** Campos da linha que `itemsOf` precisa — só o necessário, para aceitar `select` parcial. */
export interface SubstitutionRequestItemsSource {
  items: unknown;
  status: 'PENDING' | 'RELEASED' | 'DISCARDED';
  fromExerciseId: string;
  fromExerciseName: string;
  toExerciseId: string | null;
  toExerciseName: string;
  catalogGap: boolean;
  reviewUrgency: 'OPTIONAL' | 'MANDATORY';
}

/** Decisão de um item legado, derivada do estado da proposta que o contém. */
function legacyDecision(
  status: SubstitutionRequestItemsSource['status'],
): SubstitutionItemDecision {
  if (status === 'RELEASED') return 'APPROVED';
  if (status === 'DISCARDED') return 'DISCARDED';
  return 'PENDING';
}

/** Itens da proposta: a coluna `items` quando válida, senão o único item legado das colunas. */
export function itemsOf(row: SubstitutionRequestItemsSource): SubstitutionItem[] {
  const parsed = itemsSchema.safeParse(row.items);
  if (parsed.success) return parsed.data;
  return [
    {
      fromExerciseId: row.fromExerciseId,
      fromExerciseName: row.fromExerciseName,
      toExerciseId: row.toExerciseId,
      toExerciseName: row.toExerciseName,
      catalogGap: row.catalogGap,
      mandatory: row.reviewUrgency === 'MANDATORY',
      decision: legacyDecision(row.status),
    },
  ];
}

/** Uma troca aplicada — o que a saudação de reentrega e o resumo citam. */
export interface SubstitutionChange {
  from: string;
  to: string;
}

/** Junta `["A", "B", "C"]` como `A, B e C` (pt-BR). */
export function joinNatural(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
}

/** Frase `"A" virou "B"` para uma ou mais trocas — usada pela saudação de reentrega. */
export function describeChangesBecame(changes: readonly SubstitutionChange[]): string {
  return joinNatural(changes.map((c) => `"${c.from}" virou "${c.to}"`));
}

/** Frase `trocar "A" por "B"` para uma ou mais trocas — usada no prompt do resumo de IA. */
export function describeChangesAsk(changes: readonly SubstitutionChange[]): string {
  return joinNatural(changes.map((c) => `"${c.from}" por "${c.to}"`));
}
