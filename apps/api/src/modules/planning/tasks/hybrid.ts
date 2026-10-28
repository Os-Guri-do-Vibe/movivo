/**
 * Tarefa `hybrid.reconcile_week` — o planejador híbrido.
 *
 * Recebe os blocos de cada modalidade e o esporte que o aluno já pratica e devolve UM plano que
 * cabe na semana real: ajusta frequências, prioridades e fases, mas nunca reescreve o conteúdo
 * das sessões. A prova de que o plano cabe é determinística (`checkTrainingPlan`).
 */
import { z } from 'zod';

import {
  coachedModalitySchema,
  planSessionSchema,
  trainingPlanStructureSchema,
  type PlanSession,
  type TrainingPlanStructure,
} from '@movivo/shared';

import { defineAgentTask, type Validator, type Violation } from '../../../core/agents/agent-task';
import { checkTrainingPlan, type PlanCheckContext } from '../calc/plan-check';
import { hybridRules, runningRules } from '../calc/params';
import { blockOutputSchema } from './blocks';
import { outputLanguageViolations } from './common';

export const hybridInputSchema = z.object({
  blocks: z
    .array(
      z.object({
        modality: coachedModalitySchema,
        priority: z.number().int().min(1).max(3),
        block: blockOutputSchema,
      }),
    )
    .min(1)
    .max(3),
  /** Sessões de esporte externo (já montadas pelo código): entram no plano sem alteração. */
  externalSessions: z.array(planSessionSchema).max(3),
  availability: z.object({
    maxSessionsPerWeek: z.number().int().min(1).max(14),
    windows: z
      .array(
        z.object({
          weekday: z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']),
          slot: z.enum(['MORNING', 'AFTERNOON', 'EVENING', 'ANY']),
          maxMinutes: z.number().int(),
        }),
      )
      .max(21),
    /** Dias fixos do esporte externo por chave de sessão. */
    externalFixedDays: z.record(
      z.string(),
      z.array(z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])),
    ),
  }),
  recentWeeklyLoad: z.number().nullable(),
  startsOn: z.iso.date(),
  runningLevel: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
});
export type HybridInput = z.infer<typeof hybridInputSchema>;

export const hybridOutputSchema = trainingPlanStructureSchema;
export type HybridOutput = TrainingPlanStructure;

export function planCheckContext(
  input: HybridInput,
  params: Parameters<typeof hybridRules>[0],
  runningParams: Parameters<typeof runningRules>[0],
): PlanCheckContext {
  return {
    windows: input.availability.windows,
    maxSessionsPerWeek: input.availability.maxSessionsPerWeek,
    externalFixedDays: input.availability.externalFixedDays,
    focus: input.blocks.map((b) => b.modality),
    rules: hybridRules(params),
    minEasyDaysBetweenIntense: Math.max(
      0,
      runningRules(runningParams, input.runningLevel).minEasyDaysBetweenQuality ?? 1,
    ),
    recentWeeklyLoad: input.recentWeeklyLoad,
    startsOn: input.startsOn,
  };
}

const sameContent = (a: PlanSession, b: PlanSession) =>
  JSON.stringify(a.content) === JSON.stringify(b.content);

export const hybridValidators: Validator<HybridInput, HybridOutput>[] = [
  // Conteúdo das sessões é imutável; esporte externo entra inteiro; nada de sessão inventada.
  (input, output) => {
    const violations: Violation[] = [];
    const original = new Map<string, PlanSession>();
    for (const { block } of input.blocks) for (const s of block.sessions) original.set(s.key, s);
    for (const s of input.externalSessions) original.set(s.key, s);

    output.sessions.forEach((session, index) => {
      const source = original.get(session.key);
      if (!source) {
        violations.push({
          path: `sessions.${index}.key`,
          message: `a sessão "${session.key}" não existe nos blocos recebidos`,
        });
        return;
      }
      if (!sameContent(session, source)) {
        violations.push({
          path: `sessions.${index}.content`,
          message: `o conteúdo da sessão "${session.key}" não pode ser alterado (ajuste frequência, prioridade ou fases)`,
        });
      }
      if (session.weeklyFrequency > source.weeklyFrequency) {
        violations.push({
          path: `sessions.${index}.weeklyFrequency`,
          message: `a frequência de "${session.key}" não pode aumentar (veio ${source.weeklyFrequency})`,
        });
      }
    });
    for (const external of input.externalSessions) {
      const placed = output.sessions.find((s) => s.key === external.key);
      if (!placed) {
        violations.push({
          path: 'sessions',
          message: `o esporte externo "${external.key}" precisa continuar no plano`,
        });
      } else if (placed.weeklyFrequency !== external.weeklyFrequency) {
        violations.push({
          path: 'sessions',
          message: `a frequência do esporte externo "${external.key}" não é negociável`,
        });
      }
    }
    return violations;
  },

  // O plano cabe na semana do aluno e respeita as regras de interferência.
  (input, output, context) =>
    checkTrainingPlan(
      output,
      planCheckContext(input, context.methodology.HYBRID, context.methodology.RUNNING),
    ),

  (_input, output) => outputLanguageViolations(output),
];

export const hybridTask = defineAgentTask<HybridInput, HybridOutput>({
  id: 'hybrid.reconcile_week',
  role: 'Planejador híbrido da MOVIVO. Você junta musculação, corrida, HYROX e o esporte que o aluno já pratica num único plano que cabe na semana real dele, controlando fadiga e interferência entre as modalidades.',
  instructions: `Reconcilie os blocos recebidos num plano único e viável.

Regras:
1. NÃO reescreva o conteúdo das sessões: cada sessão mantém o "key" e o "content" recebidos. Você pode reduzir "weeklyFrequency", mudar "priority", ajustar estimatedRpe/estimatedMinutes de forma coerente e escolher o que sai quando a semana não comporta.
2. Esporte externo (externalSessions) entra no plano exatamente como veio; os dias fixos dele não mudam. O MOVIVO planeja EM VOLTA dele.
3. Respeite as regras de interferência da metodologia HYBRID: espaço entre inferiores pesados e corrida intensa, teto de sessões intensas na semana (contando o esporte externo), dias de descanso, no máximo uma sessão por dia (salvo se a metodologia permitir). Quando algo precisar sair, corte primeiro as complementares, depois as importantes; sessão-chave só sai em último caso.
4. Não passe de "maxSessionsPerWeek" sessões próprias por semana e garanta que cada modalidade em foco mantém ao menos uma sessão.
5. modalityPriorities: reflita a prioridade recebida de cada modalidade (1 = principal). phases: organize o plano em fases coerentes, com semanas de recuperação quando a metodologia pedir. summary: 3 a 4 frases claras que expliquem como as modalidades convivem na semana, sem prometer resultado.
6. Nunca "compense" sessão perdida empilhando treinos; a semana é o que cabe.`,
  tier: 'REASONING',
  methodology: ['HYBRID', 'RUNNING'],
  state: ['goals', 'availability', 'training'],
  input: hybridInputSchema,
  output: hybridOutputSchema,
  validators: hybridValidators,
  maxCorrectionRounds: 2,
});
