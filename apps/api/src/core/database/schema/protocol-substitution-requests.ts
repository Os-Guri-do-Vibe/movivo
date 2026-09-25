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
  boolean,
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
import { reviewUrgencyEnum, substitutionRequestStatusEnum } from './enums';
import { protocols } from './protocols';
import { staff } from './staff';
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

    /**
     * Achado 2026-09-09 (pedido do fundador): `null` quando o aluno pediu um exercício que
     * ainda não existe no catálogo (`catalog_gap = true`) — `toExerciseName` carrega o texto
     * exatamente como ele pediu. Deixa de ser `notNull` de propósito: uma proposta pode
     * nascer sem substituto real algum, só um pedido a avaliar.
     */
    toExerciseId: varchar('to_exercise_id', { length: 100 }),
    toExerciseName: varchar('to_exercise_name', { length: 200 }).notNull(),

    /**
     * -- LGPD Art. 11 — DADO SENSÍVEL DE SAÚDE (derivado).
     * `ProtocolStructure` completo já com a troca aplicada — o que vira `protocols.content`
     * no momento da liberação. `null` enquanto `catalog_gap = true`: não há substituto real
     * ainda pra calcular a troca contra. Mesmo escopo de cifra em repouso de
     * `protocols.content`.
     */
    proposedContent: jsonb('proposed_content'),

    /** Registro estruturado do que muda: `{ type, from, to, sessionsAffected }`. `null`
     * enquanto `catalog_gap = true`, mesmo motivo de `proposedContent`. */
    diff: jsonb('diff'),

    /** Motivo humano-legível (ex.: "Substituição solicitada pelo aluno via WhatsApp: X → Y"). */
    changeReason: text('change_reason').notNull(),

    /** `protocols.version` no momento em que a proposta foi criada — detecta corrida com
     * uma edição/assinatura concorrente do mesmo protocolo antes da liberação. */
    baseVersion: smallint('base_version').notNull(),

    status: substitutionRequestStatusEnum('status').notNull().default('PENDING'),

    /**
     * Achado 2026-09-09 (pedido do fundador): reaproveita o MESMO enum de
     * `protocols.review_urgency` — `MANDATORY` quando o exercício pedido existe no catálogo
     * mas não é elegível pra este aluno, OU não existe em lugar nenhum (`catalog_gap`); os
     * dois nunca auto-liberam, sempre exigem decisão do time (ver `AiResponseWorker`). PAR-Q
     * bloqueante continua sendo computado ao vivo no `DashboardService.queue()` (LEFT JOIN
     * com a anamnese), sem duplicar aqui — este campo cobre só os motivos que nascem já
     * decididos na criação da proposta.
     */
    reviewUrgency: reviewUrgencyEnum('review_urgency').notNull().default('OPTIONAL'),

    /**
     * Achado 2026-09-09: `true` só quando o exercício pedido não existe em NENHUM lugar do
     * catálogo publicado — é o que liga a opção "Adicionar exercício ao catálogo" na tela de
     * revisão (um exercício que já existe, só não elegível, não ganha essa opção).
     */
    catalogGap: boolean('catalog_gap').notNull().default(false),

    decidedAt: eventTimestamp('decided_at'),
    decidedBy: uuid('decided_by').references(() => staff.id, { onDelete: 'restrict' }),

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
