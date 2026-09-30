/**
 * Decisões do profissional sobre uma proposta de substituição de exercício (achado
 * 2026-09-30, troca em lote). Uma proposta carrega de 1 a 3 trocas (itens) no mesmo registro,
 * e o profissional aprova, edita ou descarta cada uma na tela única. Mesma definição na API
 * (validação) e no BFF do painel (erro de formato antes de bater na API).
 */
import { z } from 'zod';

/** Teto de trocas por proposta — acima disso deixa de ser troca e vira revisão de treino. */
export const MAX_SUBSTITUTION_ITEMS = 3;

export const substitutionItemEditSchema = z
  .object({
    /** Posição do item na proposta. */
    index: z
      .number()
      .int()
      .min(0)
      .max(MAX_SUBSTITUTION_ITEMS - 1),
    action: z.enum(['APPROVE', 'DISCARD']),
    /** Só com `APPROVE`: outro exercício do catálogo no lugar do proposto. */
    toExerciseId: z.string().min(1).max(100).optional(),
  })
  .strict();
export type SubstitutionItemEditInput = z.infer<typeof substitutionItemEditSchema>;

/** Corpo opcional da aprovação: sem `items`, aprova todos os itens como estão. */
export const approveSubstitutionSchema = z
  .object({
    items: z.array(substitutionItemEditSchema).max(MAX_SUBSTITUTION_ITEMS).optional(),
  })
  .strict();
export type ApproveSubstitutionInput = z.infer<typeof approveSubstitutionSchema>;
