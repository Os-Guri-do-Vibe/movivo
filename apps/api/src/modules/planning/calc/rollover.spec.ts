import { describe, expect, it } from 'vitest';

import type { PlanPhase, PlanSession } from '@movivo/shared';

import {
  deloadAdjustment,
  horizonWeeks,
  isDeloadWeek,
  runningProgressionAdjustment,
  weekIndexOf,
} from './rollover';

const phases: PlanPhase[] = [
  { name: 'Base', focus: 'Técnica', weeks: 4, endsWithDeload: true },
  { name: 'Acúmulo', focus: 'Volume', weeks: 3, endsWithDeload: false },
];

describe('continuidade da agenda', () => {
  it('conta a semana do plano a partir da segunda-feira do início', () => {
    // 2026-11-04 é quarta: a semana 0 começa em 2026-11-02.
    expect(weekIndexOf('2026-11-04', '2026-11-02')).toBe(0);
    expect(weekIndexOf('2026-11-04', '2026-11-09')).toBe(1);
    expect(weekIndexOf('2026-11-04', '2026-11-30')).toBe(4);
  });

  it('a semana leve é a última da fase que termina com deload', () => {
    expect([0, 1, 2, 3].map((i) => isDeloadWeek(phases, i))).toEqual([false, false, false, true]);
    // A segunda fase não termina com deload.
    expect([4, 5, 6].map((i) => isDeloadWeek(phases, i))).toEqual([false, false, false]);
  });

  it('passado o fim do plano não há semana leve: ela só existe quando o protocolo a prevê', () => {
    expect([7, 10, 11, 14].map((i) => isDeloadWeek(phases, i))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('protocolo sem mesociclo de deload nunca tem semana leve', () => {
    const none: PlanPhase[] = [{ name: 'Base', focus: 'Técnica', weeks: 8, endsWithDeload: false }];
    expect(Array.from({ length: 8 }, (_, i) => isDeloadWeek(none, i)).some(Boolean)).toBe(false);
  });

  it('o ajuste da semana leve reduz o volume a 70%', () => {
    expect(deloadAdjustment(50).shorten).toEqual({ targetMinutes: 35, factor: 0.7 });
    expect(deloadAdjustment(10).shorten?.targetMinutes).toBe(10);
  });

  it('o horizonte cobre a semana corrente e a seguinte', () => {
    expect(horizonWeeks('2026-11-04')).toEqual(['2026-11-02', '2026-11-09']);
  });
});

describe('periodização da corrida na agenda', () => {
  const run = (
    kind: 'EASY' | 'LONG' | 'INTERVALS',
    workoutType?: string,
  ): Pick<PlanSession, 'content'> =>
    ({
      content: {
        modality: 'RUNNING',
        kind,
        ...(workoutType ? { workoutType } : {}),
        segments: [],
        terrain: 'ANY',
      },
    }) as never;

  it('a primeira semana é a do plano; as seguintes crescem 5% por semana', () => {
    const factors = [0, 1, 2, 3].map(
      (week) =>
        runningProgressionAdjustment(run('INTERVALS', 'FARTLEK'), week, false)?.progress?.factor,
    );
    expect(factors).toEqual([undefined, 1.05, 1.1, 1.15]);
  });

  it('o acúmulo tem teto, e o longão cresce menos', () => {
    expect(runningProgressionAdjustment(run('EASY', 'EASY_RUN'), 12, false)?.progress?.factor).toBe(
      1.2,
    );
    expect(runningProgressionAdjustment(run('LONG', 'LONG_RUN'), 12, false)?.progress?.factor).toBe(
      1.1,
    );
  });

  it('semana leve não cresce, e plano sem treino do catálogo ou outra modalidade fica como está', () => {
    expect(runningProgressionAdjustment(run('EASY', 'EASY_RUN'), 3, true)).toBeUndefined();
    expect(runningProgressionAdjustment(run('EASY'), 3, false)).toBeUndefined();
    expect(
      runningProgressionAdjustment(
        { content: { modality: 'STRENGTH', focus: 'x', exercises: [] } } as never,
        3,
        false,
      ),
    ).toBeUndefined();
  });
});
