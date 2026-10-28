/**
 * Nutrição contínua: plano versionado, base de alimentos e registros de refeição.
 *
 * Os totais de uma refeição são SEMPRE calculados no servidor a partir de `food_items`
 * (cálculo determinístico). A foto de refeição só ajuda a identificar itens e porções, que o
 * aluno confirma — micronutriente nunca é "lido" de uma imagem.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import {
  foodLogSourceSchema,
  mealSlotSchema,
  planStatusSchema,
  type FoodLogItem,
  type NutrientTotals,
  type NutrientsPer100g,
  type NutritionPlanStructure,
} from '@movivo/shared';

import {
  checkOneOf,
  primaryKeyColumn,
  eventTimestamp,
  timestampColumns,
  userIdColumn,
} from './_shared';
import { studentGoals } from './student-state';
import { users } from './users';

const ownerColumn = () =>
  userIdColumn()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

export const nutritionPlans = pgTable(
  'nutrition_plans',
  {
    id: primaryKeyColumn(),
    userId: ownerColumn(),
    version: integer('version').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('DRAFT'),
    goalId: uuid('goal_id').references(() => studentGoals.id, { onDelete: 'set null' }),
    structure: jsonb('structure').$type<NutritionPlanStructure>().notNull(),
    startsOn: date('starts_on').notNull(),
    methodologyVersions: jsonb('methodology_versions')
      .$type<Record<string, number>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    publishedAt: eventTimestamp('published_at'),
    ...timestampColumns,
  },
  (t) => [
    unique('uq_nutrition_plans_user_version').on(t.userId, t.version),
    uniqueIndex('uq_nutrition_plans_one_active')
      .on(t.userId)
      .where(sql`${t.status} = 'ACTIVE'`),
    checkOneOf('ck_nutrition_plans_status', t.status, planStatusSchema.options),
  ],
);

/** Base de alimentos (global, sem dado de titular): TACO + itens cadastrados pela equipe. */
export const foodItems = pgTable(
  'food_items',
  {
    id: primaryKeyColumn(),
    source: varchar('source', { length: 16 }).notNull(),
    /** Código na fonte (ex.: número do alimento na TACO). */
    sourceCode: varchar('source_code', { length: 32 }),
    name: varchar('name', { length: 200 }).notNull(),
    /** Nome sem acento e em minúsculas, para busca. */
    searchName: varchar('search_name', { length: 200 }).notNull(),
    category: varchar('category', { length: 80 }).notNull(),
    per100g: jsonb('per_100g').$type<NutrientsPer100g>().notNull(),
    active: boolean('active').notNull().default(true),
    ...timestampColumns,
  },
  (t) => [
    unique('uq_food_items_source_code').on(t.source, t.sourceCode),
    // ~600 itens (TACO + customizados): busca por ILIKE sem índice de trigrama, que exigiria
    // a extensão pg_trgm só para isso.
    index('idx_food_items_active').on(t.active, t.category),
    checkOneOf('ck_food_items_source', t.source, ['TACO', 'CUSTOM']),
  ],
);

export const foodLogs = pgTable(
  'food_logs',
  {
    id: primaryKeyColumn(),
    userId: ownerColumn(),
    loggedOn: date('logged_on').notNull(),
    meal: varchar('meal', { length: 24 }).notNull(),
    items: jsonb('items').$type<FoodLogItem[]>().notNull(),
    totals: jsonb('totals').$type<NutrientTotals>().notNull(),
    source: varchar('source', { length: 16 }).notNull(),
    /** Itens confirmados pelo aluno (registro por foto/texto só conta depois disso). */
    confirmed: boolean('confirmed').notNull().default(false),
    /** Caminho da foto no armazenamento privado, quando o registro veio de imagem. */
    photoPath: varchar('photo_path', { length: 120 }),
    hunger: integer('hunger'),
    ...timestampColumns,
  },
  (t) => [
    index('idx_food_logs_user_day').on(t.userId, t.loggedOn),
    checkOneOf('ck_food_logs_meal', t.meal, mealSlotSchema.options),
    checkOneOf('ck_food_logs_source', t.source, foodLogSourceSchema.options),
  ],
);
