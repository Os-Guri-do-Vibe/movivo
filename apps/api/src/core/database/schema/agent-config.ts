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
 * ativa é a maior `version` com `status = 'PUBLISHED'` **dentro do slot** (`target_sex`);
 * toda versão publicada anterior do mesmo slot está, por definição, arquivada. `DRAFT`
 * existe no enum para o rascunho da Sprint 9.
 *
 * ## Dois slots (Sprint 11)
 * A tabela guarda DUAS linhas do tempo independentes, uma por `target_sex`. Publicar no
 * slot masculino não arquiva nada do feminino, e vice-versa. Enquanto um dos slots não
 * tiver nenhuma versão publicada, o runtime **empresta** a persona do outro
 * (`AgentPersonaService`) — nunca cai no default compilado só porque o slot está órfão.
 */
import { integer, jsonb, pgEnum, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { AgentConfigStatus } from '@movivo/shared';

import { eventTimestamp, primaryKeyColumn } from './_shared';
import { biologicalSexEnum } from './enums';
import { users } from './users';

export const agentConfigStatusEnum = pgEnum('agent_config_status', [
  AgentConfigStatus.DRAFT,
  AgentConfigStatus.PUBLISHED,
  AgentConfigStatus.ARCHIVED,
]);

export const agentConfig = pgTable(
  'agent_config',
  {
    id: primaryKeyColumn(),
    /**
     * **Slot** da persona: o público que esta versão atende (Sprint 11). Duas personas
     * coexistem publicadas — uma por sexo biológico do titular — e cada mensagem resolve
     * dinamicamente a do titular. Sem default no schema de propósito: publicar sem declarar
     * o público é ambíguo, e a migração populou as linhas existentes explicitamente.
     */
    targetSex: biologicalSexEnum('target_sex').notNull(),
    /**
     * Incremental **por slot**: `max(version) WHERE target_sex = $1` identifica a vigente
     * daquele público. Deixou de ser único globalmente — existe `version = 1` nos dois
     * slots ao mesmo tempo, e por isso todo acesso a uma versão específica (rollback,
     * histórico) usa o par `(target_sex, version)`, nunca `version` sozinho.
     */
    version: integer('version').notNull(),
    status: agentConfigStatusEnum('status').notNull().default(AgentConfigStatus.PUBLISHED),
    /** Persona validada por `agentPersonaSchema` na gravação E na leitura. */
    payload: jsonb('payload').notNull(),
    /** Motivo da publicação. NOT NULL: publicar sem motivo não é auditável. */
    changeNote: text('change_note').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: eventTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    // Substitui o UNIQUE(version) global. Continua sendo a barreira contra duas publicações
    // simultâneas gravarem o mesmo número — agora dentro do slot, onde a contagem vive.
    unique('agent_config_version_unique').on(table.targetSex, table.version),
  ],
);

export type AgentConfigRow = typeof agentConfig.$inferSelect;
