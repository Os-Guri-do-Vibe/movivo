import type { MethodologyDomain, StateSlice } from './agent-task';

/** Metodologia renderizada para o prompt, com as versões usadas (vão para a auditoria). */
export interface MethodologyContext {
  text: string;
  versions: Partial<Record<MethodologyDomain, number>>;
}

/** Fatias do Estado do Aluno serializadas, com a versão lida (controle otimista). */
export interface StateContext {
  slices: Partial<Record<StateSlice, unknown>>;
  version: number;
}

/**
 * De onde o runner tira o contexto de uma execução. Em produção, o Estado do Aluno vem do banco e
 * a metodologia da versão publicada; na avaliação, ambos vêm do caso de teste.
 */
export interface AgentContextSources {
  methodology(domains: readonly MethodologyDomain[]): Promise<MethodologyContext>;
  state(slices: readonly StateSlice[]): Promise<StateContext>;
}

/**
 * Metodologia publicada pelos profissionais (implementada pelo estúdio de metodologia). Opcional
 * para quem consome: sem ela, a avaliação usa só o texto que o próprio caso traz.
 */
export interface PublishedMethodology {
  render(domains: readonly MethodologyDomain[]): Promise<MethodologyContext>;
}
export const PUBLISHED_METHODOLOGY = Symbol('MOVIVO_PUBLISHED_METHODOLOGY');
