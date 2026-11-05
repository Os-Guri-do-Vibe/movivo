/**
 * Compromissos do aluno: o "próximo passo" que um especialista combina na conversa da semana.
 * Aqui ficam os contratos que os agentes compartilham (o que entra na leitura e o que sai dela)
 * e as regras puras; o serviço persiste e fecha o ciclo na semana seguinte.
 */
import { z } from 'zod';

import type { Violation } from '../../core/agents/agent-task';

export const COMMITMENT_SOURCES = ['TRAINING', 'NUTRITION', 'HABITS'] as const;
export type CommitmentSource = (typeof COMMITMENT_SOURCES)[number];

/** O que o especialista diz sobre um compromisso já vencido (ou perto de vencer). */
export const COMMITMENT_VERDICTS = ['KEPT', 'PARTIAL', 'NOT_KEPT'] as const;

/** Compromisso em aberto que o especialista precisa reavaliar com os dados da semana. */
export const openCommitmentSchema = z.object({
  id: z.uuid(),
  text: z.string().max(240),
  createdOn: z.iso.date(),
  dueOn: z.iso.date(),
});
export type OpenCommitment = z.infer<typeof openCommitmentSchema>;

/** Resultado da reavaliação, com a evidência dos dados que sustenta o veredito. */
export const commitmentReviewSchema = z
  .array(
    z.object({
      id: z.uuid(),
      verdict: z.enum(COMMITMENT_VERDICTS),
      evidence: z.string().trim().min(8).max(200),
    }),
  )
  .max(3);
export type CommitmentReview = z.infer<typeof commitmentReviewSchema>;

/** Todo compromisso em aberto é reavaliado, e só os que existem. */
export function commitmentReviewViolations(
  open: readonly OpenCommitment[],
  review: CommitmentReview,
): Violation[] {
  const known = new Set(open.map((c) => c.id));
  const violations: Violation[] = review
    .filter((r) => !known.has(r.id))
    .map((r) => ({ path: 'commitmentReview', message: `compromisso desconhecido: ${r.id}` }));
  const reviewed = new Set(review.map((r) => r.id));
  for (const commitment of open) {
    if (!reviewed.has(commitment.id)) {
      violations.push({
        path: 'commitmentReview',
        message: `reavalie o compromisso "${commitment.text.slice(0, 60)}" (${commitment.id}) com os dados da semana`,
      });
    }
  }
  return violations;
}

/** Prazo padrão: o passo vale até o fim da semana seguinte ao combinado. */
export const COMMITMENT_WINDOW_DAYS = 7;
