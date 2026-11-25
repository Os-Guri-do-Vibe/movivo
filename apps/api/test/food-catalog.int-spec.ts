/**
 * Integração — base de alimentos. Pré-requisito: `pnpm run infra:up`.
 *
 * Importação idempotente da TACO (pelo número do alimento), busca sem acento com todos os
 * termos e totais de refeição calculados no servidor.
 */
import 'reflect-metadata';

import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { foodItems } from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { CatalogModule } from '../src/modules/catalog/catalog.module';
import { FoodCatalogService } from '../src/modules/catalog/foods/food-catalog.service';
import { parseTacoCsv } from '../src/modules/catalog/foods/taco-csv';

let app: INestApplication;
let catalog: FoodCatalogService;
let db: TenantDatabase;

const CSV = [
  'Número do Alimento;Descrição dos alimentos;Categoria;Energia (kcal);Proteína (g);Lipídeos (g);Carboidrato (g);Fibra Alimentar (g)',
  'ITEST-1;Arroz, tipo 1, cozido (teste);Cereais;128;2,5;0,2;28,1;1,6',
  'ITEST-2;Feijão, carioca, cozido (teste);Leguminosas;76;4,8;0,5;13,6;8,5',
].join('\n');

beforeAll(async () => {
  app = await NestFactory.create(
    { module: class FoodRoot {}, imports: [AppModule, CatalogModule] },
    { logger: false },
  );
  await app.init();
  catalog = app.get(FoodCatalogService);
  db = app.get(TenantDatabase);
});

afterAll(async () => {
  await db?.runAsSystem((tx) =>
    tx
      .delete(foodItems)
      .where(and(eq(foodItems.source, 'TACO'), like(foodItems.sourceCode, 'ITEST-%'))),
  );
  await app?.close();
});

describe('base de alimentos', () => {
  it('importa a TACO de forma idempotente, busca sem acento e calcula totais', async () => {
    const { foods } = parseTacoCsv(CSV);
    expect(await catalog.importTaco(foods)).toBe(2);
    expect(await catalog.importTaco(foods)).toBe(2);
    const stored = await db.runAsSystem((tx) =>
      tx.select().from(foodItems).where(like(foodItems.sourceCode, 'ITEST-%')),
    );
    expect(stored).toHaveLength(2);

    const [feijao] = await catalog.search('FEIJAO carioca teste');
    expect(feijao?.name).toBe('Feijão, carioca, cozido (teste)');
    const [arroz] = await catalog.search('arroz cozido teste');
    expect(arroz).toBeDefined();

    const totals = await catalog.totals([
      { foodItemId: arroz?.id ?? null, label: 'arroz', grams: 200, portionSource: 'DECLARED' },
      { foodItemId: feijao?.id ?? null, label: 'feijão', grams: 100, portionSource: 'DECLARED' },
      { foodItemId: null, label: 'farofa', grams: 30, portionSource: 'DECLARED' },
    ]);
    expect(totals).toMatchObject({ energyKcal: 332, proteinG: 9.8, unmatchedItems: 1 });
  });
});
