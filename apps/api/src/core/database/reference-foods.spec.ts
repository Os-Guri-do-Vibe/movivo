import { describe, expect, it, vi } from 'vitest';

import { loadReferenceFoods, seedReferenceFoods } from './reference-foods';

/** Vitest roda a partir de `apps/api`, a mesma raiz que o `migrate.ts` usa. */
const API_ROOT = process.cwd();

/** `db.insert().values().onConflictDoNothing().returning()` que "grava" só as primeiras `fresh` linhas. */
function fakeDb(fresh: (rows: unknown[]) => number) {
  const batches: Array<Record<string, unknown>[]> = [];
  const conflict = vi.fn();
  const db = {
    insert: vi.fn(() => ({
      values: (rows: Record<string, unknown>[]) => {
        batches.push(rows);
        return {
          onConflictDoNothing: (target: unknown) => {
            conflict(target);
            return { returning: () => Promise.resolve(rows.slice(0, fresh(rows))) };
          },
        };
      },
    })),
  };
  return { db: db as never, batches, conflict };
}

describe('alimentos padrão (assets/foods)', () => {
  const foods = loadReferenceFoods(API_ROOT);
  const tacoFoods = foods.filter((food) => food.origin === null);
  const complements = foods.filter((food) => food.origin !== null);

  it('traz a TACO publicada (593 de 597) e os 4 complementos que ela retirou', () => {
    expect(tacoFoods).toHaveLength(593);
    expect(complements.map((food) => [food.sourceCode, food.name])).toEqual([
      ['Estimativa-450', 'Iogurte, sabor abacaxi'],
      ['USDA-457', 'Leite, de vaca, desnatado, UHT'],
      ['USDA-458', 'Leite, de vaca, integral'],
      ['Embrapa-591', 'Coco, verde, cru'],
    ]);
    // 593 + 4: a tabela oficial inteira, sem nenhum alimento faltando.
    expect(
      new Set([...tacoFoods, ...complements].map((food) => food.sourceCode.split('-').pop())).size,
    ).toBe(597);
  });

  it('não repete código e cabe na coluna do banco (32 caracteres)', () => {
    const codes = foods.map((food) => food.sourceCode);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => code.length <= 32)).toBe(true);
  });

  it('segue a legenda da TACO: óleos, cachaça e sais entram com zeros, sem inventar dado', () => {
    const byCode = new Map(tacoFoods.map((food) => [food.sourceCode, food]));
    expect(byCode.get('272')?.per100g).toMatchObject({
      energyKcal: 884,
      proteinG: 0,
      fatG: 100,
      carbsG: 0,
    });
    expect(byCode.get('472')?.per100g).toMatchObject({ energyKcal: 216, fatG: 0 });
    expect(byCode.get('517')?.per100g).toMatchObject({ energyKcal: 0, carbsG: 0 });
    // Os 4 que a TACO retirou ("*") não entram como TACO.
    for (const code of ['450', '457', '458', '591']) expect(byCode.has(code)).toBe(false);
  });
});

describe('seedReferenceFoods', () => {
  it('insere em lotes com ON CONFLICT DO NOTHING e marca complementos como CUSTOM', async () => {
    const { db, batches, conflict } = fakeDb((rows) => rows.length);

    const inserted = await seedReferenceFoods(db, API_ROOT);

    expect(inserted).toBe(597);
    expect(batches.length).toBeGreaterThan(1);
    expect(conflict).toHaveBeenCalledTimes(batches.length);
    expect(conflict.mock.calls[0]?.[0]).toMatchObject({ target: expect.any(Array) });
    const rows = batches.flat();
    expect(rows.filter((row) => row.source === 'CUSTOM').map((row) => row.sourceCode)).toEqual([
      'Estimativa-450',
      'USDA-457',
      'USDA-458',
      'Embrapa-591',
    ]);
    expect(rows.filter((row) => row.source === 'TACO')).toHaveLength(593);
  });

  it('é idempotente: numa segunda execução, nada novo entra', async () => {
    const { db } = fakeDb(() => 0);
    expect(await seedReferenceFoods(db, API_ROOT)).toBe(0);
  });
});
