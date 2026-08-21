/**
 * Contrato da configuração da agente de IA (US-7.6 / TASK-7.6.2).
 *
 * O payload publicado pelo painel é validado por este schema **na gravação** (API) e
 * **na leitura** (`PromptResolverService`) — uma linha que não valida na leitura é
 * tratada como ausente e o serviço cai para o default de código. Por isso o schema
 * mora aqui, e não em `apps/api`: `apps/web` monta o formulário a partir dele.
 *
 * ⚠️ Este schema NÃO substitui a checagem de `INJECTION_PATTERNS`: `agentSelfIntro` é o
 * único campo de texto livre e passa pelo detector de injeção na API antes de gravar.
 */
import { z } from 'zod';

import {
  AgentBlockSize,
  AgentBoldPolicy,
  AgentConfigStatus,
  AgentEmojiPolicy,
  AgentPersonaTrait,
  AgentToneDescriptor,
  PromptLayer,
} from '../enums/agent-config';
import { controlCenterMetaSchema } from './control-center.schema';
import { faqCandidateSchema } from './faq.schema';
import { forbiddenTopicCandidateSchema } from './forbidden-topic.schema';
import { l1GuardrailCandidateSchema } from './guardrail.schema';

/** Letras (com acento), espaço, 2-20 chars. Sem pontuação, dígito ou símbolo. */
export const AGENT_NAME_PATTERN = /^[A-Za-zÀ-ú ]{2,20}$/;

/**
 * Apresentação: texto Unicode, espaços tipográficos, pontuação de frase e emojis,
 * 10-200 caracteres. `trim()` remove whitespace invisível nas bordas trazido pelo clipboard.
 *
 * Sato (revisão TASK-7.9.5): este é o único texto livre que entra no system prompt
 * (`buildPersonaBlock`), e `detectInjection` é uma **denylist** de 4 regexes — insuficiente
 * sozinha. O charset segue como allowlist: emojis e pontuação natural são aceitos, mas quebra
 * de linha, `:`, `#`, `*`, `[`, `<` e `{` continuam proibidos para impedir a criação de um
 * cabeçalho/bloco novo dentro do prompt. As duas checagens permanecem complementares.
 */
