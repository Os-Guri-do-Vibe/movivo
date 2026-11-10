import { describe, expect, it } from 'vitest';

import type { MealOption } from '@movivo/shared';

import { gapDaysOf, streakDaysOf } from '../progress/meal-routine.service';
import {
  dayIsClosable,
  daySummaryBlock,
  dayTotals,
  missingSlots,
  numbersIn,
  optionLines,
  slotDueAt,
  trackedSlots,
  unknownNumbers,
  type LoggedMeal,
} from './meal-routine';

const meal = (slot: LoggedMeal['slot'], createdAt: string, kcal = 500): LoggedMeal => ({
  slot,
  energyKcal: kcal,
  proteinG: 30,
  carbsG: 50,
  fatG: 15,
  createdAt: new Date(createdAt),
});

describe('rotina alimentar', () => {
  it('o lembrete sai no minuto exato da refeição, só para refeições do plano', () => {
    expect(slotDueAt('07:30', ['BREAKFAST', 'LUNCH'])).toBe('BREAKFAST');
    expect(slotDueAt('12:30', ['BREAKFAST', 'LUNCH'])).toBe('LUNCH');
    expect(slotDueAt('12:30', ['BREAKFAST'])).toBeNull();
    expect(slotDueAt('07:31', ['BREAKFAST'])).toBeNull();
  });

  it('pré e pós-treino não entram no registro do dia', () => {
    expect(
      trackedSlots({
        meals: [
          { slot: 'BREAKFAST' },
          { slot: 'PRE_WORKOUT' },
          { slot: 'LUNCH' },
          { slot: 'POST_WORKOUT' },
        ] as never,
      }),
    ).toEqual(['BREAKFAST', 'LUNCH']);
  });

  it('lista a primeira opção como o aluno lê, com unidade e ml', () => {
    const option = {
      title: 'Café com ovos',
      totals: { energyKcal: 400, proteinG: 30, carbsG: 30, fatG: 15, fiberG: 2 },
      estimatedCostBrl: 6,
      items: [
        {
          foodId: 'a',
          name: 'Leite, de vaca, desnatado, UHT',
          grams: 200,
          energyKcal: 70,
          proteinG: 7,
          carbsG: 10,
          fatG: 0,
          swaps: [],
        },
        {
          foodId: 'b',
          name: 'Ovo, de galinha, mexido',
          grams: 100,
          unit: { singular: 'ovo', plural: 'ovos', grams: 50 },
          units: 2,
          energyKcal: 190,
          proteinG: 13,
          carbsG: 1,
          fatG: 14,
          swaps: [],
        },
        {
          foodId: 'c',
          name: 'Requeijão, light',
          grams: 30,
          energyKcal: 50,
          proteinG: 3,
          carbsG: 1,
          fatG: 3,
          swaps: [],
        },
      ],
    } as MealOption;
    expect(optionLines(option)).toEqual([
      '- 200 ml de leite desnatado UHT',
      '- 2 ovos de ovo de galinha mexido',
      '- 30 g de requeijão light',
    ]);
  });

  it('o dia fecha quando tudo foi registrado e o aluno parou, ou às 23:30', () => {
    const planned = ['BREAKFAST', 'LUNCH', 'DINNER'] as const;
    const logged = [
      meal('BREAKFAST', '2026-11-04T10:00:00Z'),
      meal('LUNCH', '2026-11-04T15:00:00Z'),
      meal('DINNER', '2026-11-04T22:30:00Z'),
    ];
    const at = (iso: string) => new Date(iso);
    // completo, mas acabou de registrar o jantar: espera o aluno terminar
    expect(
      dayIsClosable({ planned, logged, localTime: '19:45', now: at('2026-11-04T22:40:00Z') }),
    ).toBe(false);
    // completo e parado há mais de 15 minutos
    expect(
      dayIsClosable({ planned, logged, localTime: '20:00', now: at('2026-11-04T22:50:00Z') }),
    ).toBe(true);
    // faltando a janta antes do fim da noite: segue aberto
    expect(
      dayIsClosable({
        planned,
        logged: logged.slice(0, 2),
        localTime: '21:00',
        now: at('2026-11-05T00:00:00Z'),
      }),
    ).toBe(false);
    // 23:30: fecha de qualquer jeito
    expect(
      dayIsClosable({
        planned,
        logged: logged.slice(0, 2),
        localTime: '23:30',
        now: at('2026-11-05T02:30:00Z'),
      }),
    ).toBe(true);
    // cedo demais, mesmo completo
    expect(
      dayIsClosable({ planned, logged, localTime: '18:30', now: at('2026-11-05T12:00:00Z') }),
    ).toBe(false);
    expect(missingSlots(planned, logged.slice(0, 2))).toEqual(['DINNER']);
  });

  it('o resumo traz calorias, macros e água no formato combinado', () => {
    const totals = dayTotals([meal('BREAKFAST', '2026-11-04T10:00:00Z', 2_105)]);
    expect(daySummaryBlock({ firstName: 'Ana', totals, waterMl: 2_300 })).toBe(
      [
        'Ana, seu registro nutricional total do dia ficou assim:',
        'Calorias consumidas: 2.105 kcal',
        'Proteínas: 30 g',
        'Carboidratos: 50 g',
        'Gorduras: 15 g',
        '',
        'Água: 2,3 L',
      ].join('\n'),
    );
    expect(daySummaryBlock({ firstName: null, totals, waterMl: null })).not.toContain('Água');
  });

  it('dias sem registro e sequência contam de ontem para trás, a partir do início do plano', () => {
    const logged = new Set(['2026-11-01', '2026-11-02']);
    expect(gapDaysOf(logged, '2026-11-05', '2026-10-20')).toBe(2);
    expect(gapDaysOf(new Set(), '2026-11-05', '2026-11-03')).toBe(2); // plano começou há 2 dias
    expect(gapDaysOf(new Set(['2026-11-04']), '2026-11-05', '2026-10-20')).toBe(0);
    expect(streakDaysOf(new Set(['2026-11-04', '2026-11-03', '2026-11-01']), '2026-11-05')).toBe(2);
  });

  it('só deixa o modelo citar números que vieram dos dados', () => {
    const data = { consumed: { proteinG: 80 }, target: { proteinG: 140 } };
    expect(
      unknownNumbers('Faltam 60 g de proteína e 2 refeições.', [...numbersIn(data), 60]),
    ).toEqual([]);
    expect(unknownNumbers('Você comeu 1.900 kcal hoje.', numbersIn(data))).toEqual(['1.900']);
    expect(unknownNumbers('Foram 81 g de proteína', numbersIn(data))).toEqual([]); // arredondamento
  });
});
