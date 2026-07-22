/**
 * Tabela `protocol_versions` — histórico imutável de cada versão de protocolo.
 *
 * Exigida pelo schema lógico de Lucas (`08-relatorio-lucas.md` §9) e ausente do
 * DDL de Rafael. Não é redundância de `protocols`: `protocols` guarda o estado
 * **vigente** (uma linha por usuário/versão corrente), enquanto aqui fica o
 * snapshot completo de cada versão já emitida, com o `diff` do que mudou e o
 * motivo da mudança.
 *
 * É o que sustenta duas exigências que não são de produto, e sim regulatórias:
 *  - **rastreabilidade da supervisão CREF** — provar o que foi assinado em cada
 *    ponto do tempo, e não apenas o estado final;
 *  - **versionamento das respostas da IA** (`ARQUITETURA.md` §8) — saber qual
 *    modelo produziu qual versão.
 *
 * Semântica append-only: linhas aqui **nunca** são atualizadas nem apagadas pela
 * aplicação. A garantia a nível de banco (REVOKE + trigger + hash chain) vem com
 * a sprint de auditoria; nesta sprint a tabela apenas nasce com a forma certa.
 */
import { index, jsonb, pgTable, smallint, text, unique, uuid, varchar } from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { protocolStatusEnum } from './enums';
import { protocols } from './protocols';
import { users } from './users';

export const protocolVersions = pgTable(
  'protocol_versions',
  {
    id: primaryKeyColumn(),

    /** `RESTRICT`: o histórico não desaparece porque o protocolo vigente mudou. */
    protocolId: uuid('protocol_id')
      .notNull()
      .references(() => protocols.id, { onDelete: 'restrict' }),

    /**
     * `user_id` **denormalizado de propósito**. A RLS precisa do predicado de
     * titular na própria tabela: obrigá-la a alcançar `protocols` por JOIN
     * tornaria a policy dependente de uma segunda leitura e mataria o plano
     * (Sato §4.5). Consistência garantida pela aplicação e, na sprint de
     * auditoria, por CHECK/trigger.
     */
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    version: smallint('version').notNull(),

    /** Estado do protocolo NO MOMENTO em que esta versão foi emitida. */
    status: protocolStatusEnum('status').notNull().default('DRAFT'),

    /**
     * -- LGPD Art. 11 — DADO SENSÍVEL DE SAÚDE (derivado).
     * Snapshot íntegro do protocolo desta versão. Mesmo escopo de cifra em
     * repouso de `protocols.content`; não cifrado nesta sprint.
     */
    content: jsonb('content').notNull(),

    /** Diferença estruturada para a versão anterior. Nulo na versão 1. */
    diff: jsonb('diff'),

    /** Motivo da nova versão (ex.: ajuste pós check-in da semana 3). */
    changeReason: text('change_reason'),

    /** Modelo que redigiu esta versão. Nunca `deepseek-*` (§12.11). */
    generatedBy: varchar('generated_by', { length: 50 }),

    /** Hash SHA-256 do `content` no instante da assinatura desta versão. */
    signatureHash: varchar('signature_hash', { length: 64 }),

    signedAt: eventTimestamp('signed_at'),

    ...timestampColumns,
  },
  (table) => [
    unique('uq_protocol_versions_protocol_version').on(table.protocolId, table.version),
    index('idx_protocol_versions_user').on(table.userId, table.createdAt),
    index('idx_protocol_versions_protocol').on(table.protocolId, table.version),
  ],
);

export type ProtocolVersionRow = typeof protocolVersions.$inferSelect;
export type NewProtocolVersionRow = typeof protocolVersions.$inferInsert;
