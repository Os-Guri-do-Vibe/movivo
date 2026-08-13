/**
 * Espaço de valores da configuração da agente de IA (US-7.6 / Épico 10).
 *
 * Tudo aqui é **lista fechada** de propósito: enquanto o simulador de configuração
 * (Sprint 9) não existir, a única edição segura de persona é a que tem espaço de
 * valores finito — ENUM e faixa numérica, nunca textarea livre. É essa restrição
 * que impede que alguém com login no painel injete instrução no prompt da IA.
 */

/** Ciclo de vida de uma linha de `agent_config`. A tabela é append-only: nunca há UPDATE. */
export const AgentConfigStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type AgentConfigStatus = (typeof AgentConfigStatus)[keyof typeof AgentConfigStatus];

/** Descritores de tom — no máximo 4 selecionados por configuração. */
export const AgentToneDescriptor = {
  CALOROSO: 'caloroso',
  DIRETO: 'direto',
  BEM_HUMORADO: 'bem-humorado',
  TECNICO: 'tecnico',
  MOTIVACIONAL: 'motivacional',
  SEM_HYPE: 'sem_hype',
  INFORMAL: 'informal',
  FORMAL: 'formal',
} as const;
export type AgentToneDescriptor = (typeof AgentToneDescriptor)[keyof typeof AgentToneDescriptor];

export const AgentEmojiPolicy = {
  NENHUM: 'NENHUM',
  RARO: 'RARO',
  MODERADO: 'MODERADO',
} as const;
export type AgentEmojiPolicy = (typeof AgentEmojiPolicy)[keyof typeof AgentEmojiPolicy];

/** Como a agente trata o aluno. `TU` existe para regionalização (Sul/Nordeste). */
export const AgentTreatment = {
  VOCE: 'VOCE',
  TU: 'TU',
} as const;
export type AgentTreatment = (typeof AgentTreatment)[keyof typeof AgentTreatment];

/** Camada de configuração (Victor §modelo de 3 camadas) — dirige o cadeado na UI. */
export const PromptLayer = {
  /** Travado em código. Visível na UI, nunca editável. */
  L0: 'L0',
  /** Editável só com aprovação + simulador (Sprint 9). Nada de L1 nesta fase. */
  L1: 'L1',
  /** Editável direto pelo painel, publica na hora. */
  L2: 'L2',
} as const;
export type PromptLayer = (typeof PromptLayer)[keyof typeof PromptLayer];
