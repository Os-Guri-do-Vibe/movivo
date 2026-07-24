/**
 * Tabela `consents` — prova de consentimento LGPD por titular, finalidade e versão.
 *
 * Esta tabela existe para responder a uma pergunta específica de fiscalização
 * (ANPD) ou de litígio: *"este titular consentiu com QUE texto, QUANDO e a
 * partir de QUE origem?"*. Por isso guarda `version` (do texto aceito),
 * `ip_address` e `user_agent` — sem eles o registro não é prova, é anotação.
 *
 * O consentimento de `HEALTH_DATA` é o **específico e destacado** exigido pelo
 * **Art. 11, I** da LGPD e nunca pode ser inferido do aceite dos termos
 * (Alexandre, `docs/juridico/consentimento-e-parq.md` §1 — que corrige a citação
 * anterior a "Art. 11, II, 'a'": o inciso II trata das hipóteses SEM consentimento).
 *
 * ## Semântica de revogação
 * Revogar **não** apaga a linha e não gera UPDATE destrutivo: carimba
 * `revoked_at`. O histórico de consentimento é append-only por natureza, e a
 * trilha imutável de banco (trigger + hash chain, `ARQUITETURA.md` §8) é
 * escopo de sprint futura — o terreno aqui já está preparado para ela.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  inet,
  pgTable,
  text,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { anamnesisSessions } from './anamnesis-sessions';
import { consentTypeEnum } from './enums';
import { users } from './users';

export const consents = pgTable(
  'consents',
  {
    id: primaryKeyColumn(),

    /**
     * `RESTRICT`: o registro de consentimento é a base legal do tratamento que
     * já aconteceu. Apagá-lo em cascata destruiria a prova de que o tratamento
     * foi lícito. Exclusão de titular é anonimização, não DELETE (§8).
     *
     * **Nulo na fase anônima** (US-1.2): o consentimento de saúde é registrado na
     * tela-ponte, ANTES do Bloco 2 e, portanto, antes de o usuário existir (o
     * `users` só nasce no submit — US-1.3). Se esta coluna fosse obrigatória, o
     * bloco de saúde seria gravado sem prova de consentimento — exatamente o que
     * o BLOQUEADOR 3 de Alexandre proíbe. Nessa fase a âncora é
     * `anamnesis_session_id`; no submit a linha é vinculada ao titular.
     */
    userId: userIdColumn().references(() => users.id, { onDelete: 'restrict' }),

    /**
     * Âncora do consentimento enquanto a sessão de anamnese é anônima.
     * `CASCADE`: sessão abandonada e expurgada leva junto um consentimento que
     * nunca chegou a fundamentar tratamento de titular identificado.
     */
    anamnesisSessionId: uuid('anamnesis_session_id').references(() => anamnesisSessions.id, {
      onDelete: 'cascade',
    }),

    consentType: consentTypeEnum('consent_type').notNull(),

    /**
     * Versão do texto aceito (ex.: `consent-health-2026-07-v1`). Sem isso não há
     * prova. 40 chars: os identificadores de Alexandre têm ~28 e a coluna precisa
     * de folga para versões futuras (`...-2026-08-v2`).
     */
    version: varchar('version', { length: 40 }).notNull(),

    /** `false` é um registro legítimo: recusa explícita também precisa de prova. */
    accepted: boolean('accepted').notNull(),

    /**
     * -- LGPD Art. 5º, I: dado pessoal. IP identifica indiretamente o titular.
     * Coletado sob legítimo interesse de prova (Art. 7º, IX) e sujeito à mesma
     * política de retenção do consentimento. Nunca vai para log de aplicação.
     */
    ipAddress: inet('ip_address'),

    /** Dado pessoal indireto (fingerprint de dispositivo). Mesmo tratamento do IP. */
    userAgent: text('user_agent'),

    acceptedAt: eventTimestamp('accepted_at').notNull().defaultNow(),

    /** Carimbo de revogação (LGPD Art. 8º, §5º). Nulo = consentimento vigente. */
    revokedAt: eventTimestamp('revoked_at'),

    ...timestampColumns,
  },
  (table) => [
    // Um registro por (titular, finalidade, versão do texto): reaceitar a MESMA
    // versão é idempotente; um texto novo gera versão nova e linha nova.
    unique('uq_consents_user_type_version').on(table.userId, table.consentType, table.version),
    // Mesma idempotência na fase anônima. Índices UNIQUE separados porque, no
    // Postgres, NULL não colide com NULL — sem este, a sessão anônima aceitaria
    // duplicatas do mesmo consentimento.
    unique('uq_consents_session_type_version').on(
      table.anamnesisSessionId,
      table.consentType,
      table.version,
    ),
    // Uma linha de consentimento sem NENHUMA âncora seria prova órfã.
    check(
      'ck_consents_subject',
      sql`${table.userId} IS NOT NULL OR ${table.anamnesisSessionId} IS NOT NULL`,
    ),
    index('idx_consents_user').on(table.userId, table.acceptedAt),
    index('idx_consents_session').on(table.anamnesisSessionId),
  ],
);

export type ConsentRow = typeof consents.$inferSelect;
export type NewConsentRow = typeof consents.$inferInsert;
