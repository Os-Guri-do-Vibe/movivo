import { z } from 'zod';

import { goalMilestoneSchema, goalStrategySchema } from '../student/goal.schema';
import { nutritionPlanStructureSchema } from '../nutrition/nutrition.schema';
import {
  daySlotSchema,
  scheduledSessionStatusSchema,
  trainingPlanStructureSchema,
} from '../training/plan.schema';
import { sessionModalitySchema } from '../training/modality.schema';

/**
 * Leitura pública do plano do aluno (`/plano/[token]`): estratégia explicada, metas, semana
 * agendada, treino e nutrição vigentes. Não carrega dado pessoal nem de saúde — o acesso é por
 * credencial opaca, expirável e revogável.
 */
export const planReadSchema = z.object({
  /** Primeiro nome, para a saudação (nunca nome completo, telefone ou e-mail). */
  firstName: z.string().nullable(),
  strategy: goalStrategySchema.nullable(),
  milestones: z.array(
    z.object({
      milestone: goalMilestoneSchema,
      dueOn: z.iso.date(),
      status: z.enum(['PENDING', 'ACHIEVED', 'MISSED', 'REVISED']),
    }),
  ),
  tasks: z.array(
    z.object({
      title: z.string(),
      target: z.number(),
      progress: z.number(),
      windowEnd: z.iso.date(),
      status: z.enum(['OPEN', 'DONE', 'MISSED', 'CANCELED']),
    }),
  ),
  training: z
    .object({
      version: z.number().int(),
      startsOn: z.iso.date(),
      structure: trainingPlanStructureSchema,
      /** Sessões agendadas dos próximos dias (hoje em diante). */
      upcoming: z.array(
        z.object({
          date: z.iso.date(),
          slot: daySlotSchema,
          status: scheduledSessionStatusSchema,
          planSessionKey: z.string(),
          title: z.string(),
          modality: sessionModalitySchema,
          minutes: z.number().int(),
        }),
      ),
    })
    .nullable(),
  nutrition: z
    .object({
      version: z.number().int(),
      startsOn: z.iso.date(),
      structure: nutritionPlanStructureSchema,
    })
    .nullable(),
});
export type PlanRead = z.infer<typeof planReadSchema>;
