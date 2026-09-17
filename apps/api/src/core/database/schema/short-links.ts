/**
 * `short_links` — alias curto e público para uma URL longa (token de magic link, sessão de
 * renovação de mesociclo, etc.), achado 2026-09-12: mandar o link cru por WhatsApp expõe um
 * token opaco de dezenas de caracteres na mensagem, feio e com cara de phishing.
 *
 * Sem `user_id` e sem RLS de propósito: não é dado do titular, é só um mapa código → URL, e o
 * único jeito de descobrir o código é já ter recebido a mensagem de WhatsApp que o contém. Todo
 * acesso (criação pelo scheduler, leitura pelo redirect público) passa por `runAsSystem` — o
 * mesmo padrão de `workout_access_tokens`, que também não é RLS-scoped por ser bootstrap
 * pré-autenticação.
 *
 * **Nunca de uso único.** Diferente do magic token que ele encurta, resolver o código não
 * consome nada — o WhatsApp do destinatário faz um GET passivo nele para montar a prévia do
 * link (achado: um alias de uso único seria invalidado por essa prévia antes do aluno clicar).
 * A segurança de uso único, quando existe, mora inteiramente no recurso apontado por
 * `target_url` (ex.: `workout_access_tokens.consumed_at`) — este alias só redireciona.
 */
import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { primaryKeyColumn, timestampColumns } from './_shared';

export const shortLinks = pgTable(
  'short_links',
  {
    id: primaryKeyColumn(),
    code: varchar('code', { length: 16 }).notNull(),
    targetUrl: text('target_url').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex('uq_short_links_code').on(table.code),
    check('ck_short_links_code_len', sql`char_length(${table.code}) between 6 and 16`),
  ],
);
