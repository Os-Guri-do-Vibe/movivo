/**
 * Importa a TACO (NEPA/UNICAMP) para `food_items` a partir de um CSV exportado da planilha
 * oficial. Idempotente: reimportar atualiza os itens pelo número do alimento.
 *
 *   node --enable-source-maps dist/scripts/import-taco.js <arquivo.csv>
 */
import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'node:fs';

import { CoreModule } from '../core/core.module';
import { CatalogModule } from '../modules/catalog/catalog.module';
import { FoodCatalogService } from '../modules/catalog/foods/food-catalog.service';
import { parseTacoCsv } from '../modules/catalog/foods/taco-csv';

@Module({ imports: [CoreModule, CatalogModule] })
class ImportTacoModule {}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error('Uso: node dist/scripts/import-taco.js <arquivo.csv>');
    process.exitCode = 1;
    return;
  }
  const { foods, skipped } = parseTacoCsv(readFileSync(file, 'utf8'));
  const app = await NestFactory.createApplicationContext(ImportTacoModule, { logger: ['error'] });
  try {
    const imported = await app.get(FoodCatalogService).importTaco(foods);
    process.stdout.write(
      `TACO: ${imported} alimento(s) importado(s); ${skipped} linha(s) sem dados mínimos ignorada(s).\n`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
