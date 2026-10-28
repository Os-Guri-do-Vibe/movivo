/** Contratos de leitura do painel (fila de exceções, agentes e custo de IA). */
import { z } from 'zod';

import { exceptionDomainSchema } from './council';
import {
  exceptionKindSchema,
  exceptionPrioritySchema,
  exceptionStatusSchema,
  uncertaintySchema,
} from './coaching.schema';
import { modelTierSchema, tierRouteSchema } from './model-tier.schema';

const iso = z.string().min(1);

export const exceptionListItemSchema = z.object({
  id: z.uuid(),
  kind: exceptionKindSchema,
  priority: exceptionPrioritySchema,
  status: exceptionStatusSchema,
  domain: exceptionDomainSchema,
  summary: z.string(),
  createdAt: iso,
  assignedStaffId: z.uuid().nullable(),
  studentId: z.uuid(),
  studentName: z.string().nullable(),
  canResolve: z.boolean(),
});
export type ExceptionListItem = z.infer<typeof exceptionListItemSchema>;
export const exceptionListResponseSchema = z.array(exceptionListItemSchema);

const proposalViewSchema = z.object({
  id: z.uuid(),
  actionType: z.string(),
  action: z.record(z.string(), z.unknown()),
  rationale: z.array(z.string()),
  evidence: z.array(z.string()),
  assumptions: z.array(z.string()),
  uncertainty: uncertaintySchema,
  expectedOutcome: z.string(),
  status: z.string(),
});

export const exceptionDetailSchema = z.object({
  case: exceptionListItemSchema.omit({ studentId: true, studentName: true }).extend({
    userId: z.uuid(),
    resolution: z.record(z.string(), z.unknown()).nullable(),
    resolvedAt: iso.nullable(),
  }),
  student: z
    .object({ id: z.uuid(), name: z.string().nullable(), timezone: z.string().nullable() })
    .nullable(),
  proposal: proposalViewSchema.nullable(),
  decision: z
    .object({
      id: z.uuid(),
      verdict: z.string(),
      reasons: z.array(z.string()),
      decidedBy: z.string(),
    })
    .nullable(),
  safety: z
    .object({
      id: z.uuid(),
      kind: z.string(),
      severity: z.string(),
      scope: z.string(),
      evidence: z.string(),
      status: z.string(),
      canResolve: z.boolean(),
    })
    .nullable(),
  /** Fatias do Estado do Aluno (objetivo, treino, nutrição, adesão, decisões recentes…). */
  state: z.record(z.string(), z.unknown()),
});
export type ExceptionDetail = z.infer<typeof exceptionDetailSchema>;

export const exceptionDecisionsResponseSchema = z.array(
  z.object({
    proposalId: z.uuid(),
    action: z.string(),
    rationale: z.array(z.string()),
    assumptions: z.array(z.string()),
    uncertainty: z.string(),
    verdict: z.string().nullable(),
    decidedBy: z.string().nullable(),
    reasons: z.array(z.string()).nullable(),
    command: z.string().nullable(),
    createdAt: iso,
  }),
);
export type ExceptionDecision = z.infer<typeof exceptionDecisionsResponseSchema>[number];

export const exceptionActionResponseSchema = z.object({
  id: z.uuid(),
  status: z.string(),
});

export const agentsOverviewSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string(),
      tier: modelTierSchema,
      promptVersion: z.string(),
      cases: z.number().int(),
      lastEval: z
        .object({
          passed: z.boolean(),
          casesPassed: z.number().int(),
          casesTotal: z.number().int(),
          finishedAt: iso,
          costBrl: z.number(),
          current: z.boolean(),
        })
        .nullable(),
    }),
  ),
  tiers: z.array(
    z.object({
      tier: modelTierSchema,
      source: z.enum(['PAINEL', 'PADRÃO']),
      routes: z.array(tierRouteSchema),
    }),
  ),
});
export type AgentsOverview = z.infer<typeof agentsOverviewSchema>;

export const agentCostsSchema = z.object({
  days: z.number().int(),
  totalBrl: z.number(),
  students: z.number().int(),
  avgPerStudentBrl: z.number(),
  byTask: z.array(
    z.object({
      taskId: z.string(),
      calls: z.number().int(),
      failed: z.number().int(),
      costBrl: z.number(),
      avgLatencyMs: z.number(),
    }),
  ),
  byStudent: z.array(
    z.object({
      userId: z.uuid().nullable(),
      name: z.string().nullable(),
      calls: z.number().int(),
      costBrl: z.number(),
    }),
  ),
});
export type AgentCosts = z.infer<typeof agentCostsSchema>;

export const exceptionsSummarySchema = z.object({
  open: z.number().int().nonnegative(),
  urgent: z.number().int().nonnegative(),
});
export type ExceptionsSummary = z.infer<typeof exceptionsSummarySchema>;
