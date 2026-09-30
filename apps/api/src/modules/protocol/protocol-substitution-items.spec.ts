import { describe, expect, it } from 'vitest';

import {
  describeChangesAsk,
  describeChangesBecame,
  itemsOf,
  joinNatural,
  MAX_SUBSTITUTION_ITEMS,
  type SubstitutionRequestItemsSource,
} from './protocol-substitution-items';

const LEGACY: SubstitutionRequestItemsSource = {
  items: null,
  status: 'PENDING',
  fromExerciseId: 'leg_press_45',
  fromExerciseName: 'Leg Press 45°',
  toExerciseId: 'agachamento_hack',
  toExerciseName: 'Agachamento Hack',
  catalogGap: false,
  reviewUrgency: 'OPTIONAL',
};

describe('itemsOf', () => {
  it('proposta legada (items nulo): deriva o único item das colunas from/to', () => {
    expect(itemsOf(LEGACY)).toEqual([
      {
        fromExerciseId: 'leg_press_45',
        fromExerciseName: 'Leg Press 45°',
        toExerciseId: 'agachamento_hack',
        toExerciseName: 'Agachamento Hack',
        catalogGap: false,
        mandatory: false,
        decision: 'PENDING',
      },
    ]);
  });

  it('proposta legada de catálogo: item sem exercício, obrigatório', () => {
    const [item] = itemsOf({
      ...LEGACY,
      toExerciseId: null,
      toExerciseName: 'Extensora Unilateral',
      catalogGap: true,
      reviewUrgency: 'MANDATORY',
    });
    expect(item).toMatchObject({ toExerciseId: null, catalogGap: true, mandatory: true });
  });

  it('a decisão do item legado acompanha o estado da proposta', () => {
    expect(itemsOf({ ...LEGACY, status: 'RELEASED' })[0]?.decision).toBe('APPROVED');
    expect(itemsOf({ ...LEGACY, status: 'DISCARDED' })[0]?.decision).toBe('DISCARDED');
    expect(itemsOf({ ...LEGACY, status: 'PENDING' })[0]?.decision).toBe('PENDING');
  });

  it('usa a coluna `items` quando válida', () => {
    const items = [
      {
        fromExerciseId: 'a',
        fromExerciseName: 'A',
        toExerciseId: 'b',
        toExerciseName: 'B',
        catalogGap: false,
        mandatory: false,
        decision: 'APPROVED' as const,
      },
      {
        fromExerciseId: 'c',
        fromExerciseName: 'C',
        toExerciseId: null,
        toExerciseName: 'D',
        catalogGap: true,
        mandatory: true,
        decision: 'PENDING' as const,
      },
    ];
    expect(itemsOf({ ...LEGACY, items })).toEqual(items);
  });

  it('`items` corrompido, vazio ou acima do teto cai no item legado, sem lançar', () => {
    expect(itemsOf({ ...LEGACY, items: [] })).toHaveLength(1);
    expect(itemsOf({ ...LEGACY, items: [{ fromExerciseId: 1 }] })).toHaveLength(1);
    expect(itemsOf({ ...LEGACY, items: 'lixo' })[0]?.fromExerciseId).toBe('leg_press_45');
    const tooMany = Array.from({ length: MAX_SUBSTITUTION_ITEMS + 1 }, (_, i) => ({
      fromExerciseId: `x${i}`,
      fromExerciseName: `X${i}`,
      toExerciseId: `y${i}`,
      toExerciseName: `Y${i}`,
      catalogGap: false,
      mandatory: false,
      decision: 'PENDING',
    }));
    expect(itemsOf({ ...LEGACY, items: tooMany })).toHaveLength(1);
  });

  it('o teto de trocas por proposta é 3', () => {
    expect(MAX_SUBSTITUTION_ITEMS).toBe(3);
  });
});

describe('frases das trocas', () => {
  it('joinNatural junta em português', () => {
    expect(joinNatural([])).toBe('');
    expect(joinNatural(['A'])).toBe('A');
    expect(joinNatural(['A', 'B'])).toBe('A e B');
    expect(joinNatural(['A', 'B', 'C'])).toBe('A, B e C');
  });

  it('descreve uma e várias trocas', () => {
    const one = [{ from: 'A', to: 'B' }];
    const many = [...one, { from: 'C', to: 'D' }];
    expect(describeChangesBecame(one)).toBe('"A" virou "B"');
    expect(describeChangesBecame(many)).toBe('"A" virou "B" e "C" virou "D"');
    expect(describeChangesAsk(one)).toBe('"A" por "B"');
    expect(describeChangesAsk(many)).toBe('"A" por "B" e "C" por "D"');
  });
});
