/**
 * Alimentos de DESENVOLVIMENTO: valores APROXIMADOS por 100 g de ~30 alimentos comuns, só para
 * os fluxos de nutrição funcionarem localmente antes da importação da TACO oficial
 * (`dist/scripts/import-taco.js`). Fonte `CUSTOM`, código `DEV-*`. Chamado pelo `seed.ts`, que
 * recusa produção. Idempotente pelo código.
 */
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { searchName } from '../../modules/catalog/foods/food-totals';
import { foodItems } from './schema';

type Row = [
  code: string,
  name: string,
  category: string,
  kcal: number,
  p: number,
  c: number,
  f: number,
  fiber: number,
];

const FOODS: readonly Row[] = [
  ['DEV-001', 'Arroz branco cozido', 'Cereais', 128, 2.5, 28.1, 0.2, 1.6],
  ['DEV-002', 'Arroz integral cozido', 'Cereais', 124, 2.6, 25.8, 1.0, 2.7],
  ['DEV-003', 'Feijão carioca cozido', 'Leguminosas', 76, 4.8, 13.6, 0.5, 8.5],
  ['DEV-004', 'Feijão preto cozido', 'Leguminosas', 77, 4.5, 14.0, 0.5, 8.4],
  ['DEV-005', 'Peito de frango grelhado sem pele', 'Carnes', 159, 32.0, 0, 2.5, 0],
  ['DEV-006', 'Patinho bovino grelhado', 'Carnes', 219, 35.9, 0, 7.3, 0],
  ['DEV-007', 'Ovo de galinha cozido', 'Ovos', 146, 13.3, 0.6, 9.5, 0],
  ['DEV-008', 'Pão francês', 'Cereais', 300, 8.0, 58.6, 3.1, 2.3],
  ['DEV-009', 'Banana prata', 'Frutas', 98, 1.3, 26.0, 0.1, 2.0],
  ['DEV-010', 'Maçã fuji com casca', 'Frutas', 56, 0.3, 15.2, 0, 1.3],
  ['DEV-011', 'Batata-doce cozida', 'Tubérculos', 77, 0.6, 18.4, 0.1, 2.2],
  ['DEV-012', 'Batata inglesa cozida', 'Tubérculos', 52, 1.2, 11.9, 0, 1.3],
  ['DEV-013', 'Aveia em flocos', 'Cereais', 394, 13.9, 66.6, 8.5, 9.1],
  ['DEV-014', 'Leite de vaca integral', 'Laticínios', 61, 2.9, 4.3, 3.2, 0],
  ['DEV-015', 'Iogurte natural integral', 'Laticínios', 51, 4.1, 1.9, 3.0, 0],
  ['DEV-016', 'Queijo minas frescal', 'Laticínios', 264, 17.4, 3.2, 20.2, 0],
  ['DEV-017', 'Azeite de oliva extravirgem', 'Óleos', 884, 0, 0, 100, 0],
  ['DEV-018', 'Alface crespa', 'Hortaliças', 11, 1.3, 1.7, 0.2, 1.8],
  ['DEV-019', 'Tomate', 'Hortaliças', 15, 1.1, 3.1, 0.2, 1.2],
  ['DEV-020', 'Brócolis cozido', 'Hortaliças', 25, 2.1, 4.4, 0.5, 3.4],
  ['DEV-021', 'Cenoura crua', 'Hortaliças', 34, 1.3, 7.7, 0.2, 3.2],
  ['DEV-022', 'Mandioca cozida', 'Tubérculos', 125, 0.6, 30.1, 0.3, 1.6],
  ['DEV-023', 'Cuscuz de milho cozido', 'Cereais', 113, 2.2, 25.3, 0.7, 2.1],
  ['DEV-024', 'Salmão grelhado', 'Pescados', 229, 23.9, 0, 14.0, 0],
  ['DEV-025', 'Amendoim torrado', 'Oleaginosas', 606, 22.5, 18.7, 54.0, 7.8],
  ['DEV-026', 'Mamão papaia', 'Frutas', 40, 0.5, 10.4, 0.1, 1.0],
  ['DEV-027', 'Laranja pera', 'Frutas', 37, 1.0, 8.9, 0.1, 0.8],
  ['DEV-028', 'Abacate', 'Frutas', 96, 1.2, 6.0, 8.4, 6.3],
];

export async function seedDevFoods(db: PostgresJsDatabase): Promise<number> {
  let created = 0;
  for (const [code, name, category, kcal, protein, carbs, fat, fiber] of FOODS) {
    const existing = await db
      .select({ id: foodItems.id })
      .from(foodItems)
      .where(and(eq(foodItems.source, 'CUSTOM'), eq(foodItems.sourceCode, code)))
      .limit(1);
    if (existing.length > 0) continue;
    await db.insert(foodItems).values({
      source: 'CUSTOM',
      sourceCode: code,
      name,
      searchName: searchName(name),
      category,
      per100g: {
        energyKcal: kcal,
        proteinG: protein,
        carbsG: carbs,
        fatG: fat,
        fiberG: fiber,
        micros: {},
      },
    });
    created += 1;
  }
  return created;
}
