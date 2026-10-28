import { createHash } from 'node:crypto';

import { z, type ZodType } from 'zod';

import type { MethodologyDomain, MethodologyParameters } from '@movivo/shared';

import type { ModelTier } from '../ai/ai.types';

export type { MethodologyDomain };

/** Fatias nomeadas do Estado do Aluno que uma tarefa pode ler. */
export type StateSlice =
  | 'identity'
  | 'goals'
  | 'availability'
  | 'restrictions'
  | 'preferences'
  | 'training'
  | 'nutrition'
  | 'body'
  | 'adherence'
  | 'safety'
  | 'recentDecisions';

/** Uma violação encontrada por um validador determinístico. */
export interface Violation {
  /** Caminho no JSON de saída (ex.: `sessions.2.content.exercises.0.exerciseId`). */
  path: string;
  message: string;
}

/** Contexto que os validadores recebem além da entrada e da saída. */
export interface ValidationContext {
  /** Estado do Aluno serializado (mesmas fatias que o modelo viu). */
  state: Record<string, unknown>;
  /** Parâmetros da metodologia que o modelo viu, por domínio. */
  methodology: Partial<Record<MethodologyDomain, MethodologyParameters>>;
}

export type Validator<I, O> = (
  input: I,
  output: O,
  context: ValidationContext,
) => Violation[] | Promise<Violation[]>;

/**
 * Definição de uma tarefa de agente. O prompt é por TAREFA, não por persona: o mesmo agente
 * (ex.: treinador de corrida) tem tarefas diferentes, cada uma com schema, validadores e casos
 * de avaliação próprios.
 */
export interface AgentTask<I, O> {
  /** `<agente>.<tarefa>` (ex.: `running.build_block`). */
  id: string;
  /** Papel do agente (camada 2 do prompt). */
  role: string;
  /** Instrução da tarefa (camada 3 do prompt). */
  instructions: string;
  tier: ModelTier;
  methodology: readonly MethodologyDomain[];
  state: readonly StateSlice[];
  input: ZodType<I>;
  output: ZodType<O>;
  validators: readonly Validator<I, O>[];
  /** Rodadas de correção com o feedback das violações antes de desistir. */
  maxCorrectionRounds: number;
  /** Versão do prompt: hash do papel + instrução + schema de saída (muda se qualquer um mudar). */
  promptVersion: string;
}

export type AgentTaskDefinition<I, O> = Omit<AgentTask<I, O>, 'promptVersion'>;

/** Cria a tarefa calculando a versão do prompt a partir do conteúdo. */
export function defineAgentTask<I, O>(definition: AgentTaskDefinition<I, O>): AgentTask<I, O> {
  const schema = JSON.stringify(z.toJSONSchema(definition.output, { unrepresentable: 'any' }));
  const promptVersion = createHash('sha256')
    .update(`${definition.role}\n---\n${definition.instructions}\n---\n${schema}`)
    .digest('hex')
    .slice(0, 16);
  return { ...definition, promptVersion };
}
