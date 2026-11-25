import { describe, expect, it } from 'vitest';

import { summarizeNutritionWeek, weightSlopePerWeek, type DayTargets } from './nutrition-week';

const day: DayTargets = { energyKcal: { min: 1_900, max: 2_100 }, proteinG: 150, fiberG: 30 };
const meal = (date: string, slot: string, energyKcal: number, proteinG: number, fiberG = 5) => ({
  date,
  meal: slot,
  energyKcal,
  proteinG,
  fiberG,
});
const fullDay = (date: string, energy = 2_000, protein = 120) => [
  meal(date, 'BREAKFAST', energy * 0.25, protein * 0.25),
  meal(date, 'LUNCH', energy * 0.4, protein * 0.4),
  meal(date, 'DINNER', energy * 0.35, protein * 0.35),
];

describe('summarizeNutritionWeek', () => {
  const base = {
    today: '2026-11-04',
    trainingDay: day,
    restDay: day,
    trainingDates: new Set<string>(),
    checkIns: [],
    weights: [],
  };

  it('compara só os dias completos com a meta e conta as refeições que somem', () => {
    const week = summarizeNutritionWeek({
      ...base,
      logs: [
        ...fullDay('2026-11-03'),
        ...fullDay('2026-11-02', 1_800, 150),
        meal('2026-11-01', 'LUNCH', 600, 30),
      ],
    });
    expect(week.loggedDays).toBe(3);
    expect(week.fullDays).toBe(2);
    expect(week.avgEnergyKcal).toBe(1_900);
    expect(week.energyRatio).toBe(0.95);
    expect(week.proteinRatio).toBe(0.9);
    expect(week.daysBySlot).toMatchObject({ LUNCH: 3, BREAKFAST: 2, DINNER: 2 });
  });

  it('sem dia completo não há média nem razão (registro parcial enganaria)', () => {
    const week = summarizeNutritionWeek({ ...base, logs: [meal('2026-11-03', 'LUNCH', 600, 30)] });
    expect(week.fullDays).toBe(0);
    expect(week.avgEnergyKcal).toBeNull();
    expect(week.energyRatio).toBeNull();
  });

  it('dia de treino usa a meta do dia de treino', () => {
    const training: DayTargets = {
      energyKcal: { min: 2_400, max: 2_600 },
      proteinG: 160,
      fiberG: 30,
    };
    const week = summarizeNutritionWeek({
      ...base,
      trainingDay: training,
      trainingDates: new Set(['2026-11-03']),
      logs: fullDay('2026-11-03', 2_500, 160),
    });
    expect(week.energyRatio).toBe(1);
    expect(week.proteinRatio).toBe(1);
  });

  it('conta o que o aluno diz sobre a semana no check-in', () => {
    const week = summarizeNutritionWeek({
      ...base,
      logs: [],
      checkIns: [
        { date: '2026-11-03', nutrition: 'ON_TRACK' },
        { date: '2026-11-02', nutrition: 'OFF' },
        { date: '2026-11-01', nutrition: 'OFF' },
        { date: '2026-10-01', nutrition: 'OFF' },
      ],
    });
    expect(week.checkIn).toEqual({ onTrack: 1, partial: 0, off: 2 });
  });
});

describe('weightSlopePerWeek', () => {
  it('tendência de peso com 2 pesagens separadas por 7 dias ou mais', () => {
    const points = [
      { date: '2026-10-07', value: 80 },
      { date: '2026-10-21', value: 79.2 },
      { date: '2026-11-04', value: 78.4 },
    ];
    expect(weightSlopePerWeek(points)).toBe(-0.4);
    expect(weightSlopePerWeek(points.slice(0, 2))).toBe(-0.4);
    expect(weightSlopePerWeek(points.slice(0, 1))).toBeNull();
    expect(
      weightSlopePerWeek([
        { date: '2026-11-01', value: 80 },
        { date: '2026-11-02', value: 79.5 },
        { date: '2026-11-03', value: 79 },
      ]),
    ).toBeNull();
  });
});
