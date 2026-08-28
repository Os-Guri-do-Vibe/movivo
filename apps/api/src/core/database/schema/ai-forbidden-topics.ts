/**
 * `ai_forbidden_topics` — temas que a agente se recusa a discutir (Sprint 10).
 *
 * ## Tabela nova, e não `action='BLOCK'` em `ai_guardrail_rules`
 * O invariante "L1 só sinaliza" é hoje demonstrável por inspeção em três lugares
 * independentes (o `z.literal('FLAG')` do contrato, o check `PROMPT_INTEGRITY` do simulador
 * e a política de banco). Alargar aquele enum converteria toda regra L1 já publicada em
 * candidata a bloqueadora. Uma migração a mais preserva dois invariantes em vez de um.
 *
 * ## `action` fixa em BLOCK, no banco
 * O `CHECK (action = 'BLOCK')` é deliberado: o vocabulário da tabela **não sabe expressar**
 * "permitir" ou "desativar". Uma linha publicada não pode desligar um bloqueio, porque não
 * existe valor que signifique isso.
 *
 * ## Append-only + autoria e aprovação auditáveis
 * Cada transição (rascunho → em aprovação → aprovado → retirado) é uma linha nova com
 * `version` incremental — mesmo molde de `ai_guardrail_rules`. `created_by` guarda o **autor
 * da proposta** e é carregado adiante em cada transição; `approved_by` guarda quem aprovou
 * ou retirou. O serviço exige maker-checker para `PROFESSIONAL`; `ADMIN` pode executar
 * todas as transições, inclusive sobre proposta própria, mantendo os dois atores auditados.
 *
 * ## Sem RLS por titular
 * Configuração global do produto, não dado de aluno — mesmo raciocínio de `agent_config`.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  integer,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { ForbiddenTopicStatus } from '@movivo/shared';

import { eventTimestamp, primaryKeyColumn } from './_shared';
import { users } from './users';

export const aiForbiddenTopicStatusEnum = pgEnum('ai_forbidden_topic_status', [
  ForbiddenTopicStatus.DRAFT,
  ForbiddenTopicStatus.PENDING_APPROVAL,
  ForbiddenTopicStatus.APPROVED,
  ForbiddenTopicStatus.RETIRED,
]);

/** Enum de um valor só. Ver o cabeçalho: a ausência de alternativa é a garantia. */
export const aiForbiddenTopicActionEnum = pgEnum('ai_forbidden_topic_action', ['BLOCK']);

export const aiForbiddenTopics = pgTable(
  'ai_forbidden_topics',
  {
    id: primaryKeyColumn(),
    /** Identidade lógica do tema (kebab-case), estável entre versões. */
    topicKey: text('topic_key').notNull(),
    /** Rótulo público — o ÚNICO campo desta tabela que chega a um prompt. */
    label: text('label').notNull(),
    /** Termos-gatilho. Nunca entram em prompt: só no comparador do servidor. */
    phrases: jsonb('phrases').$type<string[]>().notNull(),
    action: aiForbiddenTopicActionEnum('action').notNull().default('BLOCK'),
    version: integer('version').notNull(),
    status: aiForbiddenTopicStatusEnum('status').notNull().default('DRAFT'),
    changeNote: text('change_note').notNull(),
    /** Maker: autor da proposta original, carregado adiante em cada transição. */
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Ator que aprovou ou retirou; pode coincidir com o maker quando for ADMIN. */
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: eventTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('uq_ai_forbidden_topics_key_version').on(table.topicKey, table.version),
    index('idx_ai_forbidden_topics_key').on(table.topicKey, table.version),
    // A ação é BLOCK e só. Repetido aqui porque o Zod protege a API, não o banco.
    check('ck_ai_forbidden_topics_action_block', sql`${table.action} = 'BLOCK'`),
  ],
);

export type AiForbiddenTopicRow = typeof aiForbiddenTopics.$inferSelect;
