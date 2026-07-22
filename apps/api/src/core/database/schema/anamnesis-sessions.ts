/**
 * Tabela `anamnesis_sessions` — progresso do formulário de anamnese + PAR-Q.
 *
 * É a tabela mais sensível do produto: o bloco 2 concentra histórico de saúde,
 * lesões, medicação em uso e as respostas do PAR-Q. Tudo ali é **dado pessoal
 * sensível** na acepção do Art. 11 da LGPD.
 */
import { index, jsonb, pgTable, smallint, varchar } from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { anamnesisStatusEnum } from './enums';
import { users } from './users';

export const anamnesisSessions = pgTable(
  'anamnesis_sessions',
  {
    id: primaryKeyColumn(),

    /**
     * Nulo enquanto a sessão é anônima: o usuário começa o formulário na landing
     * antes de existir conta (Sofia). O vínculo acontece na confirmação do
     * WhatsApp. `ON DELETE CASCADE` porque uma sessão de anamnese abandonada não
     * tem significado sem o titular — e é o que torna a limpeza barata.
     */
    userId: userIdColumn().references(() => users.id, { onDelete: 'cascade' }),

    /**
     * Token opaco do link de retorno ("continuar de onde parei"), 72h de
     * validade. É credencial de acesso a dado de saúde: precisa ser gerado com
     * CSPRNG e tratado como segredo. A regra de entropia/expiração vem do
     * pentest de anamnese de Sato (§8) e é aplicada na sprint de anamnese.
     */
    token: varchar('token', { length: 64 }).notNull().unique(),

    status: anamnesisStatusEnum('status').notNull().default('IN_PROGRESS'),

    /** Último bloco concluído (1, 2 ou 3) — habilita o salvamento de progresso. */
    lastBlock: smallint('last_block').notNull().default(1),

    /** Bloco 1 — dados básicos e objetivo. Dado pessoal comum. */
    dataBlock1: jsonb('data_block_1'),

    /**
     * -- LGPD Art. 11 — DADO SENSÍVEL DE SAÚDE.
     * Histórico de saúde, lesões, condições médicas, medicamentos em uso e as
     * respostas do PAR-Q. Esta coluna **será cifrada em repouso com `pgcrypto`**
     * na sprint de anamnese (`ARQUITETURA.md` §8; chave em `PGCRYPTO_KEY_FILE`,
     * já reservada no `.env.example`). A cifra NÃO é implementada nesta sprint —
     * a marcação existe para que nenhuma migração futura trate esta coluna como
     * JSONB comum.
     */
    dataBlock2: jsonb('data_block_2'),

    /** Bloco 3 — disponibilidade semanal e equipamentos. Dado pessoal comum. */
    dataBlock3: jsonb('data_block_3'),

    /** Pré-qualificação capturada na landing, antes do formulário. */
    primaryGoal: varchar('primary_goal', { length: 30 }),

    /** Expiração do link de retorno; o prazo de 72h é aplicado pela aplicação. */
    expiresAt: eventTimestamp('expires_at').notNull(),

    submittedAt: eventTimestamp('submitted_at'),

    ...timestampColumns,
  },
  (table) => [
    // `user_id` como coluna LÍDER: é o predicado que a RLS injeta em toda query
    // (Sato §4.5 — sem isso a degradação é de duas ordens de grandeza).
    index('idx_anamnesis_sessions_user').on(table.userId, table.createdAt),
    index('idx_anamnesis_sessions_status').on(table.status),
    // Expurgo de sessões expiradas (minimização de dado sensível) sem seq scan.
    index('idx_anamnesis_sessions_expires_at').on(table.expiresAt),
  ],
);

export type AnamnesisSessionRow = typeof anamnesisSessions.$inferSelect;
export type NewAnamnesisSessionRow = typeof anamnesisSessions.$inferInsert;
