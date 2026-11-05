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

  it('segue a legenda da TACO: NA vale 0, vazio vale 0 só com energia, * nunca vale', () => {
    const csv = [
      'Número do Alimento;Descrição dos alimentos;Categoria;Umidade (%);Energia (kcal);Proteína (g);Lipídeos (g);Carboidrato (g)',
      '272;Óleo, de soja;Gorduras e óleos;NA;884;NA;100;NA',
      '472;Cana, aguardente 1;Bebidas;;216;;;',
      '517;Sal, grosso;Miscelâneas;0,4;NA;NA;NA;NA',
      '458;Leite, de vaca, integral;Leite e derivados;*;*;*;*;*',
      '999;Energia NA com macros;Outros;50;NA;1;1;1',
      '998;Macro reavaliado;Outros;50;100;*;5;5',
      '997;Tudo em branco;Outros;;;;;',
      '996;Tudo NA, sem umidade;Outros;NA;NA;NA;NA;NA',
    ].join('\n');

    const { foods: parsed, skipped } = parseTacoCsv(csv);

    expect(parsed.map((food) => [food.sourceCode, food.per100g])).toEqual([
      ['272', expect.objectContaining({ energyKcal: 884, proteinG: 0, fatG: 100, carbsG: 0 })],
      ['472', expect.objectContaining({ energyKcal: 216, proteinG: 0, fatG: 0, carbsG: 0 })],
      ['517', expect.objectContaining({ energyKcal: 0, proteinG: 0, fatG: 0, carbsG: 0 })],
    ]);
    // leite (*), energia NA com macros positivos, macro reavaliado, linha em branco e tudo NA.
    expect(skipped).toBe(5);
  });

  it('coluna Fonte: vazia ou TACO é TACO; outra fonte vira complemento com código prefixado', () => {
    const csv = [
      'Número do Alimento;Descrição dos alimentos;Categoria;Fonte;Energia (kcal);Proteína (g);Lipídeos (g);Carboidrato (g)',
      '3;Arroz, tipo 1, cozido;Cereais e derivados;;128;2,5;0,2;28,1',
      '4;Arroz, tipo 1, cru;Cereais e derivados;TACO;358;7,2;0,3;78,8',
      '458;Leite, de vaca, integral;Leite e derivados;USDA;61;3,15;3,25;4,80',
      '591;Coco, verde, cru;Nozes e sementes;Fonte inválida com espaços;50;1,3;2,5;5,6',
    ].join('\n');

    const { foods: parsed, skipped } = parseTacoCsv(csv);

    expect(parsed.map((food) => [food.sourceCode, food.origin])).toEqual([
      ['3', null],
      ['4', null],
      ['USDA-458', 'USDA'],
    ]);
    expect(skipped).toBe(1);
  });

  it('recusa CSV sem as colunas obrigatórias', () => {
    expect(() => parseTacoCsv('Nome;Preço\nArroz;10')).toThrow('coluna obrigatória');
  });
});
