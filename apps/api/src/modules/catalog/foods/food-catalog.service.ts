import { Injectable } from '@nestjs/common';
import { and, eq, ilike, inArray, or, sql } from 'drizzle-orm';

import {
  FOOD_AI_CATEGORY,
  FOOD_AI_ORIGIN,
  type EstimatedNutrients,
  type FoodLogItem,
  type NutrientTotals,
  type NutrientsPer100g,
} from '@movivo/shared';

import { foodItems } from '../../../core/database/schema';
import { TenantDatabase } from '../../../core/database/tenant-database.service';
import { aiFoodCode, aiFoodName, computeTotals, searchName, searchTerms } from './food-totals';
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
    const terms = searchTerms(query);
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

  /**
   * Parecidos: itens ativos cujo nome contém ALGUM dos termos, os que casam mais termos primeiro.
   * Serve para o agente escolher o equivalente quando a busca exata não acha nada (o aluno diz
   * "arroz branco cozido" e a tabela chama de "Arroz, tipo 1, cozido").
   */
  async candidates(query: string, limit = 10): Promise<FoodMatch[]> {
    const terms = searchTerms(query, 6).filter((term) => term.length >= 3);
    if (terms.length === 0) return [];
    const hits = terms.map(
      (term) => sql`case when ${foodItems.searchName} like ${`%${term}%`} then 1 else 0 end`,
    );
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
            or(...terms.map((term) => ilike(foodItems.searchName, `%${term}%`))),
          ),
        )
        .orderBy(
          sql`(${sql.join(hits, sql` + `)}) desc`,
          sql`case when ${foodItems.searchName} like ${`${terms[0]}%`} then 0 else 1 end`,
          sql`length(${foodItems.searchName})`,
        )
        .limit(Math.min(limit, 30)),
    );
  }

  /**
   * Totais de uma refeição a partir da base. Item fora da base entra pela composição estimada
   * que carrega; sem estimativa, fica de fora e é contado em `unmatchedItems`.
   */
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

  /**
   * Inclui na base um alimento que a TACO não tem, com a composição estimada pelo agente. Entra
   * como complemento "IA" (`CUSTOM`), numa categoria própria, e vale para os próximos registros de
   * qualquer aluno. Idempotente: o mesmo alimento (mesmo nome de busca) devolve o item que já
   * existe, sem sobrescrever o valor. Devolve `null` se o nome não presta como nome de alimento.
   */
  async addEstimated(label: string, estimate: EstimatedNutrients): Promise<FoodMatch | null> {
    const name = aiFoodName(label);
    if (!name) return null;
    const key = searchName(name);
    const code = `${FOOD_AI_ORIGIN}-${aiFoodCode(key)}`;
    const per100g: NutrientsPer100g = { ...estimate, micros: {} };
    return this.db.runAsSystem(async (tx) => {
      await tx
        .insert(foodItems)
        .values({
          source: 'CUSTOM',
          sourceCode: code,
          name,
          searchName: key,
          category: FOOD_AI_CATEGORY,
          per100g,
        })
        .onConflictDoNothing({ target: [foodItems.source, foodItems.sourceCode] });
      const [row] = await tx
        .select({
          id: foodItems.id,
          name: foodItems.name,
          category: foodItems.category,
          per100g: foodItems.per100g,
        })
        .from(foodItems)
        .where(and(eq(foodItems.source, 'CUSTOM'), eq(foodItems.sourceCode, code)));
      return row ?? null;
    });
  }

  /**
   * Grava (ou atualiza) os itens pelo código da fonte. Os da TACO entram como `TACO`; os
   * complementos (`origin`) entram como `CUSTOM`, para nunca se misturarem com a TACO. Devolve
   * quantos foram gravados.
   */
  async importTaco(foods: readonly TacoFood[]): Promise<number> {
    await this.db.runAsSystem(async (tx) => {
      for (const food of foods) {
        await tx
          .insert(foodItems)
          .values({
            source: food.origin ? 'CUSTOM' : 'TACO',
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
