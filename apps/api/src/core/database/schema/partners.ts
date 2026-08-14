/**
 * `partners` — cap table versionado por vigência (US-8.7 / TASK-8.7.1).
 *
 * ## Pontos-base inteiros, nunca percentual em float
 * `share_basis_points`: 2000 = 20%. Participação em ponto flutuante que precisa somar
 * exatamente 100% é armadilha conhecida — `0.2 * 5` não é 1 em binário. Em inteiro,
 * `2000 * 5 = 10000` é exato e a conferência é trivial.
 *
 * ## Versionada por vigência, como `model_pricing`
 * Mudar participação é **fechar** a linha vigente (`valid_to`) e abrir a nova. A
 * distribuição de um mês passado continua saindo com a participação daquele mês.
 * Por isso a tabela **não** é append-only: fechar vigência é um `UPDATE valid_to`.
 * A garantia vem da vigência + auditoria (`AuditService.append`), não da imutabilidade
 * da linha — mesmo desenho de `model_pricing`.
 *
 * ## Fechamento em 10.000 bps imposto pelo banco
 * `trg_partners_share_total` (constraint trigger DEFERRABLE INITIALLY DEFERRED, em
 * `0025_partners.sql`) verifica **no commit** que a soma das linhas vigentes é
 * exatamente 10.000. Deferido porque uma troca de sócio abre e fecha linhas dentro da
 * mesma transação e passa por estados intermediários inválidos. O serviço valida antes
 * (erro 400 legível); o trigger é a rede que também pega SQL manual.
 *
 * ## Sem RLS por titular
 * Não é dado de aluno: é dado societário da empresa. O controle é capability na API
 * (`PARTNERS_READ`/`PARTNERS_WRITE`, só `ADMIN`) — igual a `expenses`/`model_pricing`.
 */
import { date, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn } from './_shared';
import { users } from './users';

export const partners = pgTable(
  'partners',
  {
    id: primaryKeyColumn(),

    /** Nome do sócio. Não é dado de aluno; é a parte do quadro societário. */
    name: text('name').notNull(),

    /** Pontos-base inteiros: 2000 = 20%. A soma das linhas vigentes é sempre 10.000. */
    shareBasisPoints: integer('share_basis_points').notNull(),

    validFrom: date('valid_from').notNull(),

    /** `NULL` = vigente. Fechado no `valid_from` da nova composição. */
    validTo: date('valid_to'),

    notes: text('notes'),

    /** `NULL` = linha semeada pela migração (não houve ator humano). */
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),

    createdAt: eventTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [unique('uq_partners_name_valid_from').on(table.name, table.validFrom)],
);

export type PartnerRow = typeof partners.$inferSelect;
