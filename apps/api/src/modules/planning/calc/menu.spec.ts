import { describe, expect, it } from 'vitest';

import {
  buildOption,
  dailyCost,
  groupOf,
  rescaleOption,
  selectFoodCandidates,
  tokensOf,
  type FoodCandidate,
  type FoodRow,
} from './menu';

const candidate = (
  id: string,
  name: string,
  category: string,
  energyKcal: number,
  proteinG: number,
  carbsG: number,
  fatG: number,
): FoodCandidate => ({ id, name, category, energyKcal, proteinG, carbsG, fatG, fiberG: 1 });

const FOODS = new Map<string, FoodCandidate>(
  [
    candidate('ovo', 'Ovo, cozido', 'Ovos e derivados', 146, 13.3, 0.6, 9.5),
    candidate('pao', 'Pão, integral', 'Cereais e derivados', 253, 9.4, 49.9, 3.4),
    candidate('arroz', 'Arroz, cozido', 'Cereais e derivados', 128, 2.5, 28.1, 0.2),
    candidate(
      'batata',
      'Batata-doce, cozida',
      'Verduras, hortaliças e derivados',
      77,
      0.6,
      18.4,
      0.1,
    ),
    candidate('alface', 'Alface', 'Verduras, hortaliças e derivados', 11, 1.3, 1.7, 0.2),
    candidate('frango', 'Frango, grelhado', 'Carnes e derivados', 159, 32, 0, 2.5),
    candidate('banana', 'Banana', 'Frutas e derivados', 98, 1.3, 26, 0.1),
  ].map((f) => [f.id, f]),
);

describe('grupos de troca', () => {
  it('amido troca com amido, proteína com proteína, fruta com fruta', () => {
    expect(groupOf(FOODS.get('arroz') as FoodCandidate)).toBe('STARCH');
    expect(groupOf(FOODS.get('batata') as FoodCandidate)).toBe('STARCH');
    expect(groupOf(FOODS.get('alface') as FoodCandidate)).toBe('VEG');
    expect(groupOf(FOODS.get('frango') as FoodCandidate)).toBe('PROTEIN');
    expect(groupOf(FOODS.get('ovo') as FoodCandidate)).toBe('PROTEIN');
    expect(groupOf(FOODS.get('banana') as FoodCandidate)).toBe('FRUIT');
  });
});

describe('buildOption', () => {
  const draft = {
    title: 'Ovos com pão',
    estimatedCostBrl: 5,
    items: [
      {
        foodId: 'ovo',
        grams: 200,
        unit: { singular: 'ovo', plural: 'ovos', grams: 50 },
        swaps: [{ foodId: 'frango' }],
      },
      { foodId: 'pao', grams: 50, swaps: [{ foodId: 'arroz' }] },
      { foodId: 'banana', grams: 100, swaps: [] },
    ],
  };

  it('ajusta as porções à meta da refeição mantendo as proporções', () => {
    const { option, issues } = buildOption(draft, { energyKcal: 500, proteinG: 33 }, FOODS, 'm');
    expect(issues).toEqual([]);
    expect(Math.abs(option.totals.energyKcal - 500)).toBeLessThan(40);
    const [eggs, bread] = option.items;
    expect(eggs?.units).toBeGreaterThan(0);
    expect((eggs?.grams ?? 0) % 50).toBe(0);
    expect((bread?.grams ?? 0) % 5).toBe(0);
  });

  it('calcula a troca para igualar a energia do item', () => {
    const { option } = buildOption(draft, { energyKcal: 500, proteinG: 33 }, FOODS, 'm');
    const bread = option.items[1];
    const swap = bread?.swaps[0];
    expect(swap?.name).toBe('Arroz, cozido');
    expect(Math.abs((swap?.energyKcal ?? 0) - (bread?.energyKcal ?? 0))).toBeLessThan(20);
  });

  it('aponta alimento fora da lista, troca de outro grupo e proteína fora da meta', () => {
    const bad = buildOption(
      { ...draft, items: [{ foodId: 'picanha', grams: 100, swaps: [] }] },
      { energyKcal: 500, proteinG: 33 },
      FOODS,
      'm',
    );
    expect(bad.issues.join(' ')).toContain('não está na lista permitida');

    const wrongSwap = buildOption(
      { ...draft, items: [{ foodId: 'pao', grams: 100, swaps: [{ foodId: 'banana' }] }] },
      { energyKcal: 250, proteinG: 9 },
      FOODS,
      'm',
    );
    expect(wrongSwap.issues.join(' ')).toContain('não é uma troca equivalente');

    const lowProtein = buildOption(
      { ...draft, items: [{ foodId: 'banana', grams: 300, swaps: [] }] },
      { energyKcal: 300, proteinG: 30 },
      FOODS,
      'm',
    );
    expect(lowProtein.issues.join(' ')).toContain('de proteína');
  });

  it('recusa troca que pede um volume muito diferente (arroz por batata-inglesa pouco calórica)', () => {
    const potato = new Map(FOODS);
    potato.set(
      'inglesa',
      candidate(
        'inglesa',
        'Batata-inglesa, cozida',
        'Verduras, hortaliças e derivados',
        52,
        1.2,
        11.9,
        0,
      ),
    );
    const { issues } = buildOption(
      {
        title: 'Arroz',
        estimatedCostBrl: 3,
        items: [{ foodId: 'arroz', grams: 250, swaps: [{ foodId: 'inglesa' }] }],
      },
      { energyKcal: 320, proteinG: 8 },
      potato,
      'm',
    );
    expect(issues.join(' ')).toContain('densidade parecida');
  });

  it('na edição do profissional as quantidades não são ajustadas', () => {
    const { option, issues } = buildOption(
      draft,
      { energyKcal: 2_000, proteinG: 200 },
      FOODS,
      'm',
      false,
    );
    expect(issues).toEqual([]);
    expect(option.items[0]?.grams).toBe(200);
    expect(option.items[0]?.units).toBe(4);
  });
});

