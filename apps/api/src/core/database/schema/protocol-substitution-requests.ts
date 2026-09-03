/**
 * Tabela `protocol_substitution_requests` — proposta de troca de exercício em staging
 * (achado 2026-09-02, fluxo de substituição via IA).
 *
 * ## Por que uma tabela separada, e não mutar `protocols` direto
 * O padrão já existente (`DashboardService.editProtocol`/`signProtocol` +
 * `ProtocolAutoReleaseWorker`) só opera em protocolos que **ainda não estão ativos**
 * (`PENDING_SIGNATURE`). A substituição de exercício via IA, ao contrário, nasce de uma
 * conversa com um aluno que já está treinando no protocolo `ACTIVE` — mutar essa linha
 * (tirando-a de `ACTIVE` por até 30 min, à espera de revisão) quebraria, no meio-tempo:
 * o próprio contexto do AI Coach (`ContextRepository.loadEpisodic` lê `status='ACTIVE'`),
 * o link público do PDF que o aluno já tem, e os crons de check-in/registro de treino.
 *
 * Por isso a mudança fica **em staging** aqui: o protocolo vigente do aluno não é tocado
 * enquanto `status='PENDING'`. Só quando um profissional aprova, ou os 30 minutos passam
 * sem intervenção, a mudança é de fato aplicada — mesma mecânica que `signProtocol` já usa
 * (bump de versão, grava `content`, insere `protocol_versions`).
 *
 * É dado de titular (a proposta carrega o protocolo completo já com a troca aplicada):
 * RLS por `user_id`, mesmo tratamento de `protocols`/`protocol_versions`.
 */
import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { substitutionRequestStatusEnum } from './enums';
import { protocols } from './protocols';
import { users } from './users';

export const protocolSubstitutionRequests = pgTable(
  'protocol_substitution_requests',
  {
    id: primaryKeyColumn(),

    /** `RESTRICT`: a proposta é parte da trilha de supervisão do protocolo referenciado. */
    protocolId: uuid('protocol_id')
      .notNull()
      .references(() => protocols.id, { onDelete: 'restrict' }),

    /** Denormalizado de propósito, mesmo motivo de `protocol_versions.user_id` — a RLS
     * precisa do predicado de titular na própria tabela, sem depender de JOIN. */
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    fromExerciseId: varchar('from_exercise_id', { length: 100 }).notNull(),
    fromExerciseName: varchar('from_exercise_name', { length: 200 }).notNull(),
    toExerciseId: varchar('to_exercise_id', { length: 100 }).notNull(),
    toExerciseName: varchar('to_exercise_name', { length: 200 }).notNull(),

    /**
     * -- LGPD Art. 11 — DADO SENSÍVEL DE SAÚDE (derivado).
     * `ProtocolStructure` completo já com a troca aplicada — o que vira `protocols.content`
     * no momento da liberação. Mesmo escopo de cifra em repouso de `protocols.content`.
     */
    proposedContent: jsonb('proposed_content').notNull(),

    /** Registro estruturado do que muda: `{ type, from, to, sessionsAffected }`. */
    diff: jsonb('diff').notNull(),

    /** Motivo humano-legível (ex.: "Substituição solicitada pelo aluno via WhatsApp: X → Y"). */
    changeReason: text('change_reason').notNull(),

    /** `protocols.version` no momento em que a proposta foi criada — detecta corrida com
     * uma edição/assinatura concorrente do mesmo protocolo antes da liberação. */
    baseVersion: smallint('base_version').notNull(),

    status: substitutionRequestStatusEnum('status').notNull().default('PENDING'),

    decidedAt: eventTimestamp('decided_at'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'restrict' }),

    ...timestampColumns,
  },
  (table) => [
    // Constraint de v1 (decisão do fundador): no máximo uma proposta pendente por
    // protocolo por vez — um segundo pedido de troca enquanto o primeiro ainda não foi
    // decidido é recusado na conversa, não empilhado.
    uniqueIndex('uq_protocol_substitution_requests_pending')
      .on(table.protocolId)
      .where(sql`${table.status} = 'PENDING'`),
    index('idx_protocol_substitution_requests_user').on(table.userId, table.createdAt),
    // Fila do painel CREF: pendentes por tempo de criação (ordena a janela de cortesia).
    index('idx_protocol_substitution_requests_queue').on(table.status, table.createdAt),
  ],
);

export type ProtocolSubstitutionRequestRow = typeof protocolSubstitutionRequests.$inferSelect;
export type NewProtocolSubstitutionRequestRow = typeof protocolSubstitutionRequests.$inferInsert;
