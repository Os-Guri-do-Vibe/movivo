/**
 * Contrato do simulador síncrono de configuração: roda os quatro checks (esquema, entradas e
 * saídas de referência, integridade do prompt) sobre o candidato antes de qualquer publicação.
 */
import { z } from 'zod';

import { controlCenterMetaSchema } from './control-center.schema';
import { faqCandidateSchema } from './faq.schema';
import { forbiddenTopicCandidateSchema } from './forbidden-topic.schema';
import { l1GuardrailCandidateSchema } from './guardrail.schema';

export const simulateAgentConfigSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('FAQ'), candidate: faqCandidateSchema }),
  z.object({ kind: z.literal('GUARDRAIL'), candidate: l1GuardrailCandidateSchema }),
  z.object({ kind: z.literal('FORBIDDEN_TOPIC'), candidate: forbiddenTopicCandidateSchema }),
]);
export type SimulateAgentConfigInput = z.infer<typeof simulateAgentConfigSchema>;

export const configSimulationCheckSchema = z.object({
  id: z.enum(['SCHEMA', 'GOLDEN_INPUT', 'GOLDEN_OUTPUT', 'PROMPT_INTEGRITY']),
  title: z.string(),
  passed: z.boolean(),
  cases: z.int().nonnegative(),
  failures: z.array(z.string()),
});
export type ConfigSimulationCheck = z.infer<typeof configSimulationCheckSchema>;

export const configSimulationResponseSchema = z.object({
  data: z.object({
    kind: z.enum(['FAQ', 'GUARDRAIL', 'FORBIDDEN_TOPIC']),
    passed: z.boolean(),
    candidateHash: z.string().regex(/^[a-f0-9]{64}$/),
    checks: z.array(configSimulationCheckSchema).length(4),
  }),
  meta: controlCenterMetaSchema,
});
export type ConfigSimulationResponse = z.infer<typeof configSimulationResponseSchema>;
