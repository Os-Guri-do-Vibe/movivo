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

/** Como a agente age durante a conversa — distinto de como ela soa (tom de voz). */
export const AgentPersonaTrait = {
  ACOLHE_ANTES_DE_ORIENTAR: 'ACOLHE_ANTES_DE_ORIENTAR',
  EXPLICA_O_PORQUE: 'EXPLICA_O_PORQUE',
  UMA_PERGUNTA_POR_VEZ: 'UMA_PERGUNTA_POR_VEZ',
  FOCA_NO_PROXIMO_PASSO: 'FOCA_NO_PROXIMO_PASSO',
  CELEBRA_PROGRESSO: 'CELEBRA_PROGRESSO',
} as const;
export type AgentPersonaTrait = (typeof AgentPersonaTrait)[keyof typeof AgentPersonaTrait];

export const AgentEmojiPolicy = {
  NENHUM: 'NENHUM',
  RARO: 'RARO',
  MODERADO: 'MODERADO',
} as const;
export type AgentEmojiPolicy = (typeof AgentEmojiPolicy)[keyof typeof AgentEmojiPolicy];

/**
 * Tamanho do bloco de resposta no WhatsApp.
 *
 * Substitui `maxResponseChars` (removido): aquele campo era só uma frase no prompt, sem
 * nenhum ponto de código que a aplicasse — teto declarado, nunca imposto. Aqui o valor
 * escolhido vira (a) instrução de prompt e (b) **teto determinístico pós-LLM**, aplicado
 * na saída do worker antes da entrega. Token de saída custa ~4x o de entrada: um teto que
 * ninguém aplica é custo aberto.
 */
export const AgentBlockSize = {
  CURTO: 'CURTO',
  MEDIO: 'MEDIO',
  LIVRE: 'LIVRE',
} as const;
export type AgentBlockSize = (typeof AgentBlockSize)[keyof typeof AgentBlockSize];

/**
 * Quanto destaque a agente pode usar. `UMA_PALAVRA` é o default: no WhatsApp o negrito é
 * `*assim*` (asterisco simples) — pedir "negrito" sem fixar a sintaxe faz o modelo emitir
 * `**assim**`, que aparece literal na tela do aluno.
 */
export const AgentBoldPolicy = {
  NENHUM: 'NENHUM',
  UMA_PALAVRA: 'UMA_PALAVRA',
  MODERADO: 'MODERADO',
} as const;
export type AgentBoldPolicy = (typeof AgentBoldPolicy)[keyof typeof AgentBoldPolicy];

/** Ciclo de vida de um tema proibido (`ai_forbidden_topics`). Tabela append-only. */
export const ForbiddenTopicStatus = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  RETIRED: 'RETIRED',
} as const;
export type ForbiddenTopicStatus = (typeof ForbiddenTopicStatus)[keyof typeof ForbiddenTopicStatus];

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
