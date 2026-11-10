/** Revisão do protocolo (plano de treino ou alimentar) na fila de exceções, antes de chegar ao aluno. */
import { z } from 'zod';

import { weekdaySchema } from '../anamnesis.schema';
import { nutritionPlanStructureSchema } from '../nutrition/nutrition.schema';
import { goalStrategySchema } from '../student/goal.schema';
import { sessionModalitySchema } from '../training/modality.schema';
import {
  daySlotSchema,
  planStatusSchema,
  sessionPrioritySchema,
  trainingPlanStructureSchema,
} from '../training/plan.schema';

/** Simulação da primeira semana: o mesmo planejador da ativação, a partir de hoje no fuso do aluno. */
export const protocolWeekPreviewSchema = z.object({
  weekStart: z.iso.date(),
  startsOn: z.iso.date(),
  sessions: z.array(
    z.object({
      date: z.iso.date(),
      slot: daySlotSchema,
      sessionKey: z.string(),
      occurrence: z.number().int(),
      title: z.string(),
      modality: sessionModalitySchema,
      priority: sessionPrioritySchema,
    }),
  ),
  /** Ocorrências que não couberam na semana, com o motivo. */
  dropped: z.array(z.object({ sessionKey: z.string(), title: z.string(), reason: z.string() })),
});
export type ProtocolWeekPreview = z.infer<typeof protocolWeekPreviewSchema>;

/**
 * Semana-modelo do protocolo: onde cada ocorrência cai numa semana inteira (segunda a domingo),
 * sem o corte do dia de início. É a base da edição por dia da semana; as semanas seguintes ao
 * início seguem este desenho.
 */
export const protocolWeekModelSchema = z.object({
  sessions: z.array(
    z.object({
      weekday: weekdaySchema,
      slot: daySlotSchema,
      sessionKey: z.string(),
      occurrence: z.number().int(),
    }),
  ),
  /** Ocorrências que não couberam na semana do aluno, com o motivo. */
  dropped: z.array(
    z.object({ sessionKey: z.string(), occurrence: z.number().int(), reason: z.string() }),
  ),
});
export type ProtocolWeekModel = z.infer<typeof protocolWeekModelSchema>;

export const protocolStrategySchema = goalStrategySchema.pick({
  title: true,
  modalityFocus: true,
  energyStrategy: true,
  studentMessage: true,
});

const protocolBase = {
  planId: z.uuid(),
  version: z.number().int(),
  status: planStatusSchema,
  /** Rascunho ainda em revisão, caso aberto e profissional do domínio com registro ativo. */
  editable: z.boolean(),
  strategy: protocolStrategySchema.nullable(),
  /** Início do protocolo: o do plano ativo; no rascunho, hoje (a aprovação ativa a partir do dia). */
  startsOn: z.iso.date(),
};

export const protocolReviewSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('TRAINING'),
    ...protocolBase,
    structure: trainingPlanStructureSchema,
    weekPreview: protocolWeekPreviewSchema,
    /** Ausente em servidor anterior à edição por dia da semana. */
    weekModel: protocolWeekModelSchema.optional(),
    /**
     * Exercícios de força seguros e viáveis para este aluno (catálogo publicado): as opções para
     * trocar ou adicionar na edição. Grupos musculares e equipamento (em português, como no
     * catálogo; `[]` = peso do corpo) servem aos filtros da busca; opcionais por compatibilidade.
     */
    exerciseOptions: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        measurement: z.enum(['REPS', 'DURATION']),
        muscleGroups: z.array(z.string()).optional(),
        equipment: z.array(z.string()).optional(),
      }),
    ),
  }),
  z.object({
    kind: z.literal('NUTRITION'),
    ...protocolBase,
    structure: nutritionPlanStructureSchema,
    /** Alimentos que a equipe pode usar ao editar o cardápio (já sem restrição e alergia do aluno). */
    foodOptions: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          category: z.string(),
          energyKcal: z.number(),
          proteinG: z.number(),
          carbsG: z.number(),
          fatG: z.number(),
        }),
      )
      .optional(),
  }),
]);
export type ProtocolReview = z.infer<typeof protocolReviewSchema>;

/** Edição manual do rascunho: a estrutura completa, do mesmo tipo do protocolo do caso. */
export const editProtocolRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TRAINING'), structure: trainingPlanStructureSchema }),
  z.object({ kind: z.literal('NUTRITION'), structure: nutritionPlanStructureSchema }),
]);
export type EditProtocolRequest = z.infer<typeof editProtocolRequestSchema>;

/** Pedido de ajuste aos agentes: a orientação do profissional entra na entrada das tarefas. */
export const protocolAdjustmentRequestSchema = z.object({
  instruction: z.string().trim().min(1).max(1_000),
});
export type ProtocolAdjustmentRequest = z.infer<typeof protocolAdjustmentRequestSchema>;

export const protocolAdjustmentResponseSchema = z.object({
  id: z.uuid(),
  status: z.literal('RESOLVED'),
  outcome: z.literal('ADJUSTMENT_REQUESTED'),
});

/**
 * Regerar o protocolo do zero (`POST /control-center/exceptions/:id/regenerate`, sem corpo): a
 * proposta atual é descartada sem chegar ao aluno, o caso fecha e os agentes geram outro protocolo
 * do mesmo tipo, sem orientação do profissional. O novo chega à Fila como um caso novo. Repetir o
 * pedido no mesmo caso devolve a mesma resposta (uma geração só).
 */
export const protocolRegenerationResponseSchema = z.object({
  id: z.uuid(),
  status: z.literal('RESOLVED'),
  outcome: z.literal('REGENERATION_REQUESTED'),
});
export type ProtocolRegenerationResponse = z.infer<typeof protocolRegenerationResponseSchema>;
