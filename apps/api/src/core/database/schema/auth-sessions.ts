/**
 * Tabela `auth_sessions` — refresh tokens do dashboard (US-1.1 / TASK-1.1.5).
 *
 * Guarda o estado necessário para o **refresh token rotation com detecção de reuse**
 * que a US-1.4 vai implementar (Sato §9.1 / ADR-006). Regras materializadas aqui:
 *
 *  - **Nunca** o refresh token em claro. Persiste-se apenas `refresh_token_hash`
 *    (SHA-256 do token opaco). Um vazamento desta tabela não permite forjar sessão.
 *  - `jti` (JWT ID) identifica unicamente o par emitido — é o valor colocado na
 *    denylist do Redis no logout/revogação (Sato §9.1).
 *  - `family_id` amarra todos os tokens descendentes de um mesmo login. Se um
 *    refresh já rotacionado for reapresentado (indício de roubo), a US-1.4
 *    invalida a **família inteira** carimbando `revoked_at` em todas as linhas
 *    com o mesmo `family_id`.
 *  - `expires_at` (30 dias) e `revoked_at` (nulo = sessão viva) governam a validade.
 *
 * Está sob `FORCE ROW LEVEL SECURITY` por `user_id` como as demais tabelas de
 * titular: uma sessão só é legível/alterável no contexto do próprio usuário ou
 * num contexto de sistema (`app.current_role = 'SYSTEM'`), nunca cross-tenant.
 */
import { index, pgTable, uniqueIndex } from 'drizzle-orm/pg-core';
import { text, uuid } from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn, timestampColumns, userIdColumn } from './_shared';
import { users } from './users';

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: primaryKeyColumn(),

    /**
     * `CASCADE`: um refresh token é estado de sessão efêmero — não é prova
     * documental. Se o titular for removido (caso raro; o padrão é anonimizar),
     * as sessões vão junto. Distinto de `consents`/`protocols`, que usam
     * `RESTRICT` por serem prova.
     */
    userId: userIdColumn()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /**
     * -- SENSÍVEL: SHA-256 do refresh token opaco. Nunca o token em claro
     * (Sato §9.1). Comparado em tempo constante na validação (US-1.4).
     */
    refreshTokenHash: text('refresh_token_hash').notNull(),

    /** JWT ID do par emitido — chave da denylist Redis no logout/revogação. */
    jti: uuid('jti').notNull(),

    /** Família de rotação: reuse de um refresh invalida toda a família (Sato §9.1). */
    familyId: uuid('family_id').notNull(),

    /** Fim da validade do refresh (30 dias — ADR-006). */
    expiresAt: eventTimestamp('expires_at').notNull(),

    /** Carimbo de revogação (rotation, logout ou detecção de reuse). Nulo = vivo. */
    revokedAt: eventTimestamp('revoked_at'),

    ...timestampColumns,
  },
  (table) => [
    // `jti` é único no sistema: é o identificador que entra na denylist.
    uniqueIndex('uq_auth_sessions_jti').on(table.jti),
    // `user_id` como coluna LÍDER da RLS (Sato §4.5) e para revogar por usuário.
    index('idx_auth_sessions_user').on(table.userId, table.createdAt),
    // Invalidação da família inteira na detecção de reuse.
    index('idx_auth_sessions_family').on(table.familyId),
    // Expurgo de sessões expiradas sem seq scan.
    index('idx_auth_sessions_expires_at').on(table.expiresAt),
  ],
);

export type AuthSessionRow = typeof authSessions.$inferSelect;
export type NewAuthSessionRow = typeof authSessions.$inferInsert;
