/**
 * Tabela `consents` — prova de consentimento LGPD por titular, finalidade e versão.
 *
 * Esta tabela existe para responder a uma pergunta específica de fiscalização
 * (ANPD) ou de litígio: *"este titular consentiu com QUE texto, QUANDO e a
 * partir de QUE origem?"*. Por isso guarda `version` (do texto aceito),
 * `ip_address` e `user_agent` — sem eles o registro não é prova, é anotação.
 *
 * O consentimento de `HEALTH_DATA` é o **específico e destacado** exigido pelo
 * Art. 11, II, "a" da LGPD e nunca pode ser inferido do aceite dos termos
 * (Alexandre, `06-relatorio-alexandre.md`).
 *
 * ## Semântica de revogação
 * Revogar **não** apaga a linha e não gera UPDATE destrutivo: carimba
 * `revoked_at`. O histórico de consentimento é append-only por natureza, e a
 * trilha imutável de banco (trigger + hash chain, `ARQUITETURA.md` §8) é
 * escopo de sprint futura — o terreno aqui já está preparado para ela.
 */
import { boolean, index, inet, pgTable, text, unique, varchar } from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
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
     */
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    consentType: consentTypeEnum('consent_type').notNull(),

    /** Versão do texto aceito (ex.: `2026-07-v1`). Sem isso não há prova. */
    version: varchar('version', { length: 20 }).notNull(),

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
    index('idx_consents_user').on(table.userId, table.acceptedAt),
  ],
);

export type ConsentRow = typeof consents.$inferSelect;
export type NewConsentRow = typeof consents.$inferInsert;
