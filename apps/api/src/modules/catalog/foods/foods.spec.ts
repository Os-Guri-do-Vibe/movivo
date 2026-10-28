import { describe, expect, it } from 'vitest';

import { computeTotals, searchName } from './food-totals';
import { parseTacoCsv } from './taco-csv';

const ARROZ = '11111111-1111-4111-8111-111111111111';
const FRANGO = '22222222-2222-4222-8222-222222222222';
const foods = new Map([
  [
    ARROZ,
    {
      energyKcal: 128,
      proteinG: 2.5,
      carbsG: 28.1,
      fatG: 0.2,
      fiberG: 1.6,
      micros: { iron_mg: 0.1 },
    },
  ],
  [
    FRANGO,
    { energyKcal: 159, proteinG: 32, carbsG: 0, fatG: 2.5, fiberG: null, micros: { iron_mg: 0.3 } },
  ],
]);

describe('totais de refeição', () => {
  it('soma os nutrientes pelas porções confirmadas', () => {
    const totals = computeTotals(
      [
        { foodItemId: ARROZ, label: 'arroz', grams: 150, portionSource: 'DECLARED' },
        { foodItemId: FRANGO, label: 'frango', grams: 120, portionSource: 'ESTIMATED' },
      ],
      foods,
    );
    expect(totals).toMatchObject({
      energyKcal: 383,
      proteinG: 42.2,
      carbsG: 42.2,
      fatG: 3.3,
      unmatchedItems: 0,
    });
    expect(totals.micros.iron_mg).toBeCloseTo(0.51);
  });

  it('item sem correspondência na base fica fora e é contado', () => {
    const totals = computeTotals(
      [{ foodItemId: null, label: 'farofa da vó', grams: 50, portionSource: 'DECLARED' }],
      foods,
    );
    expect(totals).toMatchObject({ energyKcal: 0, unmatchedItems: 1 });
  });

  it('normaliza nomes para busca', () => {
    expect(searchName('  Feijão-Carioca, COZIDO ')).toBe('feijao carioca cozido');
  });
});

describe('importação da TACO', () => {
  it('lê o CSV oficial: traço vale 0, NA fica de fora, linhas sem dado mínimo são ignoradas', () => {
    const csv = [
      'Número do Alimento;Descrição dos alimentos;Categoria;Energia (kcal);Proteína (g);Lipídeos (g);Carboidrato (g);Fibra Alimentar (g);Cálcio (mg);Ferro (mg)',
      '3;Arroz, tipo 1, cozido;Cereais e derivados;128;2,5;0,2;28,1;1,6;4;0,1',
      '410;"Peito de frango, sem pele, grelhado";Carnes e derivados;159;32,0;2,5;0,0;NA;Tr;0,3',
      '999;Linha incompleta;Outros;NA;1;1;1;;;',
    ].join('\n');
    const { foods: parsed, skipped } = parseTacoCsv(csv);
    expect(skipped).toBe(1);
    expect(parsed).toEqual([
      expect.objectContaining({
        sourceCode: '3',
        name: 'Arroz, tipo 1, cozido',
        per100g: expect.objectContaining({
          energyKcal: 128,
          proteinG: 2.5,
          fiberG: 1.6,
          micros: { calcium_mg: 4, iron_mg: 0.1 },
        }),
      }),
      expect.objectContaining({
        sourceCode: '410',
        per100g: expect.objectContaining({ fiberG: null, micros: { calcium_mg: 0, iron_mg: 0.3 } }),
      }),
    ]);
  });

  it('recusa CSV sem as colunas obrigatórias', () => {
    expect(() => parseTacoCsv('Nome;Preço\nArroz;10')).toThrow('coluna obrigatória');
  });
});
