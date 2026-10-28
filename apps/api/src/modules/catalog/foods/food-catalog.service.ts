import { Injectable } from '@nestjs/common';
import { and, eq, ilike, inArray, sql } from 'drizzle-orm';

import type { FoodLogItem, NutrientTotals, NutrientsPer100g } from '@movivo/shared';

import { foodItems } from '../../../core/database/schema';
import { TenantDatabase } from '../../../core/database/tenant-database.service';
import { computeTotals, searchName } from './food-totals';
import type { TacoFood } from './taco-csv';

export interface FoodMatch {
  id: string;
  name: string;
  category: string;
  per100g: NutrientsPer100g;
}

const SEARCH_LIMIT = 10;

/**
 * Base de alimentos: busca por nome (sem acento, todos os termos), totais de refeição e
 * importação idempotente da TACO.
 */
@Injectable()
export class FoodCatalogService {
  constructor(private readonly db: TenantDatabase) {}

  /** Itens ativos cujo nome contém TODOS os termos; nomes que começam pelo termo vêm primeiro. */
  async search(query: string, limit = SEARCH_LIMIT): Promise<FoodMatch[]> {
    const terms = searchName(query)
      .split(' ')
      .filter((t) => t.length >= 2)
      .slice(0, 5);
    if (terms.length === 0) return [];
    return this.db.runAsSystem((tx) =>
      tx
        .select({
          id: foodItems.id,
          name: foodItems.name,
          category: foodItems.category,
          per100g: foodItems.per100g,
        })
        .from(foodItems)
        .where(
          and(
            eq(foodItems.active, true),
            ...terms.map((term) => ilike(foodItems.searchName, `%${term}%`)),
          ),
        )
        .orderBy(
          sql`case when ${foodItems.searchName} like ${`${terms[0]}%`} then 0 else 1 end`,
          sql`length(${foodItems.searchName})`,
        )
        .limit(Math.min(limit, 50)),
    );
  }

  /** Totais de uma refeição a partir da base (itens sem correspondência ficam de fora). */
  async totals(items: readonly FoodLogItem[]): Promise<NutrientTotals> {
    const ids = items.flatMap((item) => (item.foodItemId ? [item.foodItemId] : []));
    const rows =
      ids.length === 0
        ? []
        : await this.db.runAsSystem((tx) =>
            tx
              .select({ id: foodItems.id, per100g: foodItems.per100g })
              .from(foodItems)
              .where(inArray(foodItems.id, ids)),
          );
    return computeTotals(items, new Map(rows.map((row) => [row.id, row.per100g])));
  }

  /** Grava (ou atualiza) os itens da TACO pelo código da fonte. Devolve quantos foram gravados. */
  async importTaco(foods: readonly TacoFood[]): Promise<number> {
    await this.db.runAsSystem(async (tx) => {
      for (const food of foods) {
        await tx
          .insert(foodItems)
          .values({
            source: 'TACO',
            sourceCode: food.sourceCode,
            name: food.name,
            searchName: searchName(food.name),
            category: food.category,
            per100g: food.per100g,
          })
          .onConflictDoUpdate({
            target: [foodItems.source, foodItems.sourceCode],
            set: {
              name: food.name,
              searchName: searchName(food.name),
              category: food.category,
              per100g: food.per100g,
              active: true,
            },
          });
      }
    });
    return foods.length;
  }
}
