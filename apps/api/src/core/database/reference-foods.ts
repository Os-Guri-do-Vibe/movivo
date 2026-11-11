/**
 * Alimentos padrão da aplicação: a TACO (4ª edição) e os complementos que ela não publica, versionados
 * em `assets/foods/` (ver o README de lá). Chamado no fim do `migrate.ts`, então todo ambiente (dev,
 * staging e produção) nasce com a base de alimentos pronta, sem importar nada pelo painel.
 *
 * Só INSERE o que ainda não existe (`ON CONFLICT DO NOTHING` pela chave fonte + código): nunca
 * sobrescreve um alimento que a equipe editou ou reimportou pelo painel e não reativa um que foi
 * desativado. Idempotente: rodar a cada deploy custa uma leitura de ~600 linhas.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { searchName } from '../../modules/catalog/foods/food-totals';
import {
  parseTacoCsv,
  tacoImplausibility,
  type TacoFood,
} from '../../modules/catalog/foods/taco-csv';
import { foodItems } from './schema';

/** Arquivos em `<apps/api>/assets/foods/`, na ordem de carga. */
export const REFERENCE_FOOD_FILES = ['taco-4ed.csv', 'taco-complemento.csv'] as const;

const CHUNK = 100;

/** Lê e valida os CSVs padrão. Um arquivo ilegível ou com valor absurdo é bug do repositório: falha. */
export function loadReferenceFoods(apiRoot: string): TacoFood[] {
  return REFERENCE_FOOD_FILES.flatMap((file) => {
    const { foods } = parseTacoCsv(readFileSync(resolve(apiRoot, 'assets', 'foods', file), 'utf8'));
    const problems = foods.flatMap((food) => {
      const problem = tacoImplausibility(food);
      return problem ? [`${food.sourceCode} ${food.name}: ${problem}`] : [];
    });
    if (foods.length === 0 || problems.length > 0) {
      throw new Error(
        `[db:migrate] ${file} inválido: ${foods.length === 0 ? 'nenhum alimento' : problems.join('; ')}.`,
      );
    }
    return foods;
  });
}

/** Insere os alimentos padrão que faltam. Devolve quantos entraram nesta execução. */
export async function seedReferenceFoods(db: PostgresJsDatabase, apiRoot: string): Promise<number> {
  const foods = loadReferenceFoods(apiRoot);
  let inserted = 0;
  for (let start = 0; start < foods.length; start += CHUNK) {
    const rows = await db
      .insert(foodItems)
      .values(
        foods.slice(start, start + CHUNK).map((food) => ({
          source: food.origin ? ('CUSTOM' as const) : ('TACO' as const),
          sourceCode: food.sourceCode,
          name: food.name,
          searchName: searchName(food.name),
          category: food.category,
          per100g: food.per100g,
        })),
      )
      .onConflictDoNothing({ target: [foodItems.source, foodItems.sourceCode] })
      .returning({ id: foodItems.id });
    inserted += rows.length;
  }
  return inserted;
}
