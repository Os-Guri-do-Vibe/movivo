/**
 * `exercise_catalog_favorites` — exercícios que o RT CREF prefere prescrever (achado
 * 2026-09-26). Decisão do fundador: favorito é GLOBAL (um único conjunto para toda a
 * MOVIVO, não por `staff.id`) — hoje só há um profissional CREF (Léo); se um segundo
 * profissional entrar, os favoritos continuam sendo "os preferidos da Movivo", não de
 * uma pessoa específica.
 *
 * Tabela separada de `exercise_catalog_entries` de propósito: favoritar/desfavoritar é
 * um toggle de preferência de prescrição, não uma mudança de conteúdo clínico do
 * exercício — não deveria criar uma nova `version` com `changeNote` obrigatório a cada
 * clique. Chaveada por `exercise_key` (identidade lógica estável), não por `id` de uma
 * versão específica — sobrevive a qualquer edição/nova versão do mesmo exercício.
 *
 * Mesma gate de escrita do catálogo (`AI_CONFIG_WRITE`) — ver
 * `ExerciseCatalogAdminController`.
 */
import { pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn } from './_shared';
import { staff } from './staff';

export const exerciseCatalogFavorites = pgTable(
  'exercise_catalog_favorites',
  {
    id: primaryKeyColumn(),
    exerciseKey: text('exercise_key').notNull(),
    favoritedBy: uuid('favorited_by')
      .notNull()
      .references(() => staff.id, { onDelete: 'restrict' }),
    favoritedAt: eventTimestamp('favorited_at').notNull().defaultNow(),
  },
  (table) => [unique('uq_exercise_catalog_favorites_key').on(table.exerciseKey)],
);

export type ExerciseCatalogFavoriteRow = typeof exerciseCatalogFavorites.$inferSelect;
