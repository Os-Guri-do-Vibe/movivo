import { describe, expect, it } from 'vitest';

import {
  foodLogMessage,
  foodLogRemovedMessage,
  foodQueryMessage,
  macroLines,
  tableNotes,
} from './food-chat';
import { foodLogTask } from './food-log-task';

const totals = { energyKcal: 128.4, proteinG: 1.2, carbsG: 33.6, fatG: 0.4 };
const day = {
  totals: { energyKcal: 1_240, proteinG: 82, carbsG: 150, fatG: 40 },
  targetKcal: 2_100,
  targetProteinG: 140,
};

describe('mensagens do registro alimentar', () => {
  it('toda refeição registrada responde com calorias, proteínas, carboidratos e gorduras', () => {
    expect(macroLines(totals)).toBe(
      'Calorias: 128 kcal\nProteínas: 1 g\nCarboidratos: 34 g\nGorduras: 0 g',
    );
    const text = foodLogMessage({
      meal: 'AFTERNOON_SNACK',
      items: [{ label: 'manga', grams: 200 }],
      mealTotals: totals,
      day,
      comment: 'Boa escolha para o lanche.',
      portionsEstimated: false,
    });
    const [meal, today, comment] = text.split('\n---\n');
    expect(meal).toBe(
      'Registrei seu lanche da tarde:\n- 200 g de manga\n\nEssa refeição teve:\nCalorias: 128 kcal\nProteínas: 1 g\nCarboidratos: 34 g\nGorduras: 0 g',
    );
    expect(today).toMatch(/^Hoje até agora: 1\.240 kcal \(meta ~2\.100\)/);
    expect(comment).toBe('Boa escolha para o lanche.');
  });

  it('avisa o que entrou por estimativa e o que ficou sem número', () => {
    expect(tableNotes({ estimatedLabels: [], unmatchedLabels: [] })).toEqual([]);
    const text = foodLogMessage({
      meal: 'DINNER',
      items: [
        { label: 'pizza de calabresa', grams: 200 },
        { label: 'farofa da vó', grams: 50 },
      ],
      mealTotals: totals,
      day,
      comment: null,
      portionsEstimated: true,
      estimatedLabels: ['pizza de calabresa'],
      unmatchedLabels: ['farofa da vó'],
    });
    expect(text).toMatch(/Não encontrei pizza de calabresa na tabela TACO/);
    expect(text).toMatch(/usei uma estimativa/);
    expect(text).toMatch(/Não consegui calcular farofa da vó/);
    expect(text).toMatch(/estimadas pela foto/);
  });

  it('a consulta responde os números e deixa claro que nada foi registrado', () => {
    const text = foodQueryMessage({
      items: [{ label: 'manga', grams: 200 }],
      totals,
      portionsEstimated: false,
      estimatedLabels: [],
      unmatchedLabels: [],
    });
    expect(text).toMatch(/- 200 g de manga/);
    expect(text).toMatch(/Calorias: 128 kcal/);
    expect(text).toMatch(/não registrei nada no seu dia/);
    expect(text).not.toMatch(/Registrei/);
    expect(text).not.toMatch(/Hoje até agora/);
  });

  it('registro apagado mostra como ficou o dia; o de ontem não mistura com hoje', () => {
    expect(foodLogRemovedMessage({ meal: 'LUNCH', day })).toMatch(
      /apaguei o registro do seu almoço\.\n---\nHoje até agora/,
    );
    expect(foodLogRemovedMessage({ meal: 'LUNCH', day, otherDay: true })).not.toMatch(/Hoje/);
  });
});

describe('nutrition.interpret_food_log · regras novas', () => {
  const validate = (input: object, output: object) =>
    foodLogTask.validators.flatMap(
      (v) => v(input as never, output as never, {} as never) as { path: string }[],
    );
  const base = { text: 'comi', mealHint: null, localTime: '13:00' };

  it('registra o que não está no plano, pela hora ou pelo momento citado', () => {
    expect(foodLogTask.instructions).toMatch(/mesmo fora das refeições do plano/);
    expect(foodLogTask.instructions).toMatch(/"depois do almoço" = lanche da tarde/);
  });

  it('apagar só vale em correção e sem itens', () => {
    const previous = { meal: 'LUNCH', items: [{ label: 'arroz', grams: 100 }] };
    const empty = { meal: 'LUNCH', items: [], needsClarification: null };
    expect(validate({ ...base, previous }, { ...empty, discard: true })).toEqual([]);
    expect(validate(base, { ...empty, discard: true }).map((v) => v.path)).toContain('discard');
    expect(validate({ ...base, previous }, empty).map((v) => v.path)).toContain('items');
  });

  it('aceita o que acabou de ser consultado como contexto de "comi"', () => {
    expect(
      foodLogTask.input.safeParse({ ...base, queried: [{ label: 'manga', grams: 200 }] }).success,
    ).toBe(true);
    expect(foodLogTask.instructions).toMatch(/"queried"/);
  });
});
