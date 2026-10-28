/**
 * Tarefa `goals.define_strategy` — o Motor de Objetivos.
 *
 * Transforma o objetivo DECLARADO numa estratégia explicada: o que o aluno pede nem sempre é o
 * caminho (ex.: "ganhar massa" com adiposidade alta pede recomposição, não superávit). O modelo
 * escolhe e justifica; os validadores impedem o que a segurança e a metodologia proíbem.
 */
import { z } from 'zod';

import {
  coachedModalitySchema,
  declaredGoalSchema,
  goalMilestoneSchema,
  goalStrategySchema,
  goalTaskSchema,
  type CoachedModality,
  type DeclaredGoalKind,
} from '@movivo/shared';

import { defineAgentTask, type Validator } from '../../../core/agents/agent-task';
import { energyRestrictionBlocked, outputLanguageViolations } from './common';

export const strategyInputSchema = z.object({
  declared: declaredGoalSchema,
  /** Modalidades que o aluno pratica ou quer começar, com o nível. */
  modalities: z
    .array(
      z.object({
        modality: coachedModalitySchema,
        level: z.enum(['NONE', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
        wantsToStart: z.boolean(),
      }),
    )
    .min(1)
    .max(3),
  /** Sinais calculados pelo código (o agente não recalcula nem contradiz). */
  derived: z.object({
    adiposity: z.enum(['LOW', 'MODERATE', 'HIGH', 'UNKNOWN']),
    bmi: z.number().nullable(),
    weeksToEvent: z.number().int().min(0).nullable(),
    hasExternalSport: z.boolean(),
    sessionsPerWeekAvailable: z.number().int().min(1).max(14),
  }),
});
export type StrategyInput = z.infer<typeof strategyInputSchema>;

export const strategyOutputSchema = z.object({
  strategy: goalStrategySchema,
  milestones: z.array(goalMilestoneSchema).min(1).max(6),
  tasks: z.array(goalTaskSchema).min(1).max(6),
  /** Explicação para o aluno, em português claro: o que vamos fazer e por quê. */
  studentMessage: z.string().trim().min(1).max(800),
  /** Nota objetiva para o profissional que revisar o caso. */
  professionalNote: z.string().trim().min(1).max(500),
});
export type StrategyOutput = z.infer<typeof strategyOutputSchema>;

/** Modalidade que o objetivo declarado exige estar no foco. */
const REQUIRED_MODALITY: Partial<Record<DeclaredGoalKind, CoachedModality>> = {
  RUNNING_PERFORMANCE: 'RUNNING',
  RACE_PREPARATION: 'RUNNING',
  HYROX_PREPARATION: 'HYROX',
};

const BODY_COMPOSITION_GOALS: readonly DeclaredGoalKind[] = [
  'HYPERTROPHY',
  'STRENGTH',
  'BODY_DEFINITION',
  'FAT_LOSS',
];

const isEnergyRestrictive = (strategy: string) =>
  strategy === 'DEFICIT' || strategy === 'RECOMPOSITION';

export const strategyValidators: Validator<StrategyInput, StrategyOutput>[] = [
  // Indicadores únicos e marcos que apontam para indicadores existentes.
  (_input, output) => {
    const keys = output.strategy.indicators.map((i) => i.key);
    const violations = [];
    if (new Set(keys).size !== keys.length) {
      violations.push({ path: 'strategy.indicators', message: 'há indicadores com a mesma chave' });
    }
    output.milestones.forEach((m, index) => {
      if (!keys.includes(m.indicatorKey)) {
        violations.push({
          path: `milestones.${index}.indicatorKey`,
          message: `"${m.indicatorKey}" não está entre os indicadores da estratégia`,
        });
      }
    });
    return violations;
  },

  // O foco cobre o que o objetivo exige e só usa modalidades que o aluno pratica ou quer começar.
  (input, output) => {
    const violations = [];
    const allowed = new Set(input.modalities.map((m) => m.modality));
    const required = REQUIRED_MODALITY[input.declared.primary];
    if (required && !output.strategy.modalityFocus.includes(required)) {
      violations.push({
        path: 'strategy.modalityFocus',
        message: `o objetivo principal exige ${required} no foco`,
      });
    }
    output.strategy.modalityFocus.forEach((m, index) => {
      if (!allowed.has(m)) {
        violations.push({
          path: `strategy.modalityFocus.${index}`,
          message: `${m} não é uma modalidade que o aluno pratica ou quer começar`,
        });
      }
    });
    return violations;
  },

  // Coerência energética: a estratégia nunca contradiz a segurança nem a composição corporal.
  (input, output, context) => {
    const violations = [];
    const energy = output.strategy.energyStrategy;
    const blocked = energyRestrictionBlocked(context.state);
    if (blocked && isEnergyRestrictive(energy)) {
      violations.push({
        path: 'strategy.energyStrategy',
        message: `com ${blocked}, a estratégia não pode restringir energia (use manutenção ou combustível para performance)`,
      });
    }
    if (input.derived.bmi !== null && input.derived.bmi < 18.5 && isEnergyRestrictive(energy)) {
      violations.push({
        path: 'strategy.energyStrategy',
        message: 'IMC abaixo de 18,5: sem restrição energética',
      });
    }
    const { primary } = input.declared;
    if (
      (primary === 'HYPERTROPHY' || primary === 'STRENGTH') &&
      input.derived.adiposity === 'HIGH' &&
      energy !== 'RECOMPOSITION' &&
      !blocked
    ) {
      violations.push({
        path: 'strategy.energyStrategy',
        message:
          'objetivo de massa/força com adiposidade alta pede RECOMPOSITION (superávit não é o caminho)',
      });
    }
    if (primary === 'FAT_LOSS' && energy === 'SURPLUS') {
      violations.push({
        path: 'strategy.energyStrategy',
        message: 'perder gordura não combina com superávit',
      });
    }
    if (
      (primary === 'HYPERTROPHY' || primary === 'STRENGTH') &&
      input.derived.adiposity === 'LOW' &&
      energy === 'DEFICIT'
    ) {
      violations.push({
        path: 'strategy.energyStrategy',
        message: 'massa/força com adiposidade baixa não pede déficit',
      });
    }
    if (
      input.derived.weeksToEvent !== null &&
      input.derived.weeksToEvent <= 4 &&
      energy === 'DEFICIT'
    ) {
      violations.push({
        path: 'strategy.energyStrategy',
        message: 'a menos de 4 semanas da prova não se começa déficit',
      });
    }
    if (
      input.declared.targetEvent &&
      BODY_COMPOSITION_GOALS.every((g) => g !== primary) &&
      energy === 'DEFICIT' &&
      input.declared.emphasis === 'PERFORMANCE'
    ) {
      violations.push({
        path: 'strategy.energyStrategy',
        message: 'foco em desempenho com prova marcada pede combustível para performance',
      });
    }
    return violations;
  },

  // Prazos coerentes com a prova e com a capacidade de acompanhar.
  (input, output) => {
    const violations = [];
    const horizon = input.derived.weeksToEvent;
    if (horizon !== null && output.strategy.reviewAfterWeeks > Math.max(2, horizon)) {
      violations.push({
        path: 'strategy.reviewAfterWeeks',
        message: `a revisão (${output.strategy.reviewAfterWeeks} sem.) não pode vir depois da prova (${horizon} sem.)`,
      });
    }
    output.milestones.forEach((m, index) => {
      if (horizon !== null && m.dueInWeeks > Math.max(1, horizon)) {
        violations.push({
          path: `milestones.${index}.dueInWeeks`,
          message: 'marco depois da data da prova',
        });
      }
    });
    output.tasks.forEach((task, index) => {
      if (task.kind === 'COMPLETE_SESSIONS' && task.cadence === 'WEEKLY') {
        if (task.target > input.derived.sessionsPerWeekAvailable) {
          violations.push({
            path: `tasks.${index}.target`,
            message: `meta de ${task.target} sessões/semana acima da disponibilidade (${input.derived.sessionsPerWeekAvailable})`,
          });
        }
      }
    });
    return violations;
  },

  // Texto para o aluno e para o profissional respeita os guardrails de linguagem.
  (_input, output) => outputLanguageViolations(output),
];

export const strategyTask = defineAgentTask<StrategyInput, StrategyOutput>({
  id: 'goals.define_strategy',
  role: 'Arquiteto de objetivos da MOVIVO. Você traduz o que o aluno quer no caminho mais seguro e eficaz para chegar lá, escolhendo a estratégia energética e as modalidades em foco e definindo como medir o progresso.',
  instructions: `Defina a ESTRATÉGIA do aluno a partir do objetivo declarado, do Estado do Aluno e dos sinais calculados em "derived".

Como decidir:
1. Comece pelo objetivo declarado e pela ênfase (estética, desempenho, saúde). Depois confronte com a realidade: adiposidade, prova marcada, disponibilidade, experiência, histórico e segurança.
2. Energia: use DEFICIT para perder gordura; SURPLUS só para ganhar massa com adiposidade baixa/moderada; RECOMPOSITION para quem quer massa/força mas tem adiposidade alta (ou quer perder gordura sem perder força); MAINTENANCE para manter; PERFORMANCE_FUELING quando há prova ou foco em desempenho. Com sinais de transtorno alimentar, gestação ou IMC baixo, nunca restrinja energia.
3. modalityFocus: inclua o que o objetivo exige e, no máximo, três modalidades, todas entre as que o aluno pratica ou quer começar. Esporte externo entra como contexto do plano, não como foco.
4. Indicadores: poucos, mensuráveis e ligados ao objetivo (ex.: cintura, peso, desempenho em sessão-chave, aderência). Marcos: verificáveis, com prazo realista; a menos de uma prova, nunca depois dela.
5. Microtarefas: ações pequenas e semanais/diárias que o aluno controla (sessões concluídas, registro de refeições, medidas). Não passe da disponibilidade informada.
6. rationale: explique por que esta estratégia e não a leitura literal do objetivo. Em openQuestions, diga o que ainda falta saber (ex.: % de gordura, histórico de lesões) — não finja certeza.
7. studentMessage: 3 a 5 frases, linguagem direta e acolhedora, sem jargão, sem culpa, sem comparação com outras pessoas, sem prometer resultado. professionalNote: o que o profissional precisa saber para revisar.`,
  tier: 'REASONING',
  methodology: ['NUTRITION', 'HYBRID', 'SAFETY'],
  state: ['identity', 'goals', 'availability', 'body', 'preferences', 'safety', 'training'],
  input: strategyInputSchema,
  output: strategyOutputSchema,
  validators: strategyValidators,
  maxCorrectionRounds: 2,
});
