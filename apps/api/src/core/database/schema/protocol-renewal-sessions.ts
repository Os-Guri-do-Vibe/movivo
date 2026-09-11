/**
 * Tabela `protocol_renewal_sessions` — formulário de troca de protocolo por fim de
 * mesociclo (US pós-MVP: renovação de mesociclo).
 *
 * Ao vencer o `endDate` de um protocolo `ACTIVE`, o `ProtocolRenewalScheduler` cria uma
 * linha aqui e manda o link por WhatsApp. Diferente de `anamnesis_sessions`, o titular
 * já existe desde o início (não há fase anônima): `user_id` nasce preenchido. O `token`
 * segue o MESMO racional do token de anamnese (CSPRNG, em claro, TTL aplicado pela
 * aplicação) só que com TTL mais longo — o aluno pode abrir o link em dispositivos e
 * momentos diferentes antes de responder, então a credencial não pode ser "consumida"
 * numa única troca por sessão de navegador (decisão do fundador: nada de magic-link de
 * uso único aqui).
 *
 * `data_block_3` concentra segurança (repescagem do PAR-Q + dor nova) e é o único bloco
 * sensível — mesmo tratamento de cifra em repouso de `anamnesis_sessions.data_block_2`
 * (LGPD Art. 11). Os demais blocos (desempenho, fadiga, resultado, contexto) são dado
 * comum, gravados em claro.
 */
import {
  type AnyPgColumn,
  index,
  jsonb,
  pgTable,
  smallint,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { bytea, eventTimestamp, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { protocolRenewalStatusEnum } from './enums';
import { protocols } from './protocols';
import { users } from './users';

export const protocolRenewalSessions = pgTable(
  'protocol_renewal_sessions',
  {
    id: primaryKeyColumn(),

    /** Titular já existe (aluno pagante/trial) — nunca nulo, diferente da fase anônima da anamnese. */
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    /**
     * Protocolo vencido que originou esta renovação. `RESTRICT`: é a prova documental de
     * por que o formulário foi enviado. Único: no máximo uma sessão de renovação por
     * protocolo — é a idempotência do `ProtocolRenewalScheduler.scan()`.
     */
    previousProtocolId: uuid('previous_protocol_id')
      .notNull()
      // `(): AnyPgColumn =>` (não `() =>`) quebra a inferência circular com `protocols.ts`
      // (que referencia esta tabela de volta via `renewalSessionId`) — mesmo workaround
      // documentado do drizzle-orm para FK mútua entre duas tabelas.
      .references((): AnyPgColumn => protocols.id, { onDelete: 'restrict' }),

    /**
     * Token opaco CSPRNG (256 bits), em claro na URL — mesmo racional de
     * `anamnesis_sessions.token`. TTL de 14 dias (aplicado pela aplicação), bem mais longo
     * que o das 72h da anamnese: o aluno já é titular conhecido (sem risco de sessão
     * anônima órfã) e precisa poder retomar de qualquer dispositivo em dias diferentes.
     */
    token: varchar('token', { length: 64 }).notNull().unique(),

    status: protocolRenewalStatusEnum('status').notNull().default('IN_PROGRESS'),

    /** Último BLOCO concluído do formulário (1..5) — mesmo papel de `anamnesis_sessions.last_block`. */
    lastStep: smallint('last_step').notNull().default(1),

    /** Bloco 1 — desempenho e execução real (perguntas 1-4). Dado comum. */
    dataBlock1: jsonb('data_block_1'),

    /** Bloco 2 — fadiga e recuperação (perguntas 5-8). Dado comum. */
    dataBlock2: jsonb('data_block_2'),

    /**
     * -- LGPD Art. 11 — DADO SENSÍVEL DE SAÚDE.
     * Bloco 3 — segurança: dor nova (pergunta 9) + repescagem do PAR-Q original
     * (pergunta 10). **Cifrado em repouso com `pgcrypto`** (`HealthCipherService`), mesmo
     * padrão de `anamnesis_sessions.data_block_2`.
     */
    dataBlock3: bytea('data_block_3'),

    /** Bloco 4 — resultado percebido (peso atual, evolução, satisfação). Dado comum. */
    dataBlock4: jsonb('data_block_4'),

    /** Bloco 5 — contexto e logística que mudou desde o início do ciclo. Dado comum. */
    dataBlock5: jsonb('data_block_5'),

    /** TTL de 14 dias aplicado pela aplicação, mesmo padrão de `anamnesis_sessions.expires_at`. */
    expiresAt: eventTimestamp('expires_at').notNull(),

    submittedAt: eventTimestamp('submitted_at'),

    ...timestampColumns,
  },
  (table) => [
    unique('uq_protocol_renewal_sessions_previous_protocol').on(table.previousProtocolId),
    index('idx_protocol_renewal_sessions_user').on(table.userId, table.createdAt),
    index('idx_protocol_renewal_sessions_status').on(table.status),
    index('idx_protocol_renewal_sessions_expires_at').on(table.expiresAt),
  ],
);

export type ProtocolRenewalSessionRow = typeof protocolRenewalSessions.$inferSelect;
export type NewProtocolRenewalSessionRow = typeof protocolRenewalSessions.$inferInsert;
