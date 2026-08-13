/**
 * `agent_config` — configuração publicada da agente de IA (US-7.6 / TASK-7.6.2).
 *
 * ## Append-only, imposto no banco
 * Nunca sofre `UPDATE` nem `DELETE`. Cada publicação é uma **linha nova** com `version`
 * incremental. Rollback é publicar de novo o payload de uma versão anterior — jamais
 * reabrir a linha antiga. A garantia não é convenção de código: `migrate.ts` aplica
 * trigger de rejeição + `REVOKE UPDATE, DELETE, TRUNCATE` da role de runtime, o mesmo
 * padrão de defesa em profundidade já usado por `audit_logs`.
 *
 * ## Sem RLS por titular
 * Não é dado de nenhum aluno: é configuração global do produto. O controle é por
 * capability (`AI_CONFIG_READ` / `AI_CONFIG_WRITE`) na API + append-only no banco.
 *
 * ## `status` numa tabela sem UPDATE
 * A linha nasce `PUBLISHED` e nunca muda. "Arquivada" é uma propriedade **derivada**:
 * ativa é a maior `version` com `status = 'PUBLISHED'`; toda versão publicada anterior
 * está, por definição, arquivada. `DRAFT` existe no enum para o rascunho da Sprint 9.
 */
import { integer, jsonb, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { AgentConfigStatus } from '@movivo/shared';

import { eventTimestamp, primaryKeyColumn } from './_shared';
import { users } from './users';

export const agentConfigStatusEnum = pgEnum('agent_config_status', [
  AgentConfigStatus.DRAFT,
  AgentConfigStatus.PUBLISHED,
  AgentConfigStatus.ARCHIVED,
]);

export const agentConfig = pgTable('agent_config', {
  id: primaryKeyColumn(),
  /** Incremental e único — `max(version)` identifica a configuração vigente. */
  version: integer('version').notNull().unique(),
  status: agentConfigStatusEnum('status').notNull().default(AgentConfigStatus.PUBLISHED),
  /** Persona validada por `agentPersonaSchema` na gravação E na leitura. */
  payload: jsonb('payload').notNull(),
  /** Motivo da publicação. NOT NULL: publicar sem motivo não é auditável. */
  changeNote: text('change_note').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: eventTimestamp('created_at').notNull().defaultNow(),
});

export type AgentConfigRow = typeof agentConfig.$inferSelect;
