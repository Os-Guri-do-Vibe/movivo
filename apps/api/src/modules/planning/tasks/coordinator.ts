/**
 * Tarefa `coordination.review_protocol` — o coordenador dos especialistas.
 *
 * Lê o protocolo inteiro (estratégia, treino e alimentação) junto do Estado do Aluno e devolve
 * um parecer estruturado: o que cada área observa, os conflitos entre as partes (resolvidos pela
 * hierarquia segurança > medicina > recuperação > nutrição > modalidades > preferências) e, se
 * preciso, UMA instrução de ajuste por parte. Não reescreve nada: quem refaz é o especialista.
 */
import { z } from 'zod';

import {
  energyStrategySchema,
  sessionModalitySchema,
  sessionPrioritySchema,
  type NutritionPlanStructure,
  type TrainingPlanStructure,
} from '@movivo/shared';

import { defineAgentTask, type Validator, type Violation } from '../../../core/agents/agent-task';
import { isIntense } from '../calc/load';
import { sessionLines } from '../plan-pdf';
import { outputLanguageViolations } from './common';

/** Ordem de precedência quando duas áreas divergem (a primeira prevalece). */
export const COORDINATION_HIERARCHY = [
  'SAFETY',
  'MEDICAL',
  'RECOVERY',
  'NUTRITION',
  'MODALITIES',
  'PREFERENCES',
] as const;
const areaSchema = z.enum(COORDINATION_HIERARCHY);

const targetsSchema = z.object({
  kcalMin: z.number(),
  kcalMax: z.number(),
  proteinG: z.number(),
  carbsG: z.number(),
});

export const coordinatorInputSchema = z.object({
  strategy: z.object({
    title: z.string(),
    energyStrategy: energyStrategySchema,
    modalityFocus: z.array(z.string()).max(3),
  }),
  training: z.object({
    summary: z.string(),
    sessions: z
      .array(
        z.object({
          key: z.string(),
          title: z.string(),
          modality: sessionModalitySchema,
          priority: sessionPrioritySchema,
          weeklyFrequency: z.number().int(),
          estimatedMinutes: z.number().int(),
          estimatedRpe: z.number(),
          intense: z.boolean(),
          details: z.array(z.string()).max(20),
        }),
      )
      .max(14),
  }),
  nutrition: z.object({
    strategy: energyStrategySchema,
    summary: z.string(),
    trainingDay: targetsSchema,
    restDay: targetsSchema,
    meals: z.number().int(),
  }),
});
export type CoordinatorInput = z.infer<typeof coordinatorInputSchema>;

export const coordinatorOutputSchema = z.object({
  verdict: z.enum(['COHERENT', 'ADJUST']),
  opinions: z
    .array(z.object({ area: areaSchema, observation: z.string().trim().min(1).max(300) }))
    .max(8),
  conflicts: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(300),
        prevails: areaSchema,
        yields: areaSchema,
      }),
    )
    .max(5),
  adjustments: z
    .array(
      z.object({
        target: z.enum(['TRAINING', 'NUTRITION']),
        instruction: z.string().trim().min(10).max(600),
      }),
    )
    .max(2),
  professionalNote: z.string().trim().min(1).max(600),
});
export type CoordinatorOutput = z.infer<typeof coordinatorOutputSchema>;

const rank = (area: (typeof COORDINATION_HIERARCHY)[number]) =>
  COORDINATION_HIERARCHY.indexOf(area);

export const coordinatorValidators: Validator<CoordinatorInput, CoordinatorOutput>[] = [
  (_input, output) =>
    output.conflicts.flatMap((c, i): Violation[] =>
      rank(c.prevails) < rank(c.yields)
        ? []
        : [
            {
              path: `conflicts.${i}`,
              message: `pela hierarquia, ${c.yields} prevalece sobre ${c.prevails}; inverta ou reveja o conflito`,
            },
          ],
    ),
  (_input, output) => {
    const violations: Violation[] = [];
    if ((output.verdict === 'ADJUST') !== output.adjustments.length > 0) {
      violations.push({
        path: 'verdict',
        message: 'use ADJUST só com ao menos um ajuste, e COHERENT sem nenhum',
      });
    }
    const targets = output.adjustments.map((a) => a.target);
    if (new Set(targets).size !== targets.length) {
      violations.push({ path: 'adjustments', message: 'no máximo um ajuste por parte' });
    }
    return violations;
  },
  (_input, output) => outputLanguageViolations(output),
];

