import { z } from 'zod';

import { controlCenterMetaSchema } from './control-center.schema';

const SAFE_LABEL_PATTERN = /^[A-Za-zÀ-ú0-9 ,.'()-]{3,80}$/;
const SAFE_PHRASE_PATTERN = /^[A-Za-zÀ-ú0-9 ,.'()?!-]{3,100}$/;

export const l1GuardrailCandidateSchema = z.object({
  label: z.string().trim().regex(SAFE_LABEL_PATTERN, 'nome inválido'),
  scope: z.enum(['INPUT', 'OUTPUT', 'BOTH']),
  phrases: z
    .array(z.string().trim().regex(SAFE_PHRASE_PATTERN, 'frase inválida'))
    .min(1)
    .max(20)
    .refine(
      (phrases) =>
        new Set(phrases.map((phrase) => phrase.toLocaleLowerCase('pt-BR'))).size === phrases.length,
      'frases duplicadas',
    ),
  action: z.literal('FLAG'),
});
export type L1GuardrailCandidate = z.infer<typeof l1GuardrailCandidateSchema>;

export const publishL1GuardrailSchema = l1GuardrailCandidateSchema.extend({
  ruleKey: z.uuid().optional(),
  changeNote: z.string().trim().min(5).max(500),
});
export type PublishL1GuardrailInput = z.infer<typeof publishL1GuardrailSchema>;

export const rollbackL1GuardrailSchema = z.object({
  ruleKey: z.uuid(),
  targetVersion: z.int().positive(),
  changeNote: z.string().trim().min(5).max(500),
});
export type RollbackL1GuardrailInput = z.infer<typeof rollbackL1GuardrailSchema>;

export const retireL1GuardrailSchema = z.object({
  ruleKey: z.uuid(),
  changeNote: z.string().trim().min(5).max(500),
});
export type RetireL1GuardrailInput = z.infer<typeof retireL1GuardrailSchema>;

export const l1GuardrailVersionSchema = l1GuardrailCandidateSchema.extend({
  id: z.uuid(),
  ruleKey: z.uuid(),
  version: z.int().positive(),
  status: z.enum(['PUBLISHED', 'RETIRED']),
  changeNote: z.string(),
  createdBy: z.string().nullable(),
  createdAt: z.iso.datetime(),
  current: z.boolean(),
});
export type L1GuardrailVersion = z.infer<typeof l1GuardrailVersionSchema>;

export const l1GuardrailsResponseSchema = z.object({
  data: z.object({ versions: z.array(l1GuardrailVersionSchema) }),
  meta: controlCenterMetaSchema,
});
export type L1GuardrailsResponse = z.infer<typeof l1GuardrailsResponseSchema>;
