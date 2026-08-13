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
  AgentConfigStatus,
  AgentEmojiPolicy,
  AgentToneDescriptor,
  AgentTreatment,
  PromptLayer,
} from '../enums/agent-config';
import { controlCenterMetaSchema } from './control-center.schema';

/** Letras (com acento), espaço, 2-20 chars. Sem pontuação, dígito ou símbolo. */
export const AGENT_NAME_PATTERN = /^[A-Za-zÀ-ú ]{2,20}$/;

/**
 * Apresentação: letras, dígitos, espaço e pontuação de frase (`, . - ' ( ) !`), 10-200 chars.
 *
 * Sato (revisão TASK-7.9.5): este é o único texto livre que entra no system prompt
 * (`buildPersonaBlock`), e `detectInjection` é uma **denylist** de 4 regexes — insuficiente
 * sozinha. O charset é a barreira de allowlist: sem quebra de linha, `:`, `#`, `*`, `[`, `<`
 * ou `{`, não há como forjar um cabeçalho/bloco novo dentro do prompt. As duas checagens
 * são complementares e ambas continuam valendo.
 */
export const AGENT_SELF_INTRO_PATTERN = /^[A-Za-zÀ-ú0-9 ,.\-'()!]{10,200}$/;

export const agentPersonaSchema = z.object({
  agentName: z.string().regex(AGENT_NAME_PATTERN, 'nome inválido (2-20 letras)'),
  agentSelfIntro: z
    .string()
    .regex(AGENT_SELF_INTRO_PATTERN, 'apresentação inválida (10-200 caracteres, sem símbolos)'),
  toneDescriptors: z
    .array(
      z.enum(Object.values(AgentToneDescriptor) as [AgentToneDescriptor, ...AgentToneDescriptor[]]),
    )
    .min(1)
    .max(4),
  emojiPolicy: z.enum(Object.values(AgentEmojiPolicy) as [AgentEmojiPolicy, ...AgentEmojiPolicy[]]),
  maxResponseChars: z.int().min(200).max(1200),
  treatment: z.enum(Object.values(AgentTreatment) as [AgentTreatment, ...AgentTreatment[]]),
});
export type AgentPersona = z.infer<typeof agentPersonaSchema>;

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
  emojiPolicy: 'MODERADO',
  maxResponseChars: 800,
  treatment: 'VOCE',
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
  payload: agentPersonaSchema,
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
