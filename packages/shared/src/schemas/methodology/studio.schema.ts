import { z } from 'zod';

/** Corpo da edição de um rascunho no estúdio (os limites do domínio são checados no servidor). */
export const methodologyDraftUpdateSchema = z.object({
  parameters: z.record(z.string(), z.record(z.string(), z.unknown())),
  guidance: z.record(z.string(), z.string().max(8_000)),
  justifications: z.record(z.string(), z.string().trim().max(1_000)),
  changeNote: z.string().trim().min(1).max(500),
});
export type MethodologyDraftUpdate = z.infer<typeof methodologyDraftUpdateSchema>;

/** Abertura de rascunho; `fromVersion` = rollback a partir de uma versão anterior. */
export const methodologyOpenDraftSchema = z.object({
  fromVersion: z.number().int().positive().optional(),
});

export const methodologyDocumentStatusSchema = z.enum([
  'DRAFT',
  'TESTING',
  'PUBLISHED',
  'SUPERSEDED',
  'DISCARDED',
]);
export type MethodologyDocumentStatus = z.infer<typeof methodologyDocumentStatusSchema>;

/** Resumo de um domínio na lista do estúdio. */
export const methodologyDomainSummarySchema = z.object({
  domain: z.string(),
  title: z.string(),
  description: z.string(),
  owner: z.enum(['CREF', 'CRN', 'CREF_CRN']),
  publishedVersion: z.number().nullable(),
  publishedAt: z.string().nullable(),
  openDraft: z
    .object({ id: z.string(), version: z.number(), status: methodologyDocumentStatusSchema })
    .nullable(),
});
export type MethodologyDomainSummary = z.infer<typeof methodologyDomainSummarySchema>;

export const methodologyVersionSummarySchema = z.object({
  id: z.string(),
  version: z.number(),
  status: methodologyDocumentStatusSchema,
  changeNote: z.string(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type MethodologyVersionSummary = z.infer<typeof methodologyVersionSummarySchema>;

export const methodologyDocumentSchema = z.object({
  id: z.string(),
  domain: z.string(),
  version: z.number(),
  status: methodologyDocumentStatusSchema,
  parameters: z.record(z.string(), z.record(z.string(), z.unknown())),
  guidance: z.record(z.string(), z.string()),
  justifications: z.record(z.string(), z.string()),
  changeNote: z.string(),
});
export type MethodologyDocumentView = z.infer<typeof methodologyDocumentSchema>;

export const methodologyChangeSchema = z.object({
  path: z.string(),
  label: z.string(),
  before: z.unknown(),
  after: z.unknown(),
});
export type MethodologyChangeView = z.infer<typeof methodologyChangeSchema>;

/** Resultado do teste de um rascunho (justificativas + avaliação das tarefas do domínio). */
export const methodologyTestOutcomeSchema = z.object({
  passed: z.boolean(),
  evaluations: z.array(
    z.object({
      taskId: z.string(),
      passed: z.boolean(),
      casesTotal: z.number(),
      casesPassed: z.number(),
    }),
  ),
  unjustified: z.array(z.object({ path: z.string(), label: z.string() })),
});
export type MethodologyTestOutcome = z.infer<typeof methodologyTestOutcomeSchema>;
