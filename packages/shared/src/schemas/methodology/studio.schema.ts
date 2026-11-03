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
      /** O que reprovou, em português: "Situação: o que se esperava". Vazio se passou. */
      failures: z.array(z.string()).default([]),
    }),
  ),
  unjustified: z.array(z.object({ path: z.string(), label: z.string() })),
});
export type MethodologyTestOutcome = z.infer<typeof methodologyTestOutcomeSchema>;

/**
 * Andamento do teste de um rascunho. O teste roda com modelos reais e leva minutos, então corre
 * em segundo plano: o painel inicia e consulta este andamento até `FINISHED` ou `FAILED`.
 */
export const methodologyTestProgressSchema = z.object({
  state: z.enum(['IDLE', 'RUNNING', 'FINISHED', 'FAILED']),
  /** Tarefas de agente a avaliar e quantas já terminaram. */
  total: z.number(),
  completed: z.number(),
  /** Tarefa em avaliação agora (id técnico). */
  currentTask: z.string().nullable(),
  startedAt: z.string().nullable(),
  /** Presente quando `FINISHED`. */
  outcome: methodologyTestOutcomeSchema.nullable(),
  /** Presente quando `FAILED`: frase pronta para o profissional. */
  error: z.string().nullable(),
  /** Gasto com modelos de IA neste teste até agora (R$). */
  spentBrl: z.number(),
  /** Por que o teste parou antes de avaliar todas as tarefas (primeira reprovação, limite de gasto). */
  stoppedReason: z.string().nullable(),
});
export type MethodologyTestProgress = z.infer<typeof methodologyTestProgressSchema>;

/** Confirmação de gasto: o teste só começa com um limite em reais definido por quem clicou. */
export const methodologyStartTestSchema = z.object({
  budgetBrl: z.number().min(0.1).max(50),
});
export type MethodologyStartTest = z.infer<typeof methodologyStartTestSchema>;

/** Estimativa de custo de um teste, com base nos últimos testes das mesmas tarefas. */
export const methodologyTestEstimateSchema = z.object({
  tasks: z.array(
    z.object({
      taskId: z.string(),
      cases: z.number(),
      /** `null` quando a tarefa nunca foi avaliada (sem histórico para estimar). */
      estimatedBrl: z.number().nullable(),
    }),
  ),
  /** Soma das estimativas conhecidas. */
  estimatedTotalBrl: z.number(),
  /** Quantas tarefas não têm histórico de custo. */
  unknownTasks: z.number(),
  /** Limite de gasto sugerido (e usado se você confirmar sem mudar). */
  suggestedBudgetBrl: z.number(),
  /** Modelo usado nos testes (o DeepSeek mais barato). */
  model: z.string().nullable(),
});
export type MethodologyTestEstimate = z.infer<typeof methodologyTestEstimateSchema>;
