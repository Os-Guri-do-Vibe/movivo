/** Contratos de leitura do painel (fila de exceções, agentes e custo de IA). */
import { z } from 'zod';

import { medicalExamViewSchema } from '../medical/exam.schema';
import { exceptionDomainSchema } from './council';
import {
  coachingActionTypeSchema,
  exceptionKindSchema,
  exceptionPrioritySchema,
  exceptionStatusSchema,
  reviewUrgencySchema,
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
  /** Só nos casos de protocolo: obrigatória (sem envio automático) ou opcional (libera no prazo). */
  reviewUrgency: reviewUrgencySchema.nullable(),
  /** Quando o protocolo opcional é liberado sozinho; `null` na revisão obrigatória. */
  autoReleaseAt: iso.nullable(),
  /**
   * Tipo da ação proposta pela IA (ex.: `PUBLISH_TRAINING_PLAN`, `SUBSTITUTE_EXERCISE`), para a
   * Fila dizer em poucas palavras o que está pendente. `null` quando o caso não tem proposta
   * (geração que falhou, troca sem equivalente). Opcional: respostas antigas não trazem.
   */
  actionType: coachingActionTypeSchema.nullish(),
  /** Origem do caso sem proposta (ex.: `SWAP_GAP`, `CYCLE_REASSESSMENT`). */
  source: z.string().max(64).nullish(),
});
export type ExceptionListItem = z.infer<typeof exceptionListItemSchema>;
export const exceptionListResponseSchema = z.array(exceptionListItemSchema);

/**
 * Os casos se dividem em dois painéis: a Fila do Profissional (o que a IA gerou ou mudou no
 * protocolo, e a geração que falhou) e Alertas (todo o resto: segurança, pedido de revisão do
 * aluno, exame, conversa, sem política aplicável).
 */
export const exceptionScopeSchema = z.enum(['QUEUE', 'ALERTS']);
export type ExceptionScope = z.infer<typeof exceptionScopeSchema>;

/** Tipos de caso que moram na Fila do Profissional; os demais são Alertas. */
export const QUEUE_EXCEPTION_KINDS = ['PROTOCOL_REVIEW', 'DECISION_FAILURE'] as const;

export function exceptionScopeOf(kind: string): ExceptionScope {
  return (QUEUE_EXCEPTION_KINDS as readonly string[]).includes(kind) ? 'QUEUE' : 'ALERTS';
}

const countsSchema = z.object({
  open: z.number().int().nonnegative(),
  urgent: z.number().int().nonnegative(),
});
/**
 * Abertos no total e em cada painel (o sino soma os dois; cada menu mostra o seu). `queue` conta
 * ALUNOS distintos (a Fila mostra um cartão por aluno; urgente se qualquer caso dele for);
 * `alerts` conta casos (um item por caso). `urgent` = prioridade `URGENT` ou `HIGH`.
 */
export const exceptionsSummarySchema = countsSchema.extend({
  queue: countsSchema,
  alerts: countsSchema,
});
export type ExceptionsSummary = z.infer<typeof exceptionsSummarySchema>;

/**
 * Respostas da anamnese enviada pelo aluno, na ordem do formulário. `data` é o conteúdo da
 * etapa como o aluno respondeu (já sem a separação comum/cifrada); a tela traduz os rótulos.
 */
export const anamnesisAnswersViewSchema = z.object({
  /** Nome do aluno, para o cabeçalho da leitura (opcional: servidores anteriores não mandam). */
  studentName: z.string().nullable().optional(),
  submittedAt: iso.nullable(),
  flow: z.enum(['INITIAL', 'COMPLEMENTARY']),
  steps: z.array(
    z.object({
      step: z.number().int().min(1).max(9),
      title: z.string(),
      data: z.record(z.string(), z.unknown()),
    }),
  ),
});
export type AnamnesisAnswersView = z.infer<typeof anamnesisAnswersViewSchema>;

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
    /** Referências do caso (proposta, decisão, sinal); `source: 'SWAP_GAP'` = troca sem equivalente. */
    subject: z.record(z.string(), z.string()).optional(),
  }),
  /** Nome dos exercícios citados na proposta ou no caso de troca (id → nome). */
  exerciseNames: z.record(z.string(), z.string()).nullish(),
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
  /** Exame enviado pelo aluno (casos `MEDICAL_EXAM`): leitura e comentário da IA. */
  exam: medicalExamViewSchema.nullish(),
});
export type ExceptionDetail = z.infer<typeof exceptionDetailSchema>;

/** Exercícios do catálogo que a equipe pode escolher para a troca do caso. */
export const swapOptionsResponseSchema = z.object({
  fromExerciseId: z.string(),
  fromName: z.string(),
  options: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type SwapOptions = z.infer<typeof swapOptionsResponseSchema>;

export const substituteForCaseRequestSchema = z.object({ toExerciseId: z.string().min(1).max(80) });

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

/** Arquivo original do exame (PDF ou foto), para o médico conferir a leitura. */
export const exceptionExamFileSchema = z.object({
  mediaType: z.string(),
  base64: z.string(),
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
