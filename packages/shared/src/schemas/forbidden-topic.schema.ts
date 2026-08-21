/**
 * Contrato dos **temas proibidos** da agente (`ai_forbidden_topics`).
 *
 * ## Por que uma tabela/contrato próprios, e não `action: 'BLOCK'` em `ai_guardrail_rules`
 * O invariante "L1 só sinaliza, nunca bloqueia" hoje é demonstrável por inspeção em três
 * lugares independentes: o `z.literal('FLAG')` de `guardrail.schema.ts`, o check
 * `PROMPT_INTEGRITY` do simulador e o comentário da política de banco. Alargar aquele enum
 * converteria TODA regra L1 já publicada em candidata a bloqueadora e destruiria o invariante.
 * Um contrato separado custa uma migração a mais e preserva dois invariantes em vez de um.
 *
 * ## A separação que sustenta a feature
 * `label` é rótulo público: vai para o bloco de reforço do prompt. `phrases` **nunca** vai
 * para prompt nenhum — vive só no comparador determinístico do servidor. Se `phrases` entrasse
 * no prompt, isto seria injeção configurável; e se as frases-gatilho chegassem ao aluno, ele
 * aprenderia exatamente o que evitar para furar o bloqueio.
 */
import { z } from 'zod';

import { ForbiddenTopicStatus } from '../enums/agent-config';
import { controlCenterMetaSchema } from './control-center.schema';

/** Rótulo exibido no painel e no bloco de reforço do prompt. Mesmo espírito do L1, 3-40. */
export const FORBIDDEN_TOPIC_LABEL_PATTERN = /^[A-Za-zÀ-ú0-9 ,.'()-]{3,40}$/;

/**
 * Charset do termo-gatilho: letras (com acento), dígito, espaço e hífen. **Nada mais.**
 * Exclui todo metacaractere de regex e todo caractere estrutural de prompt. O painel nunca
 * aceita regex: expressão vinda de formulário numa hot path é ReDoS + comportamento
 * imprevisível. O match é `includes` por **limite de palavra** sobre texto normalizado.
 */
export const FORBIDDEN_TOPIC_PHRASE_PATTERN = /^[A-Za-zÀ-ú0-9 -]{4,60}$/;

/** Teto de temas ativos — orçamento de token do bloco de reforço (Victor). */
export const MAX_ACTIVE_FORBIDDEN_TOPICS = 12;
export const MAX_PHRASES_PER_FORBIDDEN_TOPIC = 20;
export const MAX_FORBIDDEN_TOPIC_PHRASES_TOTAL = 300;

/**
 * Âncoras do domínio que NUNCA podem virar termo-gatilho.
 *
 * Cadastrar "dor" ou "treino" como tema bloquearia metade da base em 60 segundos, sem
 * deploy e sem revisão de código. A denylist é a barreira grosseira; o gate de
 * anti-over-blocking do simulador (que roda os termos candidatos contra um corpus de
 * mensagens legítimas) é a barreira fina. O `agentName` vigente é somado a esta lista em
 * runtime pelo serviço de admin — ele muda sem redeploy.
 */
export const FORBIDDEN_TOPIC_TERM_DENYLIST: readonly string[] = [
  'treino',
  'exercicio',
  'serie',
  'repeticao',
  'carga',
  'dor',
  'peso',
  'agachamento',
  'musculo',
];

/**
 * Candidato a tema proibido. `action` não aparece no contrato porque é `BLOCK` e só:
 * o vocabulário **não sabe expressar** "permitir" ou "desativar" um bloqueio — é a resposta
 * estrutural a "e se alguém publicar uma regra que desliga o guardrail?". O banco repete a
 * mesma restrição num `CHECK`, para que a garantia não dependa da camada de aplicação.
 */
export const forbiddenTopicCandidateSchema = z.object({
  topicKey: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'chave inválida (kebab-case)')
    .max(60),
  label: z.string().trim().regex(FORBIDDEN_TOPIC_LABEL_PATTERN, 'rótulo inválido (3-40)'),
  phrases: z
    .array(z.string().trim().regex(FORBIDDEN_TOPIC_PHRASE_PATTERN, 'termo inválido'))
    .min(1)
    .max(MAX_PHRASES_PER_FORBIDDEN_TOPIC)
    .refine(
      (phrases) =>
        new Set(phrases.map((phrase) => phrase.toLocaleLowerCase('pt-BR'))).size === phrases.length,
      'termos duplicados',
    ),
});
export type ForbiddenTopicCandidate = z.infer<typeof forbiddenTopicCandidateSchema>;

export const createForbiddenTopicSchema = forbiddenTopicCandidateSchema.extend({
  changeNote: z.string().trim().min(5).max(500),
});
export type CreateForbiddenTopicInput = z.infer<typeof createForbiddenTopicSchema>;

export const forbiddenTopicActionSchema = z.object({
  topicKey: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(60),
  note: z.string().trim().min(5).max(500),
});
export type ForbiddenTopicActionInput = z.infer<typeof forbiddenTopicActionSchema>;

export const forbiddenTopicNoteSchema = z.object({ note: z.string().trim().min(5).max(500) });

export const forbiddenTopicVersionSchema = forbiddenTopicCandidateSchema.extend({
  id: z.uuid(),
  version: z.int().positive(),
  status: z.enum(
    Object.values(ForbiddenTopicStatus) as [ForbiddenTopicStatus, ...ForbiddenTopicStatus[]],
  ),
  action: z.literal('BLOCK'),
  changeNote: z.string(),
  /** Autor da proposta (maker). Carregado adiante nas transições, nunca sobrescrito. */
  createdBy: z.string().nullable(),
  /** Quem aprovou/retirou (checker). Sempre diferente do maker — `CHECK` no banco. */
  approvedBy: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** `true` na maior versão da chave — o estado que vale agora. */
  current: z.boolean(),
});
export type ForbiddenTopicVersion = z.infer<typeof forbiddenTopicVersionSchema>;

export const forbiddenTopicsResponseSchema = z.object({
  data: z.object({
    versions: z.array(forbiddenTopicVersionSchema),
    /** Rótulos que estão de fato no prompt agora — o que a agente "sabe" que não discute. */
    activeLabels: z.array(z.string()),
    limits: z.object({
      maxActiveTopics: z.int().positive(),
      maxPhrasesPerTopic: z.int().positive(),
      maxPhrasesTotal: z.int().positive(),
    }),
  }),
  meta: controlCenterMetaSchema,
});
export type ForbiddenTopicsResponse = z.infer<typeof forbiddenTopicsResponseSchema>;
