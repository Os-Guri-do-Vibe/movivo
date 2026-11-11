/**
 * Contratos compartilhados pelas tarefas de bloco (`strength|running|hyrox.build_block`).
 * Cada tarefa devolve as sessões-modelo da SUA modalidade, mais o resumo e as fases que o
 * plano usa quando a modalidade é a única; com várias modalidades, o planejador híbrido
 * reconcilia tudo numa estrutura só.
 */
import { z } from 'zod';

import { planPhaseSchema, planSessionSchema, type PlanSession } from '@movivo/shared';

export const blockOutputSchema = z.object({
  summary: z.string().trim().min(1).max(600),
  phases: z.array(planPhaseSchema).min(1).max(4),
  sessions: z.array(planSessionSchema).min(1).max(7),
  /** Orientações que o aluno vê junto do plano (progressão, o que observar). */
  notes: z.array(z.string().trim().min(1).max(300)).max(6),
});
export type BlockOutput = z.infer<typeof blockOutputSchema>;

export function totalFrequency(sessions: readonly PlanSession[]): number {
  return sessions.reduce((sum, s) => sum + s.weeklyFrequency, 0);
}