export const AGENT_SELF_INTRO_PATTERN =
  /^[\p{L}\p{M}\p{N}\p{Zs},.;\-'"’“”()!?…\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u200D]{10,200}$/u;

/**
 * Mensagem entregue quando o aluno pede para falar com uma pessoa (`PEDIDO_HANDOFF`).
 *
 * Charset deliberadamente mais estreito que o de `agentSelfIntro`: sem `\n`, `:`, `#`, `*`,
 * `_`, `~`, backtick, colchete, chave, `<`, `>`, `|`, `\`, `/`, `@`, `+`, `=`, `"` e `;`.
 * Sem `:` não se escreve URL; sem `*`/`_`/`~`/backtick não se injeta markup do WhatsApp;
 * sem `\n`/`:`/`#` não se forja cabeçalho de bloco de prompt. Emoji fica fora da v1 — quem
 * decide emoji é `emojiPolicy`, que já existe.
 */
export const AGENT_HANDOFF_MESSAGE_PATTERN = /^[A-Za-zÀ-ú0-9 ,.\-'()!?]{40,320}$/;

/**
 * Regras de formatação da mensagem no WhatsApp (**L2, editável direto pelo painel**).
 *
 * Três controles de espaço fechado; o mapeamento para números (parágrafos, linhas, itens)
 * mora em `prompts/persona-block.ts` e não é exposto ao painel. Não existe `allowTables`:
 * nenhum caminho de código renderiza tabela no WhatsApp, então o toggle seria configuração
 * morta — e configuração morta é o tipo de coisa que alguém acredita estar valendo.
 */
export const agentFormattingSchema = z.object({
  blockSize: z.enum(Object.values(AgentBlockSize) as [AgentBlockSize, ...AgentBlockSize[]]),
  allowLists: z.boolean(),
  boldPolicy: z.enum(Object.values(AgentBoldPolicy) as [AgentBoldPolicy, ...AgentBoldPolicy[]]),
});
export type AgentFormatting = z.infer<typeof agentFormattingSchema>;

export const DEFAULT_AGENT_FORMATTING: AgentFormatting = {
  blockSize: 'MEDIO',
  allowLists: true,
  boldPolicy: 'UMA_PALAVRA',
};

export const DEFAULT_AGENT_PERSONA_TRAITS: AgentPersonaTrait[] = [
  'ACOLHE_ANTES_DE_ORIENTAR',
  'FOCA_NO_PROXIMO_PASSO',
];

/**
 * Default compilado da mensagem de handoff. Passa por `AGENT_HANDOFF_MESSAGE_PATTERN`, pelo
 * validador de resposta e pela regra anti-promessa-de-prazo — os mesmos gates que o painel
 * aplica a um valor publicado (`config-simulator.ts`).
 */
export const DEFAULT_HUMAN_HANDOFF_MESSAGE =
  'Entendi. Vou registrar seu pedido para uma pessoa da equipe olhar com calma. ' +
  'Essa revisão é assíncrona, então não consigo prometer um retorno na mesma hora.';

/**
 * **Contrato do escritor (estrito).** Usado no formulário do painel, em
 * `publishAgentConfigSchema` e no simulador. Campos novos são obrigatórios aqui: quem
 * publica declara o valor, não herda um default invisível.
 */
export const agentPersonaSchema = z.object({
  agentName: z.string().regex(AGENT_NAME_PATTERN, 'nome inválido (2-20 letras)'),
  agentSelfIntro: z
    .string()
    .trim()
    .regex(
      AGENT_SELF_INTRO_PATTERN,
      'apresentação inválida (10-200 caracteres; use texto, pontuação e emojis)',
    ),
  toneDescriptors: z
    .array(
      z.enum(Object.values(AgentToneDescriptor) as [AgentToneDescriptor, ...AgentToneDescriptor[]]),
    )
    .min(1)
    .max(4),
  personaTraits: z
    .array(z.enum(Object.values(AgentPersonaTrait) as [AgentPersonaTrait, ...AgentPersonaTrait[]]))
    .min(1)
    .max(3),
  emojiPolicy: z.enum(Object.values(AgentEmojiPolicy) as [AgentEmojiPolicy, ...AgentEmojiPolicy[]]),
  formatting: agentFormattingSchema,
  humanHandoffMessage: z
    .string()
    .regex(AGENT_HANDOFF_MESSAGE_PATTERN, 'mensagem inválida (40-320 caracteres, sem símbolos)'),
});
export type AgentPersona = z.infer<typeof agentPersonaSchema>;

/**
 * **Contrato do leitor (tolerante).** Mesmo shape de saída, mas com default de código para
 * os campos introduzidos depois. Usado em toda LEITURA de payload histórico:
 * `AgentPersonaService.fromRedis()/fromDatabase()`, `AiConfigService.history()` e o
 * `safeParse` de `rollback()`.
 *
 * ## Por que ele precisa existir (bug real, achado por Rafael e Sato de forma independente)
 * `z.object` já descarta chave desconhecida, então uma linha antiga com `treatment`/
 * `maxResponseChars` continuaria validando. O problema é o inverso: adicionar campo NOVO
 * **obrigatório** faz toda linha histórica falhar o `safeParse` — e `AiConfigService.history()`
 * descarta com `flatMap` o que não valida. Sem este schema, o deploy que introduz `formatting`
 * apagaria silenciosamente todo o histórico de rollback do painel. Corrigir isso é
 * pré-requisito de qualquer campo novo no payload de persona, não um extra.
 */
export const agentPersonaStoredSchema = agentPersonaSchema.extend({
  personaTraits: z
    .array(z.enum(Object.values(AgentPersonaTrait) as [AgentPersonaTrait, ...AgentPersonaTrait[]]))
    .min(1)
    .max(3)
    .default(DEFAULT_AGENT_PERSONA_TRAITS),
  formatting: agentFormattingSchema.default(DEFAULT_AGENT_FORMATTING),
  humanHandoffMessage: z
    .string()
    .regex(AGENT_HANDOFF_MESSAGE_PATTERN)
    .default(DEFAULT_HUMAN_HANDOFF_MESSAGE),
});
export type AgentPersonaStored = z.infer<typeof agentPersonaStoredSchema>;

/**
 * Persona padrão — o default de código. Usado pelo serviço de resolução (CORE, DI global)
 * quando o banco/Redis não respondem ou o payload publicado não valida. Fail-safe nunca
 * significa "sem guardrail": significa "com a persona que está compilada".
 */
export const DEFAULT_AGENT_PERSONA: AgentPersona = {
  agentName: 'MOVI',
  agentSelfIntro:
    'a coach digital da MOVIVO, supervisionada por um profissional de Educação Física ' +
    'registrado no CREF',
  toneDescriptors: ['caloroso', 'direto', 'sem_hype'],
  personaTraits: DEFAULT_AGENT_PERSONA_TRAITS,
  emojiPolicy: 'MODERADO',
  formatting: DEFAULT_AGENT_FORMATTING,
  humanHandoffMessage: DEFAULT_HUMAN_HANDOFF_MESSAGE,
};

/** `changeNote` é obrigatório também no contrato: publicar sem motivo não é auditável. */
export const publishAgentConfigSchema = z.object({
  payload: agentPersonaSchema,
  changeNote: z.string().min(5).max(500),
});
export type PublishAgentConfigInput = z.infer<typeof publishAgentConfigSchema>;

export const rollbackAgentConfigSchema = z.object({
  targetVersion: z.int().positive(),
  changeNote: z.string().min(5).max(500),
});
export type RollbackAgentConfigInput = z.infer<typeof rollbackAgentConfigSchema>;

/* ------------------------------------------------------------------------- *
 * Contratos do painel de IA (US-7.7). O envelope `{ data, meta }` é o mesmo
 * dos demais setores do Control Center.
 * ------------------------------------------------------------------------- */

export const agentConfigVersionSchema = z.object({
  version: z.int().positive(),
  status: z.enum(Object.values(AgentConfigStatus) as [AgentConfigStatus, ...AgentConfigStatus[]]),
  changeNote: z.string(),
  createdAt: z.iso.datetime(),
  /** Nome de quem publicou; `null` quando o usuário foi anonimizado. */
  createdBy: z.string().nullable(),
  /** `true` na maior versão publicada — a que está valendo agora. */
  current: z.boolean(),
  /** Tolerante de propósito: versão histórica não tem os campos criados depois dela. */
  payload: agentPersonaStoredSchema,
});
export type AgentConfigVersion = z.infer<typeof agentConfigVersionSchema>;

export const agentPersonaResponseSchema = z.object({
  data: z.object({
    persona: agentPersonaSchema,
    /** `null` quando ainda não há configuração publicada (vale o default de código). */
    version: z.int().positive().nullable(),
  }),
  meta: controlCenterMetaSchema,
});
export type AgentPersonaResponse = z.infer<typeof agentPersonaResponseSchema>;

export const agentConfigHistoryResponseSchema = z.object({
  data: z.object({ versions: z.array(agentConfigVersionSchema) }),
  meta: controlCenterMetaSchema,
});
export type AgentConfigHistoryResponse = z.infer<typeof agentConfigHistoryResponseSchema>;

/** Bloco do system prompt exibido no painel, com camada, justificativa e conteúdo real. */
export const promptBlockViewSchema = z.object({
  id: z.string(),
  layer: z.enum(Object.values(PromptLayer) as [PromptLayer, ...PromptLayer[]]),
  title: z.string(),
  editable: z.boolean(),
  rationale: z.string(),
  content: z.string(),
});
export type PromptBlockView = z.infer<typeof promptBlockViewSchema>;

export const inviolableRulesResponseSchema = z.object({
  data: z.object({ blocks: z.array(promptBlockViewSchema) }),
  meta: controlCenterMetaSchema,
});
export type InviolableRulesResponse = z.infer<typeof inviolableRulesResponseSchema>;

/* ------------------------------------------------------------------------- *
 * Simulador síncrono de configuração (Sprint 9).
 * ------------------------------------------------------------------------- */

export const simulateAgentConfigSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('PERSONA'), candidate: agentPersonaSchema }),
  z.object({ kind: z.literal('FAQ'), candidate: faqCandidateSchema }),
  z.object({ kind: z.literal('GUARDRAIL'), candidate: l1GuardrailCandidateSchema }),
  z.object({ kind: z.literal('FORBIDDEN_TOPIC'), candidate: forbiddenTopicCandidateSchema }),
]);
export type SimulateAgentConfigInput = z.infer<typeof simulateAgentConfigSchema>;

export const configSimulationCheckSchema = z.object({
  id: z.enum(['SCHEMA', 'GOLDEN_INPUT', 'GOLDEN_OUTPUT', 'PROMPT_INTEGRITY']),
  title: z.string(),
  passed: z.boolean(),
  cases: z.int().nonnegative(),
  failures: z.array(z.string()),
});
export type ConfigSimulationCheck = z.infer<typeof configSimulationCheckSchema>;

export const configSimulationResponseSchema = z.object({
  data: z.object({
    kind: z.enum(['PERSONA', 'FAQ', 'GUARDRAIL', 'FORBIDDEN_TOPIC']),
    passed: z.boolean(),
    candidateHash: z.string().regex(/^[a-f0-9]{64}$/),
    checks: z.array(configSimulationCheckSchema).length(4),
  }),
  meta: controlCenterMetaSchema,
});
export type ConfigSimulationResponse = z.infer<typeof configSimulationResponseSchema>;