export const coordinatorTask = defineAgentTask<CoordinatorInput, CoordinatorOutput>({
  id: 'coordination.review_protocol',
  role: 'Coordenador dos especialistas de IA da MOVIVO. Você garante que treino e alimentação formem um protocolo único, seguro e coerente para a pessoa, antes da revisão dos profissionais.',
  instructions: `Revise o protocolo recebido (estratégia, treino e alimentação) à luz do Estado do Aluno.

Regras:
1. opinions: uma observação curta por área relevante (SAFETY, MEDICAL, RECOVERY, NUTRITION, MODALITIES, PREFERENCES). Só o que importa para esta pessoa.
2. conflicts: divergências concretas entre as partes ou com o Estado do Aluno (ex.: exercício que agrava uma dor registrada; energia baixa demais para o volume de treino; sessões intensas sem recuperação). Em cada conflito, "prevails" é a área que vence pela hierarquia SAFETY > MEDICAL > RECOVERY > NUTRITION > MODALITIES > PREFERENCES e "yields" a que cede.
3. adjustments: só quando há problema concreto. No máximo um por parte (TRAINING ou NUTRITION), com uma instrução curta, específica e acionável para o especialista refazer aquela parte. Nada de pedir ajuste por gosto ou estilo.
4. verdict: ADJUST se houver ajuste; COHERENT se não houver.
5. professionalNote: 1 a 3 frases para o profissional que vai revisar, com o que merece atenção.
6. Sem diagnosticar, sem prometer resultado; você não prescreve, aponta. Se o Estado trouxer "bodyComposition" com "muscleGroups" e "posture" (avaliação física por foto), confira se o treino cobre os grupos a desenvolver e respeita a assimetria observada; alinhamento alterado vai na "professionalNote" como leitura da IA para o profissional que audita, nunca como conflito de segurança nem diagnóstico.
7. COHERENT é o padrão quando não há conflito concreto nos dados fornecidos. Uma alternativa de otimização, preferência ou estilo não é motivo para ADJUST. Só peça ajuste se apontar o campo específico que viola uma restrição do aluno, a hierarquia ou a própria coerência entre estratégia, treino e alimentação.`,
  tier: 'REASONING',
  methodology: ['HYBRID', 'NUTRITION'],
  state: ['identity', 'goals', 'restrictions', 'preferences', 'body', 'bodyComposition', 'safety'],
  input: coordinatorInputSchema,
  output: coordinatorOutputSchema,
  validators: coordinatorValidators,
  maxCorrectionRounds: 2,
});

/** Resumo compacto do protocolo para o coordenador (o código monta, o modelo só lê). */
export function coordinatorInputOf(
  strategy: CoordinatorInput['strategy'],
  training: TrainingPlanStructure,
  nutrition: NutritionPlanStructure,
): CoordinatorInput {
  const targets = (t: NutritionPlanStructure['trainingDay']) => ({
    kcalMin: t.energyKcal.min,
    kcalMax: t.energyKcal.max,
    proteinG: t.proteinG,
    carbsG: t.carbsG,
  });
  return {
    strategy,
    training: {
      summary: training.summary,
      sessions: training.sessions.map((s) => ({
        key: s.key,
        title: s.title,
        modality: s.content.modality,
        priority: s.priority,
        weeklyFrequency: s.weeklyFrequency,
        estimatedMinutes: s.estimatedMinutes,
        estimatedRpe: s.estimatedRpe,
        intense: isIntense(s),
        details: sessionLines(s).slice(0, 20),
      })),
    },
    nutrition: {
      strategy: nutrition.strategy,
      summary: nutrition.summary,
      trainingDay: targets(nutrition.trainingDay),
      restDay: targets(nutrition.restDay),
      meals: nutrition.meals.length,
    },
  };
}