describe('rescaleOption e custo', () => {
  it('escala quantidades e totais com a meta de energia', () => {
    const { option } = buildOption(
      {
        title: 'A',
        estimatedCostBrl: 5,
        items: [
          { foodId: 'arroz', grams: 200, swaps: [{ foodId: 'batata' }] },
          { foodId: 'frango', grams: 100, swaps: [] },
        ],
      },
      { energyKcal: 600, proteinG: 40 },
      FOODS,
      'm',
      false,
    );
    const scaled = rescaleOption(option, 1.2);
    expect(scaled.totals.energyKcal).toBeGreaterThan(option.totals.energyKcal * 1.1);
    expect(scaled.totals.energyKcal).toBeLessThan(option.totals.energyKcal * 1.3);
  });

  it('o custo do dia é a média das opções de cada refeição, somada', () => {
    expect(
      dailyCost([
        { options: [{ estimatedCostBrl: 4 }, { estimatedCostBrl: 6 }] },
        { options: [{ estimatedCostBrl: 10 }] },
        {},
      ]),
    ).toBe(15);
  });
});

describe('selectFoodCandidates', () => {
  const row = (id: string, name: string, category: string, energyKcal: number): FoodRow => ({
    id,
    name,
    category,
    per100g: { energyKcal, proteinG: 5, carbsG: 10, fatG: 2, fiberG: 1 },
  });
  const rows = [
    row('1', 'Arroz, integral, cozido', 'Cereais e derivados', 124),
    row('2', 'Arroz, integral, cru', 'Cereais e derivados', 360),
    row('3', 'Frango, peito, grelhado', 'Carnes e derivados', 159),
    row('4', 'Linguiça, de porco, frita', 'Carnes e derivados', 300),
    row('5', 'Pasta de amendoim', 'Nozes e sementes', 588),
    row('6', 'Refrigerante, cola', 'Bebidas (alcoólicas e não alcoólicas)', 40),
    row('7', 'Queijo, minas', 'Leite e derivados', 264),
    row('8', 'Banana, prata', 'Frutas e derivados', 98),
    row('9', 'Maçã, fuji', 'Frutas e derivados', 56),
  ];
  const names = (list: FoodCandidate[]) => list.map((f) => f.name);

  it('tira cru, ultraprocessado e bebida; mantém o resto', () => {
    const picked = names(
      selectFoodCandidates(rows, { dietaryRestrictions: [], allergenTerms: [] }),
    );
    // Nome como se fala, não como a tabela escreve.
    expect(picked).toContain('Arroz integral cozido');
    expect(picked).not.toContain('Arroz, integral, cru');
    expect(picked).not.toContain('Linguiça, de porco, frita');
    expect(picked).not.toContain('Refrigerante, cola');
  });

  it('respeita restrição, alergia e o que o aluno evita; o que gosta vem primeiro', () => {
    const picked = names(
      selectFoodCandidates(rows, {
        dietaryRestrictions: ['LACTOSE_FREE', 'VEGETARIAN'],
        allergenTerms: ['amendoim'],
        dislikedFoods: 'maçã',
        likedFoods: 'banana',
      }),
    );
    expect(picked).not.toContain('Queijo, minas');
    expect(picked).not.toContain('Frango, peito, grelhado');
    expect(picked).not.toContain('Pasta de amendoim');
    expect(picked).not.toContain('Maçã, fuji');
    expect(picked).toContain('Banana prata');
  });

  it('extrai palavras do texto livre do aluno', () => {
    expect(tokensOf('arroz, frango e banana')).toEqual(['arroz', 'frango', 'banana']);
    expect(tokensOf(null)).toEqual([]);
  });
});
